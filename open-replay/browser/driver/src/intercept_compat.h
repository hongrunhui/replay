// intercept_compat.h —— 兼容层：把 intercept/*.cc 用的 Node.js driver 的 helper
// 名字（RecordReplayValue 等）转发到我们 DriverState。

#ifndef OPENREPLAY_BROWSER_INTERCEPT_COMPAT_H_
#define OPENREPLAY_BROWSER_INTERCEPT_COMPAT_H_

#include "state.h"

inline bool RecordReplayIsRecording() {
  return openreplay::DriverState::Get()->is_recording();
}
inline bool RecordReplayIsReplaying() {
  return openreplay::DriverState::Get()->is_replaying();
}
inline bool RecordReplayIsRecordingOrReplaying() {
  return openreplay::DriverState::Get()->mode() != openreplay::Mode::kOff;
}
// 简化：driver 内部拦截器不参与 PassThrough 状态机，永远返回 false。
inline bool RecordReplayAreEventsPassedThrough() { return false; }

inline uintptr_t RecordReplayValue(const char* why, uintptr_t v) {
  auto* s = openreplay::DriverState::Get();
  if (s->is_recording()) { s->WriteValue(why, v); return v; }
  if (s->is_replaying()) return s->ReadValue(why, v);
  return v;
}
// Node.js driver 这函数返回 bool（成功标志）；record 总成功，replay 看 reader。
inline bool RecordReplayBytes(const char* why, void* buf, size_t size) {
  auto* s = openreplay::DriverState::Get();
  if (s->is_recording()) { s->WriteBytes(why, buf, size); return true; }
  if (s->is_replaying()) return s->ReadBytes(why, buf, size);
  return false;
}

#endif
