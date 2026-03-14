// Open Replay — Checkpoint System Implementation

#include "checkpoint/checkpoint.h"

namespace openreplay {

CheckpointManager::CheckpointManager() = default;
CheckpointManager::~CheckpointManager() = default;

uint32_t CheckpointManager::CreateCheckpoint(uint64_t progress) {
  Checkpoint cp;
  cp.id = static_cast<uint32_t>(checkpoints_.size());
  cp.progress = progress;
  checkpoints_.push_back(cp);
  last_checkpoint_progress_ = progress;
  return cp.id;
}

uint32_t CheckpointManager::FindNearestBefore(uint64_t target_progress) const {
  uint32_t best = UINT32_MAX;
  uint64_t best_progress = 0;
  for (const auto& cp : checkpoints_) {
    if (cp.progress <= target_progress && cp.progress >= best_progress) {
      best = cp.id;
      best_progress = cp.progress;
    }
  }
  return best;
}

uint64_t CheckpointManager::GetProgress(uint32_t checkpoint_id) const {
  if (checkpoint_id < checkpoints_.size()) {
    return checkpoints_[checkpoint_id].progress;
  }
  return 0;
}

uint32_t CheckpointManager::Count() const {
  return static_cast<uint32_t>(checkpoints_.size());
}

void CheckpointManager::SetAutoInterval(uint64_t interval) {
  auto_interval_ = interval;
}

uint64_t CheckpointManager::GetAutoInterval() const {
  return auto_interval_;
}

bool CheckpointManager::ShouldAutoCheckpoint(uint64_t current_progress) const {
  return (current_progress - last_checkpoint_progress_) >= auto_interval_;
}

}  // namespace openreplay
