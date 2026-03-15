// Open Replay — Node.js Driver Integration
// Loads libopenreplay and bridges V8 record/replay API to the driver.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <dlfcn.h>

#include "node_version.h"  // NODE_VERSION_STRING
#include "replayio.h"  // v8::internal::recordreplay_api

namespace node {
namespace recordreplay {

// Driver function pointers (resolved via dlopen)
static void* driver_handle = nullptr;

typedef void (*AttachFn)(const char*, const char*);
typedef void (*FinishRecordingFn)();
typedef void (*DetachFn)();
typedef const char* (*GetRecordingIdFn)();
typedef int (*IsRecordingOrReplayingFn)();
typedef int (*IsRecordingFn)();
typedef int (*IsReplayingFn)();
typedef uintptr_t (*ValueFn)(const char*, uintptr_t);
typedef void (*BytesFn)(const char*, void*, size_t);
typedef uint64_t* (*ProgressCounterFn)();
typedef uint64_t* (*TargetProgressFn)();
typedef void (*NewCheckpointFn)();
typedef void (*PassThroughFn)();
typedef int (*ArePassedThroughFn)();
typedef void (*OnInstrumentationFn)(int, int);
typedef void (*BeginTraceFn)();
typedef const int32_t* (*EndTraceFn)(uint32_t*);
typedef void (*WriteHitCountsFn)(const char*);

static AttachFn fn_attach = nullptr;
static FinishRecordingFn fn_finish = nullptr;
static DetachFn fn_detach = nullptr;
static GetRecordingIdFn fn_get_id = nullptr;
static IsRecordingOrReplayingFn fn_is_rr = nullptr;
static IsRecordingFn fn_is_rec = nullptr;
static IsReplayingFn fn_is_rep = nullptr;
static ValueFn fn_value = nullptr;
static BytesFn fn_bytes = nullptr;
static ProgressCounterFn fn_progress = nullptr;
static TargetProgressFn fn_target = nullptr;
static NewCheckpointFn fn_checkpoint = nullptr;
static PassThroughFn fn_begin_passthrough = nullptr;
static PassThroughFn fn_end_passthrough = nullptr;
static ArePassedThroughFn fn_are_passedthrough = nullptr;
static OnInstrumentationFn fn_on_instrumentation = nullptr;
static BeginTraceFn fn_begin_trace = nullptr;
static EndTraceFn fn_end_trace = nullptr;
static WriteHitCountsFn fn_write_hitcounts = nullptr;

#define RESOLVE(handle, name, type) \
  fn_##name = reinterpret_cast<type>(dlsym(handle, "RecordReplay" #name)); \
  if (!fn_##name) fprintf(stderr, "[openreplay] Warning: missing symbol RecordReplay" #name "\n");

bool InitializeDriver() {
  // Check environment variables
  const char* mode = getenv("OPENREPLAY_MODE");
  if (!mode) mode = getenv("RECORD_ALL_CONTENT");
  if (!mode) return false;

  // Find driver library
  const char* driver_path = getenv("OPENREPLAY_DRIVER");
  if (!driver_path) {
    // Default paths
    #ifdef __APPLE__
    driver_path = "libopenreplay.dylib";
    #else
    driver_path = "libopenreplay.so";
    #endif
  }

  // Open driver
  driver_handle = dlopen(driver_path, RTLD_NOW | RTLD_GLOBAL);
  if (!driver_handle) {
    // Try DYLD_INSERT_LIBRARIES path (already loaded)
    driver_handle = dlopen(nullptr, RTLD_NOW);
  }

  if (!driver_handle) {
    fprintf(stderr, "[openreplay] Failed to load driver: %s\n", dlerror());
    return false;
  }

  // Resolve symbols
  fn_attach = reinterpret_cast<AttachFn>(dlsym(driver_handle, "RecordReplayAttach"));
  fn_finish = reinterpret_cast<FinishRecordingFn>(dlsym(driver_handle, "RecordReplayFinishRecording"));
  fn_detach = reinterpret_cast<DetachFn>(dlsym(driver_handle, "RecordReplayDetach"));
  fn_get_id = reinterpret_cast<GetRecordingIdFn>(dlsym(driver_handle, "RecordReplayGetRecordingId"));
  fn_is_rr = reinterpret_cast<IsRecordingOrReplayingFn>(dlsym(driver_handle, "RecordReplayIsRecordingOrReplaying"));
  fn_is_rec = reinterpret_cast<IsRecordingFn>(dlsym(driver_handle, "RecordReplayIsRecording"));
  fn_is_rep = reinterpret_cast<IsReplayingFn>(dlsym(driver_handle, "RecordReplayIsReplaying"));
  fn_value = reinterpret_cast<ValueFn>(dlsym(driver_handle, "RecordReplayValue"));
  fn_bytes = reinterpret_cast<BytesFn>(dlsym(driver_handle, "RecordReplayBytes"));
  fn_progress = reinterpret_cast<ProgressCounterFn>(dlsym(driver_handle, "RecordReplayProgressCounter"));
  fn_target = reinterpret_cast<TargetProgressFn>(dlsym(driver_handle, "RecordReplayTargetProgress"));
  fn_checkpoint = reinterpret_cast<NewCheckpointFn>(dlsym(driver_handle, "RecordReplayNewCheckpoint"));
  fn_begin_passthrough = reinterpret_cast<PassThroughFn>(dlsym(driver_handle, "RecordReplayBeginPassThroughEvents"));
  fn_end_passthrough = reinterpret_cast<PassThroughFn>(dlsym(driver_handle, "RecordReplayEndPassThroughEvents"));
  fn_are_passedthrough = reinterpret_cast<ArePassedThroughFn>(dlsym(driver_handle, "RecordReplayAreEventsPassedThrough"));
  fn_on_instrumentation = reinterpret_cast<OnInstrumentationFn>(dlsym(driver_handle, "RecordReplayOnInstrumentation"));
  fn_begin_trace = reinterpret_cast<BeginTraceFn>(dlsym(driver_handle, "RecordReplayBeginCollectingTrace"));
  fn_end_trace = reinterpret_cast<EndTraceFn>(dlsym(driver_handle, "RecordReplayEndCollectingTrace"));
  fn_write_hitcounts = reinterpret_cast<WriteHitCountsFn>(dlsym(driver_handle, "RecordReplayWriteHitCounts"));

  if (!fn_is_rr) {
    // Driver not loaded or symbols not available
    return false;
  }

  // Do NOT call fn_attach here — the driver's __attribute__((constructor))
  // already called RecordReplayAttach during DYLD_INSERT_LIBRARIES loading.
  // We only resolve symbols and wire up V8 function pointers.

  // Wire up V8 internal function pointers so runtime functions can call
  // into the v8::recordreplay namespace without direct symbol linkage
  // (avoids mksnapshot undefined symbol issues).
  v8::internal::recordreplay_api::is_recording_or_replaying =
      []() -> bool { return fn_is_rr && fn_is_rr(); };
  v8::internal::recordreplay_api::is_replaying =
      []() -> bool { return fn_is_rep && fn_is_rep(); };
  v8::internal::recordreplay_api::on_target_progress_reached =
      []() { /* TODO: notify replay engine */ };
  v8::internal::recordreplay_api::on_instrumentation =
      [](const char*, int script_id, int line) {
        if (fn_on_instrumentation) fn_on_instrumentation(script_id, line);
      };
  v8::internal::recordreplay_api::assert_fn =
      [](const char* site, uint64_t value_hash) {
        if (fn_value) fn_value(site, static_cast<uintptr_t>(value_hash));
      };
  v8::internal::recordreplay_api::get_object_id =
      [](void* object) -> uint64_t { return reinterpret_cast<uint64_t>(object); };

  // Enable V8 instrumentation if requested (for hit count collection).
  // OPENREPLAY_INSTRUMENT=1 causes bytecode generator to emit Instrumentation
  // bytecodes at every statement position. Driver collects (script_id, line) hits.
  if (getenv("OPENREPLAY_INSTRUMENT")) {
    v8::internal::recordreplay_api::gRecordReplayInstrumentationEnabled = true;
    if (fn_begin_trace) fn_begin_trace();
    fprintf(stderr, "[openreplay] Instrumentation enabled\n");
  }

  return true;
}

void ShutdownDriver() {
  // Write hit counts to file if trace was collected
  const char* trace_path = getenv("OPENREPLAY_TRACE_OUTPUT");
  if (trace_path && fn_write_hitcounts) {
    fn_write_hitcounts(trace_path);
    fprintf(stderr, "[openreplay] Hit counts written to %s\n", trace_path);
  }
  if (fn_detach) {
    fn_detach();
  }
}

// V8 recordreplay API implementation — delegates to driver
bool IsRecordingOrReplaying() {
  return fn_is_rr && fn_is_rr();
}
bool IsRecording() {
  return fn_is_rec && fn_is_rec();
}
bool IsReplaying() {
  return fn_is_rep && fn_is_rep();
}

// PassThrough API — lets inspector I/O bypass recording/replaying
void BeginPassThroughEvents() {
  if (fn_begin_passthrough) fn_begin_passthrough();
}
void EndPassThroughEvents() {
  if (fn_end_passthrough) fn_end_passthrough();
}
bool AreEventsPassedThrough() {
  return fn_are_passedthrough && fn_are_passedthrough();
}

}  // namespace recordreplay
}  // namespace node

// --- V8 recordreplay namespace implementation ---
// These are called by V8's runtime functions

namespace v8 {
namespace recordreplay {

bool IsRecordingOrReplaying() {
  return node::recordreplay::IsRecordingOrReplaying();
}
bool IsRecording() {
  return node::recordreplay::IsRecording();
}
bool IsReplaying() {
  return node::recordreplay::IsReplaying();
}
bool IsMainThread() {
  return true;  // MVP: single-threaded only
}

void OnTargetProgressReached() {
  // TODO: Phase 4 — notify replay engine
}

void OnInstrumentation(const char* kind, int function_id, int offset) {
  // Forward to driver for hit count collection
  if (node::recordreplay::fn_on_instrumentation) {
    node::recordreplay::fn_on_instrumentation(function_id, offset);
  }
}

void Assert(const char* site, uint64_t value_hash) {
  if (node::recordreplay::fn_value) {
    node::recordreplay::fn_value(site, static_cast<uintptr_t>(value_hash));
  }
}

void OnExceptionUnwind(int function_id, int offset) {
  // TODO: Phase 4 — record exception location
}

uint64_t GetObjectId(void* object) {
  // Simple address-based ID for now
  return reinterpret_cast<uint64_t>(object);
}

}  // namespace recordreplay
}  // namespace v8
