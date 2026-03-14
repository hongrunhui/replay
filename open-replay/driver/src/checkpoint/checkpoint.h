// Open Replay — Checkpoint System
//
// Checkpoints are markers in the recording that allow fast-forward during replay.
// Instead of replaying from the beginning, we can jump to the nearest checkpoint
// before the target execution point and replay from there.

#ifndef OPENREPLAY_CHECKPOINT_H_
#define OPENREPLAY_CHECKPOINT_H_

#include <cstdint>
#include <vector>

namespace openreplay {

class CheckpointManager {
 public:
  CheckpointManager();
  ~CheckpointManager();

  // Create a checkpoint at the current progress value.
  // Returns the checkpoint ID.
  uint32_t CreateCheckpoint(uint64_t progress);

  // Find the nearest checkpoint at or before the given progress value.
  // Returns checkpoint ID, or UINT32_MAX if none found.
  uint32_t FindNearestBefore(uint64_t target_progress) const;

  // Get progress value for a checkpoint.
  uint64_t GetProgress(uint32_t checkpoint_id) const;

  // Get total checkpoint count.
  uint32_t Count() const;

  // Configuration: minimum progress interval between auto-checkpoints.
  void SetAutoInterval(uint64_t interval);
  uint64_t GetAutoInterval() const;

  // Check if we should create an auto-checkpoint at this progress value.
  bool ShouldAutoCheckpoint(uint64_t current_progress) const;

 private:
  struct Checkpoint {
    uint32_t id;
    uint64_t progress;
  };

  std::vector<Checkpoint> checkpoints_;
  uint64_t auto_interval_ = 10000;  // Default: every 10k progress ticks
  uint64_t last_checkpoint_progress_ = 0;
};

}  // namespace openreplay

#endif  // OPENREPLAY_CHECKPOINT_H_
