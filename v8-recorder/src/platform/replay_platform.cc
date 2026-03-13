// Copyright 2024 V8 Recorder Project
// Replay platform implementation

#include "src/platform/replay_platform.h"
#include <iostream>

namespace v8_recorder {

ReplayPlatform::ReplayPlatform(std::unique_ptr<v8::Platform> actual,
                               const char* recording_file)
    : actual_(std::move(actual)) {
  if (!log_.Load(recording_file)) {
    std::cerr << "[ReplayPlatform] Failed to load recording: "
              << recording_file << std::endl;
  }
}

ReplayPlatform::~ReplayPlatform() = default;

}  // namespace v8_recorder
