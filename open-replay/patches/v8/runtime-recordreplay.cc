// Open Replay — V8 Runtime Functions for Record/Replay
// This file is added to deps/v8/src/runtime/

#include "src/runtime/runtime.h"
#include "src/execution/isolate.h"
#include "src/objects/objects-inl.h"
#include "src/objects/js-generator-inl.h"
#include "include/replayio.h"

namespace v8 {
namespace internal {

// Global state — connected to driver at startup
uint64_t* gProgressCounter = nullptr;
uint64_t gTargetProgress = 0;
bool gRecordReplayAssertValues = false;
bool gRecordReplayInstrumentationEnabled = false;

namespace rr = v8::recordreplay;

RUNTIME_FUNCTION(Runtime_RecordReplayAssertExecutionProgress) {
  SealHandleScope shs(isolate);
  DCHECK_EQ(1, args.length());

  if (gProgressCounter) {
    (*gProgressCounter)++;
    if (*gProgressCounter == gTargetProgress) {
      rr::OnTargetProgressReached();
    }
  }

  return ReadOnlyRoots(isolate).undefined_value();
}

RUNTIME_FUNCTION(Runtime_RecordReplayTargetProgressReached) {
  SealHandleScope shs(isolate);
  DCHECK_EQ(0, args.length());
  rr::OnTargetProgressReached();
  return ReadOnlyRoots(isolate).undefined_value();
}

RUNTIME_FUNCTION(Runtime_RecordReplayInstrumentation) {
  HandleScope scope(isolate);
  DCHECK_EQ(2, args.length());

  if (!gRecordReplayInstrumentationEnabled) {
    return ReadOnlyRoots(isolate).undefined_value();
  }

  Handle<JSFunction> function(JSFunction::cast(args[0]), isolate);
  int site_index = args.smi_value_at(1);

  Handle<SharedFunctionInfo> shared(function->shared(), isolate);
  int function_id = shared->function_literal_id();
  int offset = site_index - rr::kBytecodeSiteOffset;

  rr::OnInstrumentation("breakpoint", function_id, offset);

  return ReadOnlyRoots(isolate).undefined_value();
}

RUNTIME_FUNCTION(Runtime_RecordReplayInstrumentationGenerator) {
  HandleScope scope(isolate);
  DCHECK_EQ(3, args.length());

  Handle<JSFunction> function(JSFunction::cast(args[0]), isolate);
  int site_index = args.smi_value_at(1);
  Handle<JSGeneratorObject> generator(JSGeneratorObject::cast(args[2]), isolate);

  rr::GetObjectId(reinterpret_cast<void*>(generator->ptr()));

  Handle<SharedFunctionInfo> shared(function->shared(), isolate);
  int function_id = shared->function_literal_id();
  int offset = site_index - rr::kBytecodeSiteOffset;

  if (gRecordReplayInstrumentationEnabled) {
    rr::OnInstrumentation("generator", function_id, offset);
  }

  return ReadOnlyRoots(isolate).undefined_value();
}

RUNTIME_FUNCTION(Runtime_RecordReplayAssertValue) {
  HandleScope scope(isolate);
  DCHECK_EQ(3, args.length());

  Handle<Object> value(args[2], isolate);

  if (gRecordReplayAssertValues && rr::IsRecordingOrReplaying()) {
    uint64_t hash = 0;
    if (IsSmi(*value)) {
      hash = static_cast<uint64_t>(Smi::cast(*value).value());
    } else if (IsHeapNumber(*value)) {
      double d = HeapNumber::cast(*value).value();
      memcpy(&hash, &d, sizeof(hash));
    } else if (IsString(*value)) {
      hash = static_cast<uint64_t>(String::cast(*value).length());
    } else if (IsUndefined(*value, isolate)) {
      hash = 0xDEAD0001;
    } else if (IsNull(*value, isolate)) {
      hash = 0xDEAD0002;
    } else if (IsTrue(*value, isolate)) {
      hash = 1;
    } else if (IsFalse(*value, isolate)) {
      hash = 0;
    }

    rr::Assert("value", hash);
  }

  return *value;
}

}  // namespace internal
}  // namespace v8
