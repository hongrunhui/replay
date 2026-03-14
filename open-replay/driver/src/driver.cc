// Open Replay — Driver Entry Point
//
// This is the main implementation of the driver API.
// It manages the global state and delegates to recorder/replayer.

/*
 * 【架构说明】Driver 是 Open Replay 的核心入口，通过 DYLD_INSERT_LIBRARIES
 * 注入到 Node.js 进程中。它管理三种模式：IDLE / RECORDING / REPLAYING。
 *
 * 录制时：拦截系统调用（时间、随机数、文件I/O），将返回值写入 .orec 文件。
 * 回放时：从 .orec 文件读取事先录制的返回值，替代真实系统调用的结果，
 *         使程序执行路径与录制时完全一致（确定性回放）。
 *
 * 关键设计约束：
 * 1. 全局对象必须用堆分配（new），不能用 static 局部/全局对象。
 *    原因：__attribute__((constructor)) 可能在 C++ 静态构造函数之前执行，
 *    如果 RecordingWriter 是 static 对象，其内部的 mutex/vector 可能还未初始化。
 *
 * 2. 全局锁必须用 pthread_mutex_t + PTHREAD_MUTEX_INITIALIZER，不能用 std::mutex。
 *    原因同上：std::mutex 的构造函数可能还没跑过，导致 "Invalid argument" 崩溃。
 *
 * 3. 模式切换的顺序至关重要：
 *    - 录制开始：先 Open writer，再设 g_mode = RECORDING（避免拦截 writer 自身的 I/O）
 *    - 录制结束：先设 g_mode = IDLE，再 Close writer（避免拦截 close/write）
 *    这是因为 DYLD_INTERPOSE 会拦截同一进程中所有 image 的系统调用。
 */

#include "driver.h"
#include "format/recording.h"
#include "checkpoint/checkpoint.h"
#include "raw_syscall.h"

#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>
#include <mutex>
#include <pthread.h>

#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

#ifdef __APPLE__
#include <uuid/uuid.h>
#include <crt_externs.h>  // _NSGetArgc / _NSGetArgv
#else
#include <fcntl.h>
#endif

/*
 * 【重入深度计数器】所有拦截编译单元（fs.cc, time.cc, net.cc 等）共享此变量。
 * 当 g_intercept_depth > 0 时，说明当前正在执行拦截逻辑内部，
 * 此时任何新的系统调用都不应该被再次拦截，否则会无限递归。
 * 声明为 extern（在 common.h 中），确保所有 TU 看到的是同一个实例。
 */
int g_intercept_depth = 0;

namespace openreplay {

// --- Global state ---

static Mode g_mode = Mode::IDLE;
static std::string g_recording_id;
static std::string g_recording_path;
static std::string g_build_id;

// Use heap-allocated objects to avoid static initialization order issues.
// __attribute__((constructor)) may run before C++ static constructors,
// so we can't use static RecordingWriter/Reader objects.
static RecordingWriter* g_writer_ptr = nullptr;
static RecordingReader* g_reader_ptr = nullptr;
static CheckpointManager* g_checkpoints_ptr = nullptr;

static RecordingWriter& writer() {
  if (!g_writer_ptr) g_writer_ptr = new RecordingWriter();
  return *g_writer_ptr;
}
static RecordingReader& reader() {
  if (!g_reader_ptr) g_reader_ptr = new RecordingReader();
  return *g_reader_ptr;
}
static CheckpointManager& checkpoints() {
  if (!g_checkpoints_ptr) g_checkpoints_ptr = new CheckpointManager();
  return *g_checkpoints_ptr;
}

/*
 * 【V8 进度计数器】这两个变量是 driver 与 V8 引擎通信的桥梁。
 * g_progress_counter：V8 的 IncExecutionProgressCounter 字节码每执行一次就 +1，
 *   代表程序执行到了"第几步"。回放时用它来精确定位断点位置。
 * g_target_progress：回放服务器设定的目标进度，当 counter 达到 target 时触发暂停。
 * V8 通过 dlsym 获取这两个变量的地址（见 patches/node/node-recordreplay.cc）。
 */
static uint64_t g_progress_counter = 0;
static uint64_t g_target_progress = 0;

static CDPMessageCallback g_cdp_callback = nullptr;

/*
 * 【fork() 检查点系统】
 *
 * 回放时每隔 N 个时间事件，调用 fork() 创建子进程快照。
 * 子进程通过 COW（Copy-On-Write）保留父进程的完整内存状态，
 * 然后 pause() 等待信号。
 *
 * 当需要"回退"时：
 * 1. 杀掉当前进程
 * 2. 给最近的检查点子进程发 SIGUSR1
 * 3. 子进程醒来，继续执行（从检查点处的状态恢复）
 *
 * 限制：子进程醒来后没有 inspector 连接，需要重新建立。
 * 当前实现是 MVP——先证明 fork 快照能工作。
 */
static constexpr int MAX_FORK_CHECKPOINTS = 64;
struct ForkCheckpoint {
  pid_t pid;
  uint64_t event_index;  // reader cursor position at fork time
};
static ForkCheckpoint g_fork_checkpoints[MAX_FORK_CHECKPOINTS];
static int g_fork_checkpoint_count = 0;
static int g_replay_event_count = 0;  // events consumed so far
static constexpr int FORK_CHECKPOINT_INTERVAL = 500;  // fork every N events
// Use pthread_mutex_t with static initializer — safe before C++ constructors run
static pthread_mutex_t g_mutex = PTHREAD_MUTEX_INITIALIZER;

Mode GetMode() { return g_mode; }
const char* GetRecordingPath() { return g_recording_path.c_str(); }

// Generate a UUID for the recording
static std::string GenerateRecordingId() {
#ifdef __APPLE__
  uuid_t uuid;
  uuid_generate(uuid);
  char str[37];
  uuid_unparse_lower(uuid, str);
  return std::string(str);
#else
  // Linux: read from /proc/sys/kernel/random/uuid
  int fd = ::open("/proc/sys/kernel/random/uuid", O_RDONLY);
  if (fd >= 0) {
    char buf[37] = {};
    ::read(fd, buf, 36);
    ::close(fd);
    return std::string(buf, 36);
  }
  // Fallback: timestamp-based
  return "rec-" + std::to_string(time(nullptr));
#endif
}

// Get default recordings directory
static std::string GetRecordingsDir() {
  const char* home = getenv("HOME");
  if (!home) home = "/tmp";
  std::string dir = std::string(home) + "/.openreplay/recordings";
  return dir;
}

}  // namespace openreplay

using namespace openreplay;

// ============================================================
// Exported C API
// ============================================================

extern "C" {

void RecordReplayAttach(const char* dispatch, const char* build_id) {
  pthread_mutex_lock(&g_mutex);

  if (build_id) g_build_id = build_id;

  if (strcmp(dispatch, "record") == 0) {
    g_recording_id = GenerateRecordingId();

    // Determine recording path
    if (g_recording_path.empty()) {
      std::string dir = GetRecordingsDir();
      g_recording_path = dir + "/" + g_recording_id + ".orec";
    }

    // Ensure directory exists (use raw syscall to avoid interception)
    std::string dir = g_recording_path.substr(0, g_recording_path.rfind('/'));
    raw::mkdirp(dir.c_str());

    // Open writer BEFORE setting mode, so open()/write() aren't intercepted
    writer().Open(g_recording_path.c_str(), build_id);
    g_progress_counter = 0;
    g_target_progress = 0;

    // NOW enable interception
    g_mode = Mode::RECORDING;

    fprintf(stderr, "[openreplay] Recording to: %s\n", g_recording_path.c_str());
    fprintf(stderr, "[openreplay] Recording ID: %s\n", g_recording_id.c_str());

  } else if (strcmp(dispatch, "replay") == 0) {
    if (g_recording_path.empty()) {
      const char* env_path = getenv("REPLAY_RECORDING");
      if (env_path) g_recording_path = env_path;
    }

    // Open reader BEFORE setting mode
    if (!reader().Open(g_recording_path.c_str())) {
      fprintf(stderr, "[openreplay] Failed to open recording for replay\n");
      pthread_mutex_unlock(&g_mutex);
      return;
    }

    g_progress_counter = 0;
    g_target_progress = 0;

    // NOW enable interception
    g_mode = Mode::REPLAYING;
    fprintf(stderr, "[openreplay] Replaying: %s\n", g_recording_path.c_str());
  }

  pthread_mutex_unlock(&g_mutex);
}

void RecordReplayFinishRecording() {
  pthread_mutex_lock(&g_mutex);
  if (g_mode != Mode::RECORDING) {
    pthread_mutex_unlock(&g_mutex);
    return;
  }
  // Disable interception BEFORE closing to avoid intercepting close/write
  g_mode = Mode::IDLE;
  writer().Close();
  fprintf(stderr, "[openreplay] Recording finished: %s\n", g_recording_id.c_str());
  pthread_mutex_unlock(&g_mutex);
}

void RecordReplayDetach() {
  pthread_mutex_lock(&g_mutex);
  Mode prev = g_mode;
  // Disable interception BEFORE cleanup
  g_mode = Mode::IDLE;
  if (prev == Mode::RECORDING) {
    writer().Close();
  } else if (prev == Mode::REPLAYING) {
    reader().PrintReplayReport();
    reader().Close();
  }
  pthread_mutex_unlock(&g_mutex);
}

const char* RecordReplayGetRecordingId() {
  return g_recording_id.c_str();
}

void RecordReplaySetRecordingPath(const char* path) {
  g_recording_path = path ? path : "";
}

int RecordReplayIsRecordingOrReplaying() {
  return g_mode != Mode::IDLE ? 1 : 0;
}

int RecordReplayIsRecording() {
  return g_mode == Mode::RECORDING ? 1 : 0;
}

int RecordReplayIsReplaying() {
  return g_mode == Mode::REPLAYING ? 1 : 0;
}

/*
 * 【事件录制/回放的核心 API】
 * RecordReplayValue / RecordReplayBytes / RecordReplayString
 *
 * "why" 参数是调用点的语义标识（如 "open", "read.ret", "gettimeofday"），
 * 经 FNV 哈希后存入事件流。回放时，Reader 按相同的 why_hash 查找下一个匹配事件，
 * 实现"按语义对齐"而非"按序号对齐"——这使得录制和回放可以容忍少量事件顺序差异。
 */
uintptr_t RecordReplayValue(const char* why, uintptr_t value) {
  if (g_mode == Mode::RECORDING) {
    writer().WriteEvent(EventType::VALUE, why, &value, sizeof(value));
    return value;
  }
  if (g_mode == Mode::REPLAYING) {
    g_replay_event_count++;

    // Periodically create fork checkpoints during replay
    if (g_replay_event_count % FORK_CHECKPOINT_INTERVAL == 0 &&
        g_fork_checkpoint_count < MAX_FORK_CHECKPOINTS) {
      RecordReplayForkCheckpoint();
    }

    const auto* ev = reader().NextEvent(why);
    if (ev && ev->data.size() >= sizeof(uintptr_t)) {
      uintptr_t result;
      memcpy(&result, ev->data.data(), sizeof(result));
      return result;
    }
  }
  return value;
}

int RecordReplayBytes(const char* why, void* buf, size_t size) {
  if (g_mode == Mode::RECORDING) {
    writer().WriteEvent(EventType::BYTES, why, buf, size);
    return 1;
  }
  if (g_mode == Mode::REPLAYING) {
    const auto* ev = reader().NextEvent(why);
    if (ev && buf && !ev->data.empty()) {
      size_t copy_len = ev->data.size() < size ? ev->data.size() : size;
      memcpy(buf, ev->data.data(), copy_len);
      return 1;  // event found and applied
    }
    return 0;  // events exhausted — caller should fall back
  }
  return 0;
}

void RecordReplayString(const char* why, std::string& str) {
  if (g_mode == Mode::RECORDING) {
    writer().WriteEvent(EventType::STRING, why, str.data(), str.size());
  } else if (g_mode == Mode::REPLAYING) {
    const auto* ev = reader().NextEvent(why);
    if (ev) {
      str.assign(reinterpret_cast<const char*>(ev->data.data()), ev->data.size());
    }
  }
}

uint64_t* RecordReplayProgressCounter() {
  return &g_progress_counter;
}

uint64_t* RecordReplayTargetProgress() {
  return &g_target_progress;
}

void RecordReplayOnProgressReached(uint64_t progress) {
  if (g_mode == Mode::RECORDING) {
    if (checkpoints().ShouldAutoCheckpoint(progress)) {
      RecordReplayNewCheckpoint();
    }
  }
}

void RecordReplayNewCheckpoint() {
  if (g_mode == Mode::RECORDING) {
    uint32_t id = checkpoints().CreateCheckpoint(g_progress_counter);
    writer().WriteCheckpoint(g_progress_counter);
    fprintf(stderr, "[openreplay] Checkpoint #%u at progress %llu\n",
            id, g_progress_counter);
  }
}

uint32_t RecordReplayGetCheckpointCount() {
  return checkpoints().Count();
}

void RecordReplaySendCDPMessage(const char* message, size_t length) {
  // TODO: implement CDP message routing
  (void)message;
  (void)length;
}

void RecordReplaySetCDPCallback(CDPMessageCallback callback) {
  g_cdp_callback = callback;
}

int RecordReplayForkCheckpoint() {
  if (g_mode != Mode::REPLAYING) return -1;
  if (g_fork_checkpoint_count >= MAX_FORK_CHECKPOINTS) return -1;

  pid_t pid = fork();
  if (pid < 0) return -1;  // fork failed

  if (pid == 0) {
    // Child process: this IS the checkpoint.
    // Use SIGCONT to resume, SIGTERM to die.
    // SIGUSR1 is reserved for Node.js inspector activation.
    sigset_t set;
    sigemptyset(&set);
    sigaddset(&set, SIGCONT);
    sigaddset(&set, SIGTERM);
    int sig;
    sigwait(&set, &sig);

    if (sig == SIGTERM) _exit(0);

    // SIGCONT received — we're being restored!
    fprintf(stderr, "[openreplay] Checkpoint restored (pid %d, events %d)\n",
            getpid(), g_replay_event_count);
    return g_fork_checkpoint_count;  // return our index
  }

  // Parent process: record the checkpoint
  int idx = g_fork_checkpoint_count++;
  g_fork_checkpoints[idx].pid = pid;
  g_fork_checkpoints[idx].event_index = g_replay_event_count;
  fprintf(stderr, "[openreplay] Fork checkpoint #%d created (child pid %d, events %d)\n",
          idx, pid, g_replay_event_count);
  return idx;
}

int RecordReplayRestoreCheckpoint(int checkpoint_index) {
  if (checkpoint_index < 0 || checkpoint_index >= g_fork_checkpoint_count) return -1;
  pid_t pid = g_fork_checkpoints[checkpoint_index].pid;
  // Wake up the checkpoint child with SIGCONT
  if (kill(pid, SIGCONT) != 0) return -1;
  return pid;
}

int RecordReplayGetForkCheckpointCount() {
  return g_fork_checkpoint_count;
}

// Clean up all fork checkpoint children on exit
static void cleanup_fork_checkpoints() {
  for (int i = 0; i < g_fork_checkpoint_count; i++) {
    kill(g_fork_checkpoints[i].pid, SIGTERM);
    waitpid(g_fork_checkpoints[i].pid, nullptr, WNOHANG);
  }
  g_fork_checkpoint_count = 0;
}

void RecordReplayLog(const char* format, ...) {
  va_list args;
  va_start(args, format);
  fprintf(stderr, "[openreplay] ");
  vfprintf(stderr, format, args);
  fprintf(stderr, "\n");
  va_end(args);
}

const char* RecordReplayGetMetadata() {
  if (g_mode == Mode::REPLAYING && g_reader_ptr) {
    return g_reader_ptr->metadata().c_str();
  }
  return nullptr;
}

void RecordReplaySetMetadata(const char* json) {
  pthread_mutex_lock(&g_mutex);
  if (g_mode == Mode::RECORDING) {
    writer().WriteMetadata(json ? json : "{}");
  }
  pthread_mutex_unlock(&g_mutex);
}

}  // extern "C"

// ============================================================
// Auto-init via environment variables
// ============================================================
/*
 * 【自动初始化机制】
 * 通过 __attribute__((constructor)) 在 dylib 加载时自动执行。
 * 读取 OPENREPLAY_MODE 环境变量决定进入录制/回放模式。
 *
 * 录制模式还会收集元数据（脚本路径、argv），写入 METADATA 事件。
 * 脚本路径会 realpath() 解析为绝对路径，确保回放时不受 cwd 影响。
 *
 * 注意：constructor 内不能调用 dlsym 查找 V8 符号，
 * 因为此时 V8 尚未初始化，dlsym 会死锁（dyld 加载锁重入）。
 */

static void openreplay_shutdown_handler() {
  RecordReplayDetach();
}

__attribute__((constructor))
static void openreplay_auto_init() {
  const char* mode = getenv("OPENREPLAY_MODE");
  if (!mode) mode = getenv("RECORD_ALL_CONTENT");

  if (mode) {
    const char* dispatch = "record";
    if (strcmp(mode, "replay") == 0) dispatch = "replay";
    RecordReplayAttach(dispatch, "auto");

    // Store script path and argv in metadata (recording mode only)
    if (strcmp(dispatch, "record") == 0) {
#ifdef __APPLE__
      int argc = *_NSGetArgc();
      char** argv = *_NSGetArgv();
#else
      int argc = 0;
      char** argv = nullptr;
      // Linux: read from /proc/self/cmdline
      // (simplified: just use OPENREPLAY_SCRIPT env if set)
#endif
      std::string json = "{";

      // Script path: argv[1] for `node script.js` invocations.
      // Resolve to absolute path so replay can find the script regardless of cwd.
      const char* script_env = getenv("OPENREPLAY_SCRIPT");
      const char* script_raw = script_env;
      if (!script_raw && argc >= 2) script_raw = argv[1];

      // Resolve to absolute path
      std::string script_abs;
      if (script_raw) {
        char resolved[4096] = {};
        if (realpath(script_raw, resolved)) {
          script_abs = resolved;
        } else {
          script_abs = script_raw;  // fallback to raw
        }
      }

      const char* script = script_abs.empty() ? nullptr : script_abs.c_str();
      if (script) {
        json += "\"scriptPath\":\"";
        for (const char* c = script; *c; c++) {
          if (*c == '"') json += "\\\"";
          else if (*c == '\\') json += "\\\\";
          else json += *c;
        }
        json += "\"";
      }

      // Store the random seed (used for deterministic Math.random())
      const char* seed = getenv("OPENREPLAY_RANDOM_SEED");
      if (seed) {
        if (script) json += ",";
        json += "\"randomSeed\":";
        json += seed;
      }

      json += "}";
      RecordReplaySetMetadata(json.c_str());
    }

    atexit(openreplay_shutdown_handler);
    atexit(cleanup_fork_checkpoints);
  }
}

__attribute__((destructor))
static void openreplay_auto_shutdown() {
  cleanup_fork_checkpoints();
  RecordReplayDetach();
}
