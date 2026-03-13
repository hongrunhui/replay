// Copyright 2024 V8 Recorder Project
// libc interception implementation
//
// On macOS: uses DYLD_INTERPOSE (__DATA,__interpose section)
// On Linux: uses LD_PRELOAD with same-name symbol override
//
// In recording mode: calls real function, records return value + output data.
// In replay mode: returns recorded values without calling real function.

#define _GNU_SOURCE
#include "src/intercept/intercept.h"

#include <cstring>
#include <cstdarg>
#include <cstdlib>
#include <dlfcn.h>
#include <errno.h>
#include <iostream>
#include <vector>
#include <sys/time.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <fcntl.h>

#ifdef __APPLE__
#include <mach/mach_time.h>
#include <sys/random.h>  // getentropy on macOS
// macOS interposition macro
#define DYLD_INTERPOSE(_replacement, _original) \
  __attribute__((used)) static struct { \
    const void* replacement; \
    const void* original; \
  } _interpose_##_original \
  __attribute__((section("__DATA,__interpose"))) = { \
    (const void*)(unsigned long)&_replacement, \
    (const void*)(unsigned long)&_original \
  };
#endif

namespace v8_recorder {

void InterceptInit(const char* mode, const char* path) {
  if (strcmp(mode, "record") == 0) {
    GetStream()->Open(path);       // Open FIRST
    SetMode(Mode::RECORDING);      // Then enable interception
  } else if (strcmp(mode, "replay") == 0) {
    GetStream()->Load(path);       // Load FIRST
    SetMode(Mode::REPLAYING);      // Then enable interception
  }
}

void InterceptShutdown() {
  if (GetMode() == Mode::RECORDING) {
    GetStream()->Close();
  }
  SetMode(Mode::IDLE);
}

}  // namespace v8_recorder

using namespace v8_recorder;

// Re-entrancy guard — prevents infinite recursion when our intercepted
// functions are called by the recording stream itself (e.g., write → Record → write)
//
// IMPORTANT: Cannot use __thread / thread_local here because TLS is not yet
// initialized when dyld calls our interposed functions during libSystem_initializer
// (malloc init → arc4random → getentropy → our hook → TLS access → abort).
// Using a plain global int. This is not thread-safe for concurrent calls, but
// it's safe enough for the bootstrap phase and single-threaded programs.
// TODO: switch to pthread_getspecific once we need multi-thread support.
static int g_intercept_depth = 0;

struct InterceptGuard {
  bool active;
  InterceptGuard() : active(g_intercept_depth == 0 && GetMode() != Mode::IDLE) {
    g_intercept_depth++;
  }
  ~InterceptGuard() { g_intercept_depth--; }
  operator bool() const { return active; }
};

// ============================================================
// Time interception
// ============================================================

extern "C" {

int my_gettimeofday(struct timeval* tv, void* tz) {
  InterceptGuard guard;
  if (!guard) return gettimeofday(tv, tz);
  if (GetMode() == Mode::RECORDING) {
    int ret = gettimeofday(tv, tz);
    if (tv) GetStream()->Record(CallType::GETTIMEOFDAY, ret, tv, sizeof(*tv));
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::GETTIMEOFDAY);
    if (call && tv) {
      const uint8_t* data = GetStream()->GetData(call);
      if (data) memcpy(tv, data, sizeof(*tv));
      return call->return_value;
    }
  }
  return gettimeofday(tv, tz);
}

int my_clock_gettime(clockid_t clk_id, struct timespec* tp) {
  InterceptGuard guard;
  if (!guard) return clock_gettime(clk_id, tp);
  if (GetMode() == Mode::RECORDING) {
    int ret = clock_gettime(clk_id, tp);
    if (tp) {
      uint8_t buf[4 + sizeof(struct timespec)];
      memcpy(buf, &clk_id, 4);
      memcpy(buf + 4, tp, sizeof(*tp));
      GetStream()->Record(CallType::CLOCK_GETTIME, ret, buf, sizeof(buf));
    }
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::CLOCK_GETTIME);
    if (call && tp) {
      const uint8_t* data = GetStream()->GetData(call);
      if (data) memcpy(tp, data + 4, sizeof(*tp));
      return call->return_value;
    }
  }
  return clock_gettime(clk_id, tp);
}

time_t my_time(time_t* tloc) {
  InterceptGuard guard;
  if (!guard) return time(tloc);
  if (GetMode() == Mode::RECORDING) {
    time_t ret = time(tloc);
    GetStream()->Record(CallType::TIME, static_cast<int32_t>(ret), &ret, sizeof(ret));
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::TIME);
    if (call) {
      time_t ret = 0;
      const uint8_t* data = GetStream()->GetData(call);
      if (data) memcpy(&ret, data, sizeof(ret));
      if (tloc) *tloc = ret;
      return ret;
    }
  }
  return time(tloc);
}

#ifdef __APPLE__
uint64_t my_mach_absolute_time() {
  InterceptGuard guard;
  if (!guard) return mach_absolute_time();
  if (GetMode() == Mode::RECORDING) {
    uint64_t ret = mach_absolute_time();
    GetStream()->Record(CallType::MACH_ABSOLUTE_TIME, 0, &ret, sizeof(ret));
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::MACH_ABSOLUTE_TIME);
    if (call) {
      uint64_t ret = 0;
      const uint8_t* data = GetStream()->GetData(call);
      if (data) memcpy(&ret, data, sizeof(ret));
      return ret;
    }
  }
  return mach_absolute_time();
}
#endif

// ============================================================
// Random number interception
// ============================================================

uint32_t my_arc4random() {
  InterceptGuard guard;
  if (!guard) return arc4random();
  if (GetMode() == Mode::RECORDING) {
    uint32_t ret = arc4random();
    GetStream()->Record(CallType::ARC4RANDOM, static_cast<int32_t>(ret));
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::ARC4RANDOM);
    if (call) return static_cast<uint32_t>(call->return_value);
  }
  return arc4random();
}

void my_arc4random_buf(void* buf, size_t nbytes) {
  InterceptGuard guard;
  if (!guard) { arc4random_buf(buf, nbytes); return; }
  if (GetMode() == Mode::RECORDING) {
    arc4random_buf(buf, nbytes);
    GetStream()->Record(CallType::ARC4RANDOM_BUF, 0, buf, nbytes);
    return;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::ARC4RANDOM_BUF);
    if (call && buf) {
      const uint8_t* data = GetStream()->GetData(call);
      if (data) memcpy(buf, data, nbytes < call->data_len ? nbytes : call->data_len);
      return;
    }
  }
  arc4random_buf(buf, nbytes);
}

int my_getentropy(void* buf, size_t buflen) {
  InterceptGuard guard;
  if (!guard) return getentropy(buf, buflen);
  if (GetMode() == Mode::RECORDING) {
    int ret = getentropy(buf, buflen);
    GetStream()->Record(CallType::GETENTROPY, ret,
                        ret == 0 ? buf : nullptr,
                        ret == 0 ? buflen : 0);
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::GETENTROPY);
    if (call) {
      if (call->return_value == 0 && buf) {
        const uint8_t* data = GetStream()->GetData(call);
        if (data) memcpy(buf, data, buflen < call->data_len ? buflen : call->data_len);
      }
      return call->return_value;
    }
  }
  return getentropy(buf, buflen);
}

// ============================================================
// File I/O interception
// ============================================================

int my_open(const char* path, int flags, ...) {
  // Extract optional mode argument
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list ap;
    va_start(ap, flags);
    mode = va_arg(ap, int);
    va_end(ap);
  }
  InterceptGuard guard;
  if (!guard) return open(path, flags, mode);
  if (GetMode() == Mode::RECORDING) {
    int ret = open(path, flags, mode);
    int saved_errno = errno;
    // Record: [4-byte flags][4-byte fd(=ret)][null-terminated path]
    size_t pathlen = strlen(path);
    std::vector<uint8_t> payload(4 + 4 + pathlen + 1);
    memcpy(payload.data(), &flags, 4);
    memcpy(payload.data() + 4, &ret, 4);
    memcpy(payload.data() + 8, path, pathlen + 1);
    GetStream()->Record(CallType::OPEN, static_cast<int32_t>(ret),
                        payload.data(), payload.size());
    errno = saved_errno;
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::OPEN);
    if (call) return call->return_value;
  }
  return open(path, flags, mode);
}

// openat — node uses this instead of open() on macOS
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
  if (GetMode() == Mode::RECORDING) {
    int ret = openat(dirfd, path, flags, mode);
    int saved_errno = errno;
    // Record same format as open: [4-byte flags][4-byte fd(=ret)][null-terminated path]
    size_t pathlen = strlen(path);
    std::vector<uint8_t> payload(4 + 4 + pathlen + 1);
    memcpy(payload.data(), &flags, 4);
    memcpy(payload.data() + 4, &ret, 4);
    memcpy(payload.data() + 8, path, pathlen + 1);
    GetStream()->Record(CallType::OPEN, static_cast<int32_t>(ret),
                        payload.data(), payload.size());
    errno = saved_errno;
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::OPEN);
    if (call) return call->return_value;
  }
  return openat(dirfd, path, flags, mode);
}

ssize_t my_read(int fd, void* buf, size_t count) {
  InterceptGuard guard;
  if (!guard) return read(fd, buf, count);
  if (GetMode() == Mode::RECORDING) {
    ssize_t ret = read(fd, buf, count);
    int saved_errno = errno;
    if (ret > 0) {
      std::vector<uint8_t> payload(4 + ret);
      memcpy(payload.data(), &fd, 4);
      memcpy(payload.data() + 4, buf, ret);
      GetStream()->Record(CallType::READ, static_cast<int32_t>(ret),
                          payload.data(), payload.size());
    } else {
      GetStream()->Record(CallType::READ, static_cast<int32_t>(ret), &fd, 4);
    }
    errno = saved_errno;
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::READ);
    if (call) {
      if (call->return_value > 0 && buf) {
        const uint8_t* data = GetStream()->GetData(call);
        if (data && call->data_len > 4) {
          size_t to_copy = call->data_len - 4;
          if (to_copy > count) to_copy = count;
          memcpy(buf, data + 4, to_copy);
        }
      }
      return static_cast<ssize_t>(call->return_value);
    }
  }
  return read(fd, buf, count);
}

ssize_t my_write(int fd, const void* buf, size_t count) {
  InterceptGuard guard;
  if (!guard) return write(fd, buf, count);
  if (GetMode() == Mode::RECORDING) {
    ssize_t ret = write(fd, buf, count);
    int saved_errno = errno;
    // Capture stdout/stderr content for viewer playback
    if ((fd == STDOUT_FILENO || fd == STDERR_FILENO) && ret > 0) {
      std::vector<uint8_t> payload(4 + ret);
      memcpy(payload.data(), &fd, 4);
      memcpy(payload.data() + 4, buf, ret);
      GetStream()->Record(CallType::WRITE, static_cast<int32_t>(ret),
                          payload.data(), payload.size());
    } else {
      GetStream()->Record(CallType::WRITE, static_cast<int32_t>(ret), &fd, 4);
    }
    errno = saved_errno;
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::WRITE);
    if (call) {
      write(fd, buf, count);  // Still write for stdout/stderr
      return static_cast<ssize_t>(call->return_value);
    }
  }
  return write(fd, buf, count);
}

int my_stat(const char* path, struct stat* buf) {
  InterceptGuard guard;
  if (!guard) return stat(path, buf);
  if (GetMode() == Mode::RECORDING) {
    int ret = stat(path, buf);
    int saved_errno = errno;
    GetStream()->Record(CallType::STAT, ret,
                        ret == 0 ? buf : nullptr,
                        ret == 0 ? sizeof(*buf) : 0);
    errno = saved_errno;
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::STAT);
    if (call) {
      if (call->return_value == 0 && buf) {
        const uint8_t* data = GetStream()->GetData(call);
        if (data) memcpy(buf, data, sizeof(*buf));
      }
      return call->return_value;
    }
  }
  return stat(path, buf);
}

int my_fstat(int fd, struct stat* buf) {
  InterceptGuard guard;
  if (!guard) return fstat(fd, buf);
  if (GetMode() == Mode::RECORDING) {
    int ret = fstat(fd, buf);
    int saved_errno = errno;
    GetStream()->Record(CallType::FSTAT, ret,
                        ret == 0 ? buf : nullptr,
                        ret == 0 ? sizeof(*buf) : 0);
    errno = saved_errno;
    return ret;
  }
  if (GetMode() == Mode::REPLAYING) {
    const auto* call = GetStream()->Next(CallType::FSTAT);
    if (call) {
      if (call->return_value == 0 && buf) {
        const uint8_t* data = GetStream()->GetData(call);
        if (data) memcpy(buf, data, sizeof(*buf));
      }
      return call->return_value;
    }
  }
  return fstat(fd, buf);
}

}  // extern "C"

// ============================================================
// macOS DYLD_INTERPOSE registrations
// ============================================================

#ifdef __APPLE__
// Only interpose time and random functions for now.
// File I/O interposition (read/write/stat/fstat) is commented out
// because it can cause issues during dylib loading.
DYLD_INTERPOSE(my_gettimeofday, gettimeofday)
DYLD_INTERPOSE(my_clock_gettime, clock_gettime)
DYLD_INTERPOSE(my_time, time)
DYLD_INTERPOSE(my_mach_absolute_time, mach_absolute_time)
DYLD_INTERPOSE(my_arc4random, arc4random)
DYLD_INTERPOSE(my_arc4random_buf, arc4random_buf)
DYLD_INTERPOSE(my_getentropy, getentropy)
DYLD_INTERPOSE(my_open, open)
DYLD_INTERPOSE(my_openat, openat)
DYLD_INTERPOSE(my_read, read)
DYLD_INTERPOSE(my_write, write)
// DYLD_INTERPOSE(my_stat, stat)       // TODO: enable after adding path filtering
// DYLD_INTERPOSE(my_fstat, fstat)     // TODO: enable after adding fd filtering
#endif

// ============================================================
// Constructor/destructor for auto-init via env vars
// ============================================================

__attribute__((constructor))
static void v8_recorder_auto_init() {
  const char* mode = getenv("V8_RECORDER_MODE");
  const char* path = getenv("V8_RECORDER_FILE");
  if (mode && path) {
    v8_recorder::InterceptInit(mode, path);
  }
}

__attribute__((destructor))
static void v8_recorder_auto_shutdown() {
  v8_recorder::InterceptShutdown();
}
