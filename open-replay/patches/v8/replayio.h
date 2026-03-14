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

// --- State queries ---
bool IsRecordingOrReplaying();
bool IsRecording();
bool IsReplaying();
bool IsMainThread();

// --- Progress tracking ---
// Global progress counter — incremented by RecordReplayIncExecutionProgressCounter bytecode.
// Pointer-to-pointer: the driver owns the actual counter, V8 holds a pointer to it.
extern uint64_t* gProgressCounter;
extern uint64_t gTargetProgress;

// Whether to emit assertion bytecodes (slower but catches divergence)
extern bool gRecordReplayAssertValues;

// Whether instrumentation opcodes are enabled (toggled at runtime)
extern bool gRecordReplayInstrumentationEnabled;

// --- Callbacks from V8 to driver ---

// Called when progress counter reaches target (during replay "run to" operations)
void OnTargetProgressReached();

// Called for instrumentation events (breakpoints, function entry/exit)
// kind: "breakpoint", "main" (entry), "exit", "generator"
// function_id: unique ID for the function
// offset: bytecode offset within the function
void OnInstrumentation(const char* kind, int function_id, int offset);

// Called to assert a value during recording/replay
// Returns the (possibly corrected) value
// site: description of the assertion site (e.g., "Parameter", "LoadGlobal foo")
void Assert(const char* site, uint64_t value_hash);

// Called when an exception unwinds past an instrumented frame
void OnExceptionUnwind(int function_id, int offset);

// --- Object ID tracking ---
// Assigns a deterministic ID to an object (used for generators)
uint64_t GetObjectId(void* object);

// --- Bytecode site offset ---
// Forces 4-byte index operands for stable bytecode offsets
static constexpr int kBytecodeSiteOffset = 1 << 16;

}  // namespace recordreplay
}  // namespace v8

#endif  // V8_REPLAYIO_H_
