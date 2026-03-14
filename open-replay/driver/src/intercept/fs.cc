// Open Replay — File System Interception
//
// Intercepts: open, openat, read, close, stat, fstat, lstat
//
// Path filtering: skips system paths (/usr/, /System/, /Library/, /private/,
// /dev/, /.openreplay/) to avoid recording Node.js module loading noise.
// Only user-space file I/O is recorded.
//
// Fd tracking: open/openat record which fds are "user fds" so that read/close
// only intercept those fds (not internal Node.js fds).

/*
 * 【文件系统拦截策略】
 *
 * 当前策略：仅录制模式拦截，回放模式跳过所有文件系统调用。
 *
 * 为什么回放模式不拦截文件系统？
 * ──────────────────────────
 * Node.js 启动时会执行大量文件操作（require 模块解析、stat 检查、读取 .js 文件），
 * 这些操作的顺序和数量取决于 cwd（工作目录）和 node_modules 结构。
 * 如果回放时 cwd 与录制时不同（很常见），文件操作序列会错位，
 * 导致事件流对齐失败（读到错误的录制数据）。
 *
 * 未来计划：实现"虚拟文件系统"——录制时把文件内容也存入 .orec，
 * 回放时完全从录制数据中提供文件内容，彻底消除对真实文件系统的依赖。
 *
 * 路径过滤的目的：
 * ──────────────
 * 即使在录制模式，也跳过系统路径（/usr, /System, /Library 等）。
 * 这些是 Node.js 内部模块加载产生的 I/O，录制它们不仅浪费空间，
 * 还会让事件流变得极其庞大（一次 require 可能触发几百次 stat/open）。
 * 只录制用户空间的文件操作（用户脚本读写的文件）。
 *
 * Fd 追踪机制：
 * ────────────
 * open/openat 返回的 fd 加入 g_tracked_fds 集合。
 * 后续的 read/close/fstat 只拦截被追踪的 fd，
 * 避免拦截 Node.js 内部打开的 fd（如 libuv 的 eventfd、pipe 等）。
 */

#include "intercept/common.h"

#include <cstdarg>
#include <cstring>
#include <cerrno>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <unordered_set>
#include <pthread.h>

// Socket fd tracking (defined in net.cc)
extern std::unordered_set<int> g_socket_fds;
extern pthread_mutex_t g_socket_fd_mutex;
bool IsSocketFd(int fd);  // defined in net.cc
void UntrackSocketFd(int fd);  // defined in net.cc

// --- Path filtering ---

// Returns true if this path should be intercepted (user-space file I/O).
// Skips system paths and the recording directory to keep recordings small.
static bool ShouldInterceptPath(const char* path) {
  if (!path || path[0] == '\0') return false;

  // Skip system/framework paths (Node.js module loading)
  if (strncmp(path, "/usr/", 5) == 0) return false;
  if (strncmp(path, "/System/", 8) == 0) return false;
  if (strncmp(path, "/Library/", 9) == 0) return false;
  if (strncmp(path, "/private/", 9) == 0) return false;
  if (strncmp(path, "/dev/", 5) == 0) return false;
  if (strncmp(path, "/proc/", 6) == 0) return false;
  if (strncmp(path, "/sys/", 5) == 0) return false;

  // Skip the recording directory itself
  if (strstr(path, "/.openreplay/") != nullptr) return false;

  return true;
}

// --- Fd tracking ---
// Tracks which file descriptors were opened through interception.
// read/close only intercept these fds.

static std::unordered_set<int> g_tracked_fds;
static pthread_mutex_t g_fd_mutex = PTHREAD_MUTEX_INITIALIZER;

static void TrackFd(int fd) {
  if (fd < 0) return;
  pthread_mutex_lock(&g_fd_mutex);
  g_tracked_fds.insert(fd);
  pthread_mutex_unlock(&g_fd_mutex);
}

static void UntrackFd(int fd) {
  pthread_mutex_lock(&g_fd_mutex);
  g_tracked_fds.erase(fd);
  pthread_mutex_unlock(&g_fd_mutex);
}

static bool IsTrackedFd(int fd) {
  if (fd < 0) return false;
  pthread_mutex_lock(&g_fd_mutex);
  bool result = g_tracked_fds.count(fd) > 0;
  pthread_mutex_unlock(&g_fd_mutex);
  return result;
}

// --- Intercepted functions ---
//
// File system interception is RECORDING-ONLY for now.
// During replay, Node.js module loading produces different stat/open
// patterns depending on cwd, which causes event stream misalignment.
// A future "virtual file system" can replay file content from recording.

/*
 * 【拦截函数的统一模式】
 * 每个拦截函数遵循相同的模板：
 *   1. InterceptGuard guard — 防重入检查（详见 common.h）
 *   2. if (!guard) → 透传：重入调用不拦截
 *   3. 路径/fd 过滤 → 透传：不在拦截范围内
 *   4. if (IsReplaying()) → 透传：当前不支持回放拦截
 *   5. if (IsRecording()) → 执行真实调用 + 录制返回值
 *
 * 注意 errno 保护：录制操作（RecordReplayValue）可能修改 errno，
 * 必须在调用前保存、调用后恢复，否则上层代码会看到错误的 errno。
 *
 * 注意：每个函数里有两段 IsReplaying() 检查——第一段在过滤之前提前返回，
 * 第二段是录制/回放分支的 dead code（回放已在第一段返回）。
 * 保留第二段是为了未来启用回放拦截时的代码骨架。
 */

extern "C" {

int my_open(const char* path, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list ap;
    va_start(ap, flags);
    mode = va_arg(ap, int);
    va_end(ap);
  }
  InterceptGuard guard;
  if (!guard) return open(path, flags, mode);
  if (!ShouldInterceptPath(path)) return open(path, flags, mode);
  // Skip fs interception during replay (recording-only for now)
  if (RecordReplayIsReplaying()) return open(path, flags, mode);

  if (RecordReplayIsRecording()) {
    int ret = open(path, flags, mode);
    int saved_errno = errno;
    RecordReplayValue("open", static_cast<uintptr_t>(ret));
    if (ret >= 0) TrackFd(ret);
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    // Do the real open so the fd is valid for libuv/syscall close.
    // We track the real fd and serve recorded data from read().
    int ret = open(path, flags, mode);
    int saved_errno = errno;
    RecordReplayValue("open", 0);  // consume recorded value, keep stream in sync
    if (ret >= 0) TrackFd(ret);
    errno = saved_errno;
    return ret;
  }
  return open(path, flags, mode);
}

int my_openat(int dirfd, const char* path, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list ap;
    va_start(ap, flags);
    mode = va_arg(ap, int);
    va_end(ap);
  }
  InterceptGuard guard;
  if (!guard) return openat(dirfd, path, flags, mode);
  if (!ShouldInterceptPath(path)) return openat(dirfd, path, flags, mode);
  if (RecordReplayIsReplaying()) return openat(dirfd, path, flags, mode);

  if (RecordReplayIsRecording()) {
    int ret = openat(dirfd, path, flags, mode);
    int saved_errno = errno;
    RecordReplayValue("openat", static_cast<uintptr_t>(ret));
    if (ret >= 0) TrackFd(ret);
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    // Do the real openat so the fd is valid for libuv/syscall close.
    int ret = openat(dirfd, path, flags, mode);
    int saved_errno = errno;
    RecordReplayValue("openat", 0);  // consume recorded value, keep stream in sync
    if (ret >= 0) TrackFd(ret);
    errno = saved_errno;
    return ret;
  }
  return openat(dirfd, path, flags, mode);
}

ssize_t my_read(int fd, void* buf, size_t count) {
  InterceptGuard guard;
  if (!guard) return read(fd, buf, count);

  // Socket reads: handle in both recording AND replay mode
  if (IsSocketFd(fd)) {
    if (RecordReplayIsRecording()) {
      ssize_t ret = read(fd, buf, count);
      int saved_errno = errno;
      RecordReplayValue("sockread.ret", static_cast<uintptr_t>(ret));
      if (ret > 0) RecordReplayBytes("sockread.data", buf, static_cast<size_t>(ret));
      RecordReplayValue("sockread.errno", static_cast<uintptr_t>(saved_errno));
      errno = saved_errno;
      return ret;
    }
    if (RecordReplayIsReplaying()) {
      ssize_t ret = static_cast<ssize_t>(RecordReplayValue("sockread.ret", 0));
      if (ret > 0 && buf) RecordReplayBytes("sockread.data", buf, static_cast<size_t>(ret));
      errno = static_cast<int>(RecordReplayValue("sockread.errno", 0));
      return ret;
    }
    return read(fd, buf, count);
  }

  // File reads: recording-only (replay skips file interception)
  if (RecordReplayIsReplaying()) return read(fd, buf, count);
  if (!IsTrackedFd(fd)) return read(fd, buf, count);

  if (RecordReplayIsRecording()) {
    ssize_t ret = read(fd, buf, count);
    int saved_errno = errno;
    RecordReplayValue("read.ret", static_cast<uintptr_t>(ret));
    if (ret > 0) {
      RecordReplayBytes("read.data", buf, static_cast<size_t>(ret));
    }
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    ssize_t ret = static_cast<ssize_t>(RecordReplayValue("read.ret", 0));
    if (ret > 0 && buf) {
      RecordReplayBytes("read.data", buf, static_cast<size_t>(ret));
    }
    return ret;
  }
  return read(fd, buf, count);
}

int my_close(int fd) {
  InterceptGuard guard;
  if (!guard) return close(fd);

  // Clean up socket fd tracking
  if (IsSocketFd(fd)) {
    UntrackSocketFd(fd);
    return close(fd);
  }

  if (RecordReplayIsReplaying()) return close(fd);

  bool was_tracked = IsTrackedFd(fd);
  if (was_tracked) UntrackFd(fd);

  if (!was_tracked) return close(fd);

  if (RecordReplayIsRecording()) {
    int ret = close(fd);
    RecordReplayValue("close", static_cast<uintptr_t>(ret));
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    // Do the real close so the fd is released (we opened a real fd above).
    int ret = close(fd);
    RecordReplayValue("close", 0);  // consume recorded value
    return ret;
  }
  return close(fd);
}

int my_stat(const char* path, struct stat* buf) {
  InterceptGuard guard;
  if (!guard) return stat(path, buf);
  if (RecordReplayIsReplaying()) return stat(path, buf);
  if (!ShouldInterceptPath(path)) return stat(path, buf);

  if (RecordReplayIsRecording()) {
    int ret = stat(path, buf);
    int saved_errno = errno;
    RecordReplayValue("stat.ret", static_cast<uintptr_t>(ret));
    if (ret == 0 && buf) {
      RecordReplayBytes("stat.data", buf, sizeof(*buf));
    }
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    // Do real stat to populate buf, then overwrite with recorded data
    // so replay sees the original file metadata.
    RecordReplayValue("stat.ret", 0);  // consume
    int ret = stat(path, buf);
    if (ret == 0 && buf) {
      RecordReplayBytes("stat.data", buf, sizeof(*buf));
    }
    return ret;
  }
  return stat(path, buf);
}

int my_fstat(int fd, struct stat* buf) {
  InterceptGuard guard;
  if (!guard) return fstat(fd, buf);
  if (RecordReplayIsReplaying()) return fstat(fd, buf);
  if (!IsTrackedFd(fd)) return fstat(fd, buf);

  if (RecordReplayIsRecording()) {
    int ret = fstat(fd, buf);
    int saved_errno = errno;
    RecordReplayValue("fstat.ret", static_cast<uintptr_t>(ret));
    if (ret == 0 && buf) {
      RecordReplayBytes("fstat.data", buf, sizeof(*buf));
    }
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    RecordReplayValue("fstat.ret", 0);  // consume
    int ret = fstat(fd, buf);
    if (ret == 0 && buf) {
      RecordReplayBytes("fstat.data", buf, sizeof(*buf));
    }
    return ret;
  }
  return fstat(fd, buf);
}

int my_lstat(const char* path, struct stat* buf) {
  InterceptGuard guard;
  if (!guard) return lstat(path, buf);
  if (RecordReplayIsReplaying()) return lstat(path, buf);
  if (!ShouldInterceptPath(path)) return lstat(path, buf);

  if (RecordReplayIsRecording()) {
    int ret = lstat(path, buf);
    int saved_errno = errno;
    RecordReplayValue("lstat.ret", static_cast<uintptr_t>(ret));
    if (ret == 0 && buf) {
      RecordReplayBytes("lstat.data", buf, sizeof(*buf));
    }
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    RecordReplayValue("lstat.ret", 0);  // consume
    int ret = lstat(path, buf);
    if (ret == 0 && buf) {
      RecordReplayBytes("lstat.data", buf, sizeof(*buf));
    }
    return ret;
  }
  return lstat(path, buf);
}

}  // extern "C"

// --- Platform registration ---
// --- write() interception for socket fds ---
// Only intercepts socket writes (for network replay). File writes pass through.
ssize_t my_write_intercept(int fd, const void* buf, size_t count) {
  InterceptGuard guard;
  if (!guard) return write(fd, buf, count);

  if (IsSocketFd(fd)) {
    if (RecordReplayIsRecording()) {
      ssize_t ret = write(fd, buf, count);
      int saved_errno = errno;
      RecordReplayValue("sockwrite.ret", static_cast<uintptr_t>(ret));
      errno = saved_errno;
      return ret;
    }
    if (RecordReplayIsReplaying()) {
      // Do real write — kqueue needs real socket activity.
      RecordReplayValue("sockwrite.ret", 0); // consume
      return write(fd, buf, count);
    }
  }
  return write(fd, buf, count);
}

/*
 * 【DYLD_INTERPOSE 注册】
 * macOS 特有机制：在 __DATA,__interpose section 中放置 {替换函数, 原始函数} 对。
 * dyld 加载 dylib 时自动将其他 image 中对原始函数的调用重定向到替换函数。
 * 注意：同一 dylib 内部调用原始函数不会被重定向（这是 DYLD_INTERPOSE 的设计），
 * 所以拦截函数内部调用 open() 会走真实的系统调用，不会自递归。
 */
#ifdef __APPLE__
DYLD_INTERPOSE(my_open, open)
DYLD_INTERPOSE(my_openat, openat)
DYLD_INTERPOSE(my_read, read)
// write interception disabled: Node.js uses send() for sockets (handled in net.cc)
// and write() for stdout/stderr/files (don't need interception).
// Enabling it causes issues with inspector and internal Node.js I/O.
// DYLD_INTERPOSE(my_write_intercept, write)
DYLD_INTERPOSE(my_close, close)
DYLD_INTERPOSE(my_stat, stat)
DYLD_INTERPOSE(my_fstat, fstat)
DYLD_INTERPOSE(my_lstat, lstat)
#endif
