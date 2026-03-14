// Open Replay — Time Function Interception
//
// Intercepts: gettimeofday, clock_gettime, time, mach_absolute_time (macOS)
//
// Replay strategy: when recorded events are available, return them exactly.
// When events are exhausted (replay makes more calls than recording due to
// libuv internal differences), extrapolate from the last recorded value
// using real elapsed time. This avoids returning garbage/zero values.

#include "intercept/common.h"

#include <cstring>
#include <sys/time.h>
#include <time.h>

/*
 * 【时间事件耗尽后的外推机制】
 *
 * 问题：回放时 libuv/inspector 的内部时间调用次数可能多于录制时，
 * 导致 per-why-hash 游标耗尽。如果直接返回 0 或不修改 buf，
 * Node.js 会得到垃圾时间值（如 1970 年），导致 setTimeout delta 变为负天文数字。
 *
 * 解决：记录最后一个成功回放的时间值和对应的真实时间。
 * 当事件耗尽后，用 "最后录制值 + 真实流逝" 外推，保持时间单调递增。
 */

// --- Extrapolation state for gettimeofday ---
static struct timeval g_last_gtod_recorded = {};
static struct timeval g_last_gtod_real = {};
static bool g_gtod_has_last = false;

// --- Extrapolation state for mach_absolute_time ---
#ifdef __APPLE__
static uint64_t g_last_mach_recorded = 0;
static uint64_t g_last_mach_real = 0;
#endif

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
    if (tv) {
      struct timeval recorded_tv;
      if (RecordReplayBytes("gettimeofday", &recorded_tv, sizeof(recorded_tv))) {
        // Event available — use it and save for extrapolation
        *tv = recorded_tv;
        g_last_gtod_recorded = recorded_tv;
        gettimeofday(&g_last_gtod_real, nullptr);
        g_gtod_has_last = true;
        return static_cast<int>(RecordReplayValue("gettimeofday.ret", 0));
      }
      // Events exhausted — extrapolate from last recorded value
      if (g_gtod_has_last) {
        struct timeval real_now;
        gettimeofday(&real_now, nullptr);
        // delta = real_now - real_at_last_event
        int64_t delta_us = (int64_t)(real_now.tv_sec - g_last_gtod_real.tv_sec) * 1000000
                         + (int64_t)(real_now.tv_usec - g_last_gtod_real.tv_usec);
        // result = last_recorded + delta
        int64_t result_us = (int64_t)g_last_gtod_recorded.tv_sec * 1000000
                          + (int64_t)g_last_gtod_recorded.tv_usec + delta_us;
        tv->tv_sec = static_cast<time_t>(result_us / 1000000);
        tv->tv_usec = static_cast<suseconds_t>(result_us % 1000000);
        return 0;
      }
      // No recorded data at all — use real time
      return gettimeofday(tv, tz);
    }
    return 0;
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
    if (tp) {
      struct timespec recorded_ts;
      if (RecordReplayBytes("clock_gettime", &recorded_ts, sizeof(recorded_ts))) {
        *tp = recorded_ts;
        return static_cast<int>(RecordReplayValue("clock_gettime.ret", 0));
      }
      // Exhausted — use real clock
      return clock_gettime(clk_id, tp);
    }
    return 0;
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
    if (ret == 0) return time(tloc);  // exhausted — fall back
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
    uint64_t val = static_cast<uint64_t>(
        RecordReplayValue("mach_absolute_time", 0));
    if (val != 0) {
      // Event available — save for extrapolation
      g_last_mach_recorded = val;
      g_last_mach_real = mach_absolute_time();
      return val;
    }
    // Events exhausted — extrapolate: last_recorded + real_elapsed
    if (g_last_mach_recorded != 0) {
      uint64_t real_now = mach_absolute_time();
      return g_last_mach_recorded + (real_now - g_last_mach_real);
    }
    return mach_absolute_time();
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
