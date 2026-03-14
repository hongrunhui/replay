// Open Replay — Time Function Interception
//
// Intercepts: gettimeofday, clock_gettime, time, mach_absolute_time (macOS)

#include "intercept/common.h"

#include <cstring>
#include <sys/time.h>
#include <time.h>

extern "C" {

int my_gettimeofday(struct timeval* tv, void* tz) {
  InterceptGuard guard;
  if (!guard) return gettimeofday(tv, tz);

  if (RecordReplayIsRecording()) {
    int ret = gettimeofday(tv, tz);
    if (tv) RecordReplayBytes("gettimeofday", tv, sizeof(*tv));
    return static_cast<int>(RecordReplayValue("gettimeofday.ret",
        static_cast<uintptr_t>(ret)));
  }
  if (RecordReplayIsReplaying()) {
    if (tv) RecordReplayBytes("gettimeofday", tv, sizeof(*tv));
    return static_cast<int>(RecordReplayValue("gettimeofday.ret", 0));
  }
  return gettimeofday(tv, tz);
}

int my_clock_gettime(clockid_t clk_id, struct timespec* tp) {
  InterceptGuard guard;
  if (!guard) return clock_gettime(clk_id, tp);

  if (RecordReplayIsRecording()) {
    int ret = clock_gettime(clk_id, tp);
    if (tp) RecordReplayBytes("clock_gettime", tp, sizeof(*tp));
    return static_cast<int>(RecordReplayValue("clock_gettime.ret",
        static_cast<uintptr_t>(ret)));
  }
  if (RecordReplayIsReplaying()) {
    if (tp) RecordReplayBytes("clock_gettime", tp, sizeof(*tp));
    return static_cast<int>(RecordReplayValue("clock_gettime.ret", 0));
  }
  return clock_gettime(clk_id, tp);
}

time_t my_time(time_t* tloc) {
  InterceptGuard guard;
  if (!guard) return time(tloc);

  if (RecordReplayIsRecording()) {
    time_t ret = time(tloc);
    return static_cast<time_t>(RecordReplayValue("time",
        static_cast<uintptr_t>(ret)));
  }
  if (RecordReplayIsReplaying()) {
    time_t ret = static_cast<time_t>(RecordReplayValue("time", 0));
    if (tloc) *tloc = ret;
    return ret;
  }
  return time(tloc);
}

#ifdef __APPLE__
uint64_t my_mach_absolute_time() {
  InterceptGuard guard;
  if (!guard) return mach_absolute_time();

  if (RecordReplayIsRecording()) {
    uint64_t ret = mach_absolute_time();
    return static_cast<uint64_t>(RecordReplayValue("mach_absolute_time",
        static_cast<uintptr_t>(ret)));
  }
  if (RecordReplayIsReplaying()) {
    return static_cast<uint64_t>(RecordReplayValue("mach_absolute_time", 0));
  }
  return mach_absolute_time();
}
#endif

}  // extern "C"

// --- Platform registration ---

#ifdef __APPLE__
DYLD_INTERPOSE(my_gettimeofday, gettimeofday)
DYLD_INTERPOSE(my_clock_gettime, clock_gettime)
DYLD_INTERPOSE(my_time, time)
DYLD_INTERPOSE(my_mach_absolute_time, mach_absolute_time)
#endif
