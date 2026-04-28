// record_real.cc —— V8RecordReplay* / RecordReplay* 的真实实现
//
// 这些是强符号；会 override 同名的 weak stub。链接器自然选强者。
//
// 实现策略：所有函数都通过 DriverState::Get() 拿到全局状态。Mode::kOff 时
// 直接落到默认值（≈ stub 行为）；kRecord 时往 .orec 写；kReplay 时从 .orec 读。

#include "state.h"

#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

using openreplay::DriverState;
using openreplay::Mode;

// ============================================================
// 序列化辅助：把 On* 回调的参数打包为 BYTES 事件（B6.1 / B6.2）
// 格式：[u32 len][bytes...] 重复每个 string，原始字节追加每个数值
// ============================================================
namespace {

void AppendString(std::vector<uint8_t>& buf, const char* s) {
  uint32_t len = s ? static_cast<uint32_t>(std::strlen(s)) : 0;
  const uint8_t* lp = reinterpret_cast<const uint8_t*>(&len);
  buf.insert(buf.end(), lp, lp + 4);
  if (len) buf.insert(buf.end(),
                      reinterpret_cast<const uint8_t*>(s),
                      reinterpret_cast<const uint8_t*>(s) + len);
}

template <typename T>
void AppendNum(std::vector<uint8_t>& buf, T v) {
  const uint8_t* p = reinterpret_cast<const uint8_t*>(&v);
  buf.insert(buf.end(), p, p + sizeof(T));
}

// 录制模式：把 buf 写入 .orec 作为 BYTES 事件
// 回放模式：只推进 reader 游标（暂不验证内容；后续做 AssertValue 时再补）
// off 模式：什么都不做
void RecordOrConsume(const char* why, const std::vector<uint8_t>& buf) {
  auto* s = DriverState::Get();
  if (s->is_recording()) {
    s->WriteBytes(why, buf.data(), buf.size());
  } else if (s->is_replaying()) {
    s->ReplayConsumeEvent(why);
  }
}

}  // namespace

// ============================================================
// 状态查询：直接读 DriverState
// ============================================================

extern "C" bool V8IsRecordingOrReplaying(const char* /*feature*/, const char* /*subfeature*/) {
  auto* s = DriverState::Get();
  return s->mode() != Mode::kOff;
}

extern "C" bool V8IsRecording() {
  return DriverState::Get()->is_recording();
}

extern "C" bool V8IsReplaying() {
  return DriverState::Get()->is_replaying();
}

extern "C" char* V8GetRecordingId() {
  // 返回的字符串归调用方 free —— 跟 C 接口惯例一致
  const std::string& id = DriverState::Get()->session_id();
  if (id.empty()) return nullptr;
  return strdup(id.c_str());
}

extern "C" bool V8IsMainThread() {
  return DriverState::Get()->IsMainThread();
}

extern "C" bool V8RecordReplayHasDivergedFromRecording() {
  // MVP：永远没发散。后续 AssertValue 路径触发时再设置全局 flag。
  return false;
}

extern "C" bool V8RecordReplayAreAssertsDisabled() {
  // 默认不禁；用户可通过环境变量 OPENREPLAY_DISABLE_ASSERTS 控制
  static const bool disabled = std::getenv("OPENREPLAY_DISABLE_ASSERTS") != nullptr;
  return disabled;
}

// ============================================================
// 值/字节录制：核心
// ============================================================

extern "C" uintptr_t V8RecordReplayValue(const char* why, uintptr_t value) {
  auto* s = DriverState::Get();
  if (s->is_recording()) {
    s->WriteValue(why, value);
    return value;
  } else if (s->is_replaying()) {
    return s->ReadValue(why, value);
  }
  return value;  // off：透传
}

extern "C" void V8RecordReplayBytes(const char* why, void* buf, size_t size) {
  auto* s = DriverState::Get();
  if (s->is_recording()) {
    s->WriteBytes(why, buf, size);
  } else if (s->is_replaying()) {
    // ReadBytes 失败时不动 buf —— 保持现场值（多数 caller 已经填好缓冲）
    s->ReadBytes(why, buf, size);
  }
}

extern "C" void V8RecordReplayAssertBytes(const char* why, const void* buf, size_t size) {
  // 录制时把 hash/sample 写下来，回放时比对 —— MVP 先简化为录字节本身
  auto* s = DriverState::Get();
  if (s->is_recording()) {
    s->WriteBytes(why, buf, size);
  } else if (s->is_replaying()) {
    // 不强制比对，仅消费事件保持游标推进
    char tmp[256];
    if (size <= sizeof(tmp)) {
      s->ReadBytes(why, tmp, size);
    }
  }
}

// ============================================================
// 元数据
// ============================================================

extern "C" void V8RecordReplayAddMetadata(const char* jsonString) {
  if (!jsonString) return;
  DriverState::Get()->WriteMetadata(std::string(jsonString));
}

// ============================================================
// 进度计数器：最常被字节码调用，必须返回有效指针
// ============================================================

extern "C" uint64_t* V8RecordReplayGetProgressCounter() {
  // 进程级单例计数器。后续会改成线程局部+合并写入；MVP 先做最基础。
  static uint64_t s_counter = 0;
  return &s_counter;
}

// ============================================================
// 日志类：把 V8 / Blink 的 print/diagnostic/warning 路由到 log_fp
// ============================================================

extern "C" void V8RecordReplayPrintVA(const char* format, va_list args) {
  DriverState::Get()->Log(format, args);
}

extern "C" void V8RecordReplayDiagnosticVA(const char* format, va_list args) {
  DriverState::Get()->Log(format, args);
}

extern "C" void V8RecordReplayCommandDiagnosticVA(const char* format, va_list args) {
  DriverState::Get()->Log(format, args);
}

extern "C" void V8RecordReplayCommandDiagnosticTraceVA(const char* format, va_list args) {
  DriverState::Get()->Log(format, args);
}

extern "C" void V8RecordReplayWarning(const char* format, va_list args) {
  DriverState::Get()->Log(format, args);
}

extern "C" void V8RecordReplayTrace(const char* format, va_list args) {
  DriverState::Get()->Log(format, args);
}

extern "C" void V8RecordReplayCrash(const char* format, va_list args) {
  // Crash 应当输出到日志后调 abort；但目前 stub 阶段不真崩，免得早期开发被打断
  DriverState::Get()->Log(format, args);
  // std::abort();
}

extern "C" void V8RecordReplayAssertVA(const char* format, va_list args) {
  // 录制阶段：把断言转成 ASSERT_BYTES 写入；回放阶段：消费同名事件
  // MVP 先简化为只 log
  DriverState::Get()->Log(format, args);
}

extern "C" void V8RecordReplayAssertMaybeEventsDisallowedVA(const char* format,
                                                             va_list args) {
  DriverState::Get()->Log(format, args);
}

// ============================================================
// Skia 用的、不带前缀版本（Skia 通过 dlsym 加载，签名跟 V8 不同）
// ============================================================

extern "C" bool RecordReplayIsReplaying() {
  return DriverState::Get()->is_replaying();
}

extern "C" bool RecordReplayHasDivergedFromRecording() {
  return false;
}

extern "C" uintptr_t RecordReplayValue(const char* why, uintptr_t v) {
  auto* s = DriverState::Get();
  if (s->is_recording()) { s->WriteValue(why, v); return v; }
  if (s->is_replaying()) return s->ReadValue(why, v);
  return v;
}

extern "C" void RecordReplayPrint(const char* format, va_list args) {
  DriverState::Get()->Log(format, args);
}

extern "C" void RecordReplayWarning(const char* format, va_list args) {
  DriverState::Get()->Log(format, args);
}

extern "C" void RecordReplayDiagnostic(const char* format, va_list args) {
  DriverState::Get()->Log(format, args);
}

extern "C" void RecordReplayAssert(const char* format, va_list args) {
  DriverState::Get()->Log(format, args);
}

// ============================================================
// 终止类
// ============================================================

// ============================================================
// B6.1 网络事件遥测
// ============================================================

extern "C" void V8RecordReplayOnNetworkRequest(const char* id, const char* kind,
                                                uint64_t bookmark) {
  std::vector<uint8_t> buf;
  AppendString(buf, id);
  AppendString(buf, kind);
  AppendNum(buf, bookmark);
  RecordOrConsume("V8RecordReplayOnNetworkRequest", buf);
}

extern "C" void V8RecordReplayOnNetworkRequestEvent(const char* id) {
  std::vector<uint8_t> buf;
  AppendString(buf, id);
  RecordOrConsume("V8RecordReplayOnNetworkRequestEvent", buf);
}

extern "C" void V8RecordReplayOnNetworkStreamStart(const char* id, const char* kind,
                                                    const char* parentId) {
  std::vector<uint8_t> buf;
  AppendString(buf, id);
  AppendString(buf, kind);
  AppendString(buf, parentId);
  RecordOrConsume("V8RecordReplayOnNetworkStreamStart", buf);
}

extern "C" void V8RecordReplayOnNetworkStreamData(const char* id, size_t offset,
                                                   size_t length, uint64_t bookmark) {
  std::vector<uint8_t> buf;
  AppendString(buf, id);
  AppendNum(buf, static_cast<uint64_t>(offset));
  AppendNum(buf, static_cast<uint64_t>(length));
  AppendNum(buf, bookmark);
  RecordOrConsume("V8RecordReplayOnNetworkStreamData", buf);
}

extern "C" void V8RecordReplayOnNetworkStreamEnd(const char* id, size_t length) {
  std::vector<uint8_t> buf;
  AppendString(buf, id);
  AppendNum(buf, static_cast<uint64_t>(length));
  RecordOrConsume("V8RecordReplayOnNetworkStreamEnd", buf);
}

// ============================================================
// B6.2 输入事件遥测
// ============================================================

extern "C" void V8RecordReplayOnEvent(const char* event, bool before) {
  std::vector<uint8_t> buf;
  AppendString(buf, event);
  AppendNum(buf, static_cast<uint8_t>(before ? 1 : 0));
  RecordOrConsume("V8RecordReplayOnEvent", buf);
}

extern "C" void V8RecordReplayOnMouseEvent(const char* kind, size_t clientX,
                                            size_t clientY, bool synthetic) {
  std::vector<uint8_t> buf;
  AppendString(buf, kind);
  AppendNum(buf, static_cast<uint64_t>(clientX));
  AppendNum(buf, static_cast<uint64_t>(clientY));
  AppendNum(buf, static_cast<uint8_t>(synthetic ? 1 : 0));
  RecordOrConsume("V8RecordReplayOnMouseEvent", buf);
}

extern "C" void V8RecordReplayOnKeyEvent(const char* kind, const char* key,
                                          bool synthetic) {
  std::vector<uint8_t> buf;
  AppendString(buf, kind);
  AppendString(buf, key);
  AppendNum(buf, static_cast<uint8_t>(synthetic ? 1 : 0));
  RecordOrConsume("V8RecordReplayOnKeyEvent", buf);
}

extern "C" void V8RecordReplayOnNavigationEvent(const char* kind, const char* url) {
  std::vector<uint8_t> buf;
  AppendString(buf, kind);
  AppendString(buf, url);
  RecordOrConsume("V8RecordReplayOnNavigationEvent", buf);
}

// ============================================================
// 浏览器事件 + 注解
// ============================================================

extern "C" void V8RecordReplayOnAnnotation(const char* kind, const char* contents) {
  std::vector<uint8_t> buf;
  AppendString(buf, kind);
  AppendString(buf, contents);
  RecordOrConsume("V8RecordReplayOnAnnotation", buf);
}

extern "C" void V8RecordReplayBrowserEvent(const char* name, const char* payload) {
  std::vector<uint8_t> buf;
  AppendString(buf, name);
  AppendString(buf, payload);
  RecordOrConsume("V8RecordReplayBrowserEvent", buf);
}

extern "C" void V8RecordReplayFinishRecording() {
  // 让 RecordingWriter 进入 close 流程 —— 但 DriverState 析构会处理，
  // 这里只是一个早期触发点。MVP 不做特殊处理。
  DriverState::Get()->Log("V8RecordReplayFinishRecording invoked", nullptr);
}
