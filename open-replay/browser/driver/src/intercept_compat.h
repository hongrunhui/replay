// intercept_compat.h —— intercept/*.cc 用的兼容层。
// [B6.4 fix] 不再调 DriverState::Get()，避免在 chromium 启动早期触发
// pthread_once 跑构造器。直接用 atomic 指针检查 driver 是否就绪。

#ifndef OPENREPLAY_BROWSER_INTERCEPT_COMPAT_H_
#define OPENREPLAY_BROWSER_INTERCEPT_COMPAT_H_

#include <atomic>
#include "state.h"

extern std::atomic<openreplay::DriverState*> g_driver_state;

inline openreplay::DriverState* GetReadyDriver() {
  return g_driver_state.load(std::memory_order_acquire);
}

inline bool RecordReplayIsRecording() {
  auto* s = GetReadyDriver();
  return s && s->is_recording();
}
inline bool RecordReplayIsReplaying() {
  auto* s = GetReadyDriver();
  return s && s->is_replaying();
}
inline bool RecordReplayIsRecordingOrReplaying() {
  auto* s = GetReadyDriver();
  return s && s->mode() != openreplay::Mode::kOff;
}
inline bool RecordReplayAreEventsPassedThrough() { return false; }

inline uintptr_t RecordReplayValue(const char* why, uintptr_t v) {
  auto* s = GetReadyDriver();
  if (!s) return v;
  if (s->is_recording()) { s->WriteValue(why, v); return v; }
  if (s->is_replaying()) return s->ReadValue(why, v);
  return v;
}
inline bool RecordReplayBytes(const char* why, void* buf, size_t size) {
  auto* s = GetReadyDriver();
  if (!s) return false;
  if (s->is_recording()) { s->WriteBytes(why, buf, size); return true; }
  if (s->is_replaying()) return s->ReadBytes(why, buf, size);
  return false;
}

#endif
