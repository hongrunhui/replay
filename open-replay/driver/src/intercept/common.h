// Open Replay — System Call Interception: Common Utilities
//
// Shared interception infrastructure: guard, platform macros, registration.

#ifndef OPENREPLAY_INTERCEPT_COMMON_H_
#define OPENREPLAY_INTERCEPT_COMMON_H_

#include "driver.h"

#ifdef __APPLE__
#include <mach/mach_time.h>
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
#else
#include <dlfcn.h>
// Linux: resolve original function via dlsym
#define REAL_FUNC(name) \
  static auto real_##name = reinterpret_cast<decltype(&name)>(dlsym(RTLD_NEXT, #name))
#endif

// Re-entrancy guard — prevents infinite recursion when intercepted
// functions are called by the driver itself (e.g., write → Record → write).
//
// Cannot use thread_local here because TLS may not be initialized during
// early dyld bootstrap (macOS). Using a plain global counter.
// Declared extern so all TUs share the same counter.
// TODO: switch to pthread_getspecific for multi-thread support.
extern int g_intercept_depth;

struct InterceptGuard {
  bool active;
  InterceptGuard() : active(g_intercept_depth == 0 &&
                            RecordReplayIsRecordingOrReplaying()) {
    g_intercept_depth++;
  }
  ~InterceptGuard() { g_intercept_depth--; }
  operator bool() const { return active; }
};

#endif  // OPENREPLAY_INTERCEPT_COMMON_H_
