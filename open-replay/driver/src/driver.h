// Open Replay — Recording/Replay Driver
// Core API exported as a shared library (libopenreplay.dylib/.so)
//
// Node.js loads this driver via dlopen and calls these exported functions.
// The driver handles: system call interception, recording file I/O,
// replay data injection, and checkpoint management.

#ifndef OPENREPLAY_DRIVER_H_
#define OPENREPLAY_DRIVER_H_

#include <cstddef>
#include <cstdint>
#include <string>

#ifdef __cplusplus
extern "C" {
#endif

// --- Lifecycle ---

// Attach the driver. Called by Node.js during startup.
// dispatch: "record" or "replay"
// build_id: identifies the Node.js build for compatibility checks
void RecordReplayAttach(const char* dispatch, const char* build_id);

// Finish recording and flush all data to disk.
void RecordReplayFinishRecording();

// Detach and clean up.
void RecordReplayDetach();

// --- Recording ID ---

// Get the unique ID for the current recording.
const char* RecordReplayGetRecordingId();

// Set the recording file path (for replay mode).
void RecordReplaySetRecordingPath(const char* path);

// --- State queries ---

int RecordReplayIsRecordingOrReplaying();
int RecordReplayIsRecording();
int RecordReplayIsReplaying();

// --- Core recording/replay primitives ---

// Record or replay a scalar value.
// why: a tag identifying the call site (e.g., "gettimeofday.tv_sec")
// value: the value to record (in recording mode) or the replayed value (in replay mode)
// Returns: the original value (recording) or the replayed value (replay)
uintptr_t RecordReplayValue(const char* why, uintptr_t value);

// Record or replay a byte buffer.
// Returns 1 if event was found and data was written, 0 if events exhausted.
int RecordReplayBytes(const char* why, void* buf, size_t size);

// Record or replay a string.
void RecordReplayString(const char* why, std::string& str);

// --- Progress tracking (for V8 bytecode instrumentation) ---

// Get pointer to the global progress counter (incremented by V8 bytecodes).
uint64_t* RecordReplayProgressCounter();

// Get pointer to the target progress value (for "run until" in replay).
uint64_t* RecordReplayTargetProgress();

// Notify that a progress milestone was reached.
void RecordReplayOnProgressReached(uint64_t progress);

// --- Checkpoints ---

// Create a new checkpoint at the current execution point.
void RecordReplayNewCheckpoint();

// Get the total number of checkpoints in the recording.
uint32_t RecordReplayGetCheckpointCount();

// Create a fork()-based checkpoint (replay mode only).
// Returns the checkpoint index, or -1 if fork failed.
int RecordReplayForkCheckpoint();

// Restore from a fork checkpoint. Sends SIGUSR1 to the checkpoint's child.
// The current process should exit after calling this.
// Returns the PID of the restored child, or -1 on failure.
int RecordReplayRestoreCheckpoint(int checkpoint_index);

// Get the number of fork checkpoints available.
int RecordReplayGetForkCheckpointCount();

// --- CDP (Chrome DevTools Protocol) integration ---

// Send a CDP message to the driver (from Node.js JS runtime).
void RecordReplaySendCDPMessage(const char* message, size_t length);

// Register a callback for receiving CDP messages from the driver.
typedef void (*CDPMessageCallback)(const char* message, size_t length);
void RecordReplaySetCDPCallback(CDPMessageCallback callback);

// --- Metadata ---

// Store JSON metadata into the recording (recording mode only).
void RecordReplaySetMetadata(const char* json);

// Get the metadata JSON string from the recording (replay mode only).
const char* RecordReplayGetMetadata();

// --- Logging ---

void RecordReplayLog(const char* format, ...);

#ifdef __cplusplus
}  // extern "C"
#endif

// --- C++ API (used internally) ---

namespace openreplay {

enum class Mode { IDLE, RECORDING, REPLAYING };

Mode GetMode();
const char* GetRecordingPath();

}  // namespace openreplay

#endif  // OPENREPLAY_DRIVER_H_
