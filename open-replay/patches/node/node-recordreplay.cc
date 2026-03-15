// Open Replay — Node.js Driver Integration
// Loads libopenreplay and bridges V8 record/replay API to the driver.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <dlfcn.h>

#include "node_version.h"  // NODE_VERSION_STRING

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

  if (!fn_attach) {
    fprintf(stderr, "[openreplay] Driver loaded but missing RecordReplayAttach\n");
    return false;
  }

  // Attach driver
  const char* dispatch = "record";
  if (strcmp(mode, "replay") == 0) dispatch = "replay";
  fn_attach(dispatch, NODE_VERSION_STRING);

  fprintf(stderr, "[openreplay] Driver attached (mode=%s)\n", dispatch);
  return true;
}

void ShutdownDriver() {
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
  // TODO: Phase 4 — check breakpoints, pause execution
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
