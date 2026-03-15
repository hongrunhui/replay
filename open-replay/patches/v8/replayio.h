// Open Replay — V8 Record/Replay API
// This header is added to deps/v8/include/
//
// Provides the C++ API that V8 uses to communicate with the recording driver.
// The driver (libopenreplay) implements these functions.

#ifndef V8_REPLAYIO_H_
#define V8_REPLAYIO_H_

#include <cstdint>
#include <cstddef>

namespace v8 {
namespace recordreplay {

// --- State queries (implemented by node_recordreplay.cc) ---
bool IsRecordingOrReplaying();
bool IsRecording();
bool IsReplaying();
bool IsMainThread();

// --- Callbacks from V8 to driver ---
void OnTargetProgressReached();
void OnInstrumentation(const char* kind, int function_id, int offset);
void Assert(const char* site, uint64_t value_hash);
void OnExceptionUnwind(int function_id, int offset);

// --- Object ID tracking ---
uint64_t GetObjectId(void* object);

// --- Bytecode site offset ---
// Forces 4-byte index operands for stable bytecode offsets
static constexpr int kBytecodeSiteOffset = 1 << 16;

}  // namespace recordreplay

namespace internal {

// Function pointers used by V8 runtime functions.
// Set by node_recordreplay.cc during startup. nullptr in mksnapshot.
namespace recordreplay_api {
  typedef bool (*IsRecordingOrReplayingFn)();
  typedef void (*OnTargetProgressReachedFn)();
  typedef void (*OnInstrumentationFn)(const char*, int, int);
  typedef void (*AssertFn)(const char*, uint64_t);
  typedef uint64_t (*GetObjectIdFn)(void*);

  typedef bool (*IsReplayingFn)();

  extern IsRecordingOrReplayingFn is_recording_or_replaying;
  extern IsReplayingFn is_replaying;
  extern OnTargetProgressReachedFn on_target_progress_reached;
  extern OnInstrumentationFn on_instrumentation;
  extern AssertFn assert_fn;
  extern GetObjectIdFn get_object_id;

  // Global state
  extern uint64_t* gProgressCounter;
  extern uint64_t gTargetProgress;
  extern bool gRecordReplayAssertValues;
  extern bool gRecordReplayInstrumentationEnabled;
}  // namespace recordreplay_api

}  // namespace internal
}  // namespace v8

#endif  // V8_REPLAYIO_H_
