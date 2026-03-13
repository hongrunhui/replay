// Copyright 2024 V8 Recorder Project
// Checkpoint management — placeholder for future expansion

#ifndef V8_RECORDER_CHECKPOINT_H_
#define V8_RECORDER_CHECKPOINT_H_

#include <cstdint>

namespace v8_recorder {

// Checkpoint represents a snapshot point in the recording timeline.
// Future: enables fast seeking during time-travel debugging.
struct Checkpoint {
  uint64_t sequence;       // Event sequence number at this checkpoint
  uint64_t timestamp_us;   // Wall-clock time
};

}  // namespace v8_recorder

#endif  // V8_RECORDER_CHECKPOINT_H_
