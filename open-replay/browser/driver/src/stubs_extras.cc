// stubs_extras.cc —— 补 V8 宏未覆盖的 extern "C" __attribute__((weak))符号
//
// 来自三个来源：
//  (A) Chromium 在 V8/Blink/HTML/Paint 等代码里直接 extern "C" __attribute__((weak))声明、用 V8 前缀的
//      函数 —— 共 15 个，签名带 V8 类型，需要 v8.h
//  (B) Skia 通过 dlsym 动态加载、不带前缀的 RecordReplay* 函数 —— 共 15 个，
//      签名跟 V8 版本不一样（无 why 参数等），独立实现
//  (C) [跳过] 像 CallbackRecordReplayValue（chromium 自己定义在 base/）、
//      RecordReplayObjectId（C++ overload，不是 extern C）—— 都不是 driver 责任
//
// 全部返回默认值，跟 stubs_v8api.cc 一样，后续逐个换成真实实现。

#include <cstddef>
#include <cstdarg>
#include <cstdint>

#include "v8.h"  // 来自 chromium/src/v8/include/

// ============================================================
// (A) V8 命名空间内的 extras —— 15 个
// ============================================================

extern "C" __attribute__((weak))bool V8RecordReplayCurrentReturnValue(v8::Local<v8::Value>* /*object*/) {
  return false;
}

extern "C" __attribute__((weak))char* V8RecordReplayReadAssetFileContents(const char* /*aPath*/, size_t* aLength) {
  if (aLength) *aLength = 0;
  return nullptr;
}

extern "C" __attribute__((weak))int V8GetMessageRecordReplayBookmark(v8::Local<v8::Message> /*message*/) {
  return 0;
}

extern "C" __attribute__((weak))int V8RecordReplayDependencyGraphExecutionNode() {
  return 0;
}

extern "C" __attribute__((weak))size_t V8RecordReplayPaintStart() {
  return 0;
}

extern "C" __attribute__((weak))uint64_t* V8RecordReplayGetProgressCounter() {
  // 必须返回非 nullptr 否则 V8 字节码 IncProgressCounter 会立即 deref 崩。
  // 提供一个进程级的静态计数器即可（stub 阶段语义不重要，只要不崩）。
  static uint64_t s_counter = 0;
  return &s_counter;
}

extern "C" __attribute__((weak))void V8RecordReplayAddMetadata(const char* /*jsonString*/) {}

// 注意：跟 V8RecordReplayAssertVA 区分 —— 这个是 variadic（...），那个是 va_list
extern "C" __attribute__((weak))void V8RecordReplayAssert(const char* /*format*/, ...) {}

extern "C" __attribute__((weak))void V8RecordReplayHTMLParseAddData(void* /*token*/, const char* /*data*/) {}
extern "C" __attribute__((weak))void V8RecordReplayHTMLParseFinish(void* /*token*/) {}
extern "C" __attribute__((weak))void V8RecordReplayHTMLParseStart(void* /*token*/, const char* /*url*/) {}

extern "C" __attribute__((weak))void V8RecordReplayOnConsoleMessage(size_t /*bookmark*/) {}

extern "C" __attribute__((weak))void V8RecordReplayPaintFinished(size_t /*bookmark*/) {}

extern "C" __attribute__((weak))void V8RecordReplayRegisterBrowserEventCallback(
    void (*/*callback*/)(const char* name, const char* payload)) {}

extern "C" __attribute__((weak))void V8RecordReplaySetAPIObjectIdCallback(
    int (*/*callback*/)(v8::Local<v8::Object>)) {}

extern "C" __attribute__((weak))void V8RecordReplaySetCrashReason(const char* /*reason*/) {}

extern "C" __attribute__((weak))void V8RecordReplaySetDefaultContext(
    v8::Isolate* /*isolate*/, v8::Local<v8::Context> /*cx*/) {}

extern "C" __attribute__((weak))void V8RecordReplaySetPaintCallback(
    char* (*/*callback*/)(const char*, int)) {}

// ============================================================
// (B) Skia 通过 dlsym 加载的不带前缀符号 —— 15 个
// 签名取自 chromium/src/third_party/skia/src/core/SkRecordReplay.cpp
// ============================================================

extern "C" __attribute__((weak))void RecordReplayPrint(const char* /*format*/, va_list /*args*/) {}
extern "C" __attribute__((weak))void RecordReplayWarning(const char* /*format*/, va_list /*args*/) {}
extern "C" __attribute__((weak))void RecordReplayAssert(const char* /*format*/, va_list /*args*/) {}
extern "C" __attribute__((weak))void RecordReplayDiagnostic(const char* /*format*/, va_list /*args*/) {}

extern "C" __attribute__((weak))void RecordReplayRegisterPointer(const void* /*ptr*/) {}
extern "C" __attribute__((weak))void RecordReplayUnregisterPointer(const void* /*ptr*/) {}
extern "C" __attribute__((weak))int RecordReplayPointerId(const void* /*ptr*/) { return 0; }

extern "C" __attribute__((weak))bool RecordReplayHasDisabledFeatures() { return false; }
extern "C" __attribute__((weak))bool RecordReplayFeatureEnabled(const char* /*feature*/, const char* /*subfeature*/) {
  return true;
}

extern "C" __attribute__((weak))bool RecordReplayAreEventsDisallowed() { return false; }
extern "C" __attribute__((weak))void RecordReplayBeginPassThroughEvents() {}
extern "C" __attribute__((weak))void RecordReplayEndPassThroughEvents() {}

extern "C" __attribute__((weak))bool RecordReplayIsReplaying() { return false; }
extern "C" __attribute__((weak))bool RecordReplayHasDivergedFromRecording() { return false; }

extern "C" __attribute__((weak))uintptr_t RecordReplayValue(const char* /*why*/, uintptr_t v) { return v; }
