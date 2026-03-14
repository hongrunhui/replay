// Open Replay — Thread Interception
//
// Intercepts: pthread_mutex_lock/unlock, pthread_cond_wait/signal
// For MVP, we focus on making single-threaded programs deterministic.
// Multi-thread determinism is a future goal.

#include "intercept/common.h"

#include <pthread.h>

extern "C" {

int my_pthread_mutex_lock(pthread_mutex_t* mutex) {
  InterceptGuard guard;
  if (!guard) return pthread_mutex_lock(mutex);

  if (RecordReplayIsRecording()) {
    int ret = pthread_mutex_lock(mutex);
    RecordReplayValue("pthread_mutex_lock", static_cast<uintptr_t>(ret));
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    // In replay, still acquire the lock for correctness
    int ret = pthread_mutex_lock(mutex);
    RecordReplayValue("pthread_mutex_lock", static_cast<uintptr_t>(ret));
    return ret;
  }
  return pthread_mutex_lock(mutex);
}

int my_pthread_mutex_unlock(pthread_mutex_t* mutex) {
  InterceptGuard guard;
  if (!guard) return pthread_mutex_unlock(mutex);

  if (RecordReplayIsRecording()) {
    int ret = pthread_mutex_unlock(mutex);
    RecordReplayValue("pthread_mutex_unlock", static_cast<uintptr_t>(ret));
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    int ret = pthread_mutex_unlock(mutex);
    RecordReplayValue("pthread_mutex_unlock", static_cast<uintptr_t>(ret));
    return ret;
  }
  return pthread_mutex_unlock(mutex);
}

int my_pthread_cond_wait(pthread_cond_t* cond, pthread_mutex_t* mutex) {
  InterceptGuard guard;
  if (!guard) return pthread_cond_wait(cond, mutex);

  if (RecordReplayIsRecording()) {
    int ret = pthread_cond_wait(cond, mutex);
    RecordReplayValue("pthread_cond_wait", static_cast<uintptr_t>(ret));
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    int ret = pthread_cond_wait(cond, mutex);
    RecordReplayValue("pthread_cond_wait", static_cast<uintptr_t>(ret));
    return ret;
  }
  return pthread_cond_wait(cond, mutex);
}

int my_pthread_cond_signal(pthread_cond_t* cond) {
  InterceptGuard guard;
  if (!guard) return pthread_cond_signal(cond);

  if (RecordReplayIsRecording()) {
    int ret = pthread_cond_signal(cond);
    RecordReplayValue("pthread_cond_signal", static_cast<uintptr_t>(ret));
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    int ret = pthread_cond_signal(cond);
    RecordReplayValue("pthread_cond_signal", static_cast<uintptr_t>(ret));
    return ret;
  }
  return pthread_cond_signal(cond);
}

}  // extern "C"

// --- Platform registration ---
// Note: pthread interposition is risky and disabled by default for MVP.
// Enable only when multi-thread determinism is needed.

// #ifdef __APPLE__
// DYLD_INTERPOSE(my_pthread_mutex_lock, pthread_mutex_lock)
// DYLD_INTERPOSE(my_pthread_mutex_unlock, pthread_mutex_unlock)
// DYLD_INTERPOSE(my_pthread_cond_wait, pthread_cond_wait)
// DYLD_INTERPOSE(my_pthread_cond_signal, pthread_cond_signal)
// #endif
