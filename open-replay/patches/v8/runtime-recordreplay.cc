// Open Replay — V8 Runtime Functions for Record/Replay
// This file is added to deps/v8/src/runtime/

#include "src/runtime/runtime.h"
#include "src/execution/arguments-inl.h"
#include "src/execution/isolate.h"
#include "src/objects/objects-inl.h"
#include "src/objects/js-generator-inl.h"
#include "src/objects/script-inl.h"
#include "include/replayio.h"

#include <unordered_map>

namespace v8 {
namespace internal {

// Global state — connected to driver at startup
uint64_t* gProgressCounter = nullptr;
uint64_t gTargetProgress = 0;

// Function pointers and global flags used by V8 runtime functions.
// Defined here (in v8::internal::recordreplay_api) to match replayio.h declarations.
// Set by node_recordreplay.cc at startup. nullptr/false in mksnapshot.
namespace recordreplay_api {
  typedef bool (*IsRecordingOrReplayingFn)();
  typedef bool (*IsReplayingFn)();
  typedef void (*OnTargetProgressReachedFn)();
  typedef void (*OnInstrumentationFn)(const char*, int, int);
  typedef void (*AssertFn)(const char*, uint64_t);
  typedef uint64_t (*GetObjectIdFn)(void*);

  IsRecordingOrReplayingFn is_recording_or_replaying = nullptr;
  IsReplayingFn is_replaying = nullptr;
  OnTargetProgressReachedFn on_target_progress_reached = nullptr;
  OnInstrumentationFn on_instrumentation = nullptr;
  AssertFn assert_fn = nullptr;
  GetObjectIdFn get_object_id = nullptr;

  // Flags
  bool gRecordReplayAssertValues = false;
  bool gRecordReplayInstrumentationEnabled = false;
}  // namespace recordreplay_api

RUNTIME_FUNCTION(Runtime_RecordReplayAssertExecutionProgress) {
  SealHandleScope shs(isolate);
  DCHECK_EQ(1, args.length());

  if (gProgressCounter) {
    (*gProgressCounter)++;
    if (*gProgressCounter == gTargetProgress) {
      if (recordreplay_api::on_target_progress_reached) {
        recordreplay_api::on_target_progress_reached();
      }
    }
  }

  return ReadOnlyRoots(isolate).undefined_value();
}

RUNTIME_FUNCTION(Runtime_RecordReplayTargetProgressReached) {
  SealHandleScope shs(isolate);
  DCHECK_EQ(0, args.length());
  if (recordreplay_api::on_target_progress_reached) {
    recordreplay_api::on_target_progress_reached();
  }
  return ReadOnlyRoots(isolate).undefined_value();
}

// Line number cache: (SharedFunctionInfo ptr XOR source_position) → line
// Avoids repeated Script::GetLineNumber lookups for hot statement locations.
static std::unordered_map<uint64_t, int> s_line_cache;

RUNTIME_FUNCTION(Runtime_RecordReplayInstrumentation) {
  HandleScope scope(isolate);
  DCHECK_EQ(2, args.length());

  if (!recordreplay_api::gRecordReplayInstrumentationEnabled) {
    return ReadOnlyRoots(isolate).undefined_value();
  }

  Handle<JSFunction> function(JSFunction::cast(args[0]), isolate);
  int site_index = args.smi_value_at(1);
  // site_index = kBytecodeSiteOffset + source_position (encoded by bytecode generator)
  int source_position = site_index - ::v8::recordreplay::kBytecodeSiteOffset;

  // Skip non-breakpoint instrumentation (e.g. "main", "exit" with kNoSourcePosition = -1)
  if (source_position < 0) {
    return ReadOnlyRoots(isolate).undefined_value();
  }

  Handle<SharedFunctionInfo> shared(function->shared(), isolate);
  Handle<Script> script(Script::cast(shared->script()), isolate);
  int script_id = script->id();

  // Pass (script_id, source_position) to driver — NOT line number.
  // The driver aggregates per source_position. The server maps to lines
  // later, taking max count per line (so `for(init;cond;update)` counts as 1).
  if (recordreplay_api::on_instrumentation) {
    recordreplay_api::on_instrumentation("hit", script_id, source_position);
  }

  return ReadOnlyRoots(isolate).undefined_value();
}

RUNTIME_FUNCTION(Runtime_RecordReplayInstrumentationGenerator) {
  HandleScope scope(isolate);
  DCHECK_EQ(3, args.length());

  Handle<JSFunction> function(JSFunction::cast(args[0]), isolate);
  int site_index = args.smi_value_at(1);
  Handle<JSGeneratorObject> generator(JSGeneratorObject::cast(args[2]), isolate);

  if (recordreplay_api::get_object_id) {
    recordreplay_api::get_object_id(reinterpret_cast<void*>(generator->ptr()));
  }

  Handle<SharedFunctionInfo> shared(function->shared(), isolate);
  int function_id = shared->function_literal_id();
  int offset = site_index - ::v8::recordreplay::kBytecodeSiteOffset;

  if (recordreplay_api::gRecordReplayInstrumentationEnabled && recordreplay_api::on_instrumentation) {
    recordreplay_api::on_instrumentation("generator", function_id, offset);
  }

  return ReadOnlyRoots(isolate).undefined_value();
}

RUNTIME_FUNCTION(Runtime_RecordReplayAssertValue) {
  HandleScope scope(isolate);
  DCHECK_EQ(3, args.length());

  Handle<Object> value(args[2], isolate);

  if (recordreplay_api::gRecordReplayAssertValues &&
      recordreplay_api::is_recording_or_replaying &&
      recordreplay_api::is_recording_or_replaying()) {
    uint64_t hash = 0;
    if (value->IsSmi()) {
      hash = static_cast<uint64_t>(Smi::cast(*value).value());
    } else if (value->IsHeapNumber()) {
      double d = HeapNumber::cast(*value).value();
      memcpy(&hash, &d, sizeof(hash));
    } else if (value->IsString()) {
      hash = static_cast<uint64_t>(String::cast(*value).length());
    } else if (value->IsUndefined(isolate)) {
      hash = 0xDEAD0001;
    } else if (value->IsNull(isolate)) {
      hash = 0xDEAD0002;
    } else if (value->IsTrue(isolate)) {
      hash = 1;
    } else if (value->IsFalse(isolate)) {
      hash = 0;
    }

    if (recordreplay_api::assert_fn) {
      recordreplay_api::assert_fn("value", hash);
    }
  }

  return *value;
}

}  // namespace internal
}  // namespace v8
