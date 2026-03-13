// Copyright 2024 V8 Recorder Project
// Recording platform implementation

#include "src/platform/recording_platform.h"
#include <iostream>

namespace v8_recorder {

RecordingPlatform::RecordingPlatform(std::unique_ptr<v8::Platform> actual,
                                     const char* output_file)
    : actual_(std::move(actual)) {
  if (!log_.OpenForWriting(output_file)) {
    std::cerr << "[RecordingPlatform] Failed to open log: " << output_file
              << std::endl;
  }
}

RecordingPlatform::~RecordingPlatform() {
  log_.Close();
}

}  // namespace v8_recorder
