// Copyright 2024 V8 Recorder Project
// libc-level function interception for recording/replay
//
// Architecture inspired by Replay.io's approach:
// Instead of intercepting at V8 Platform API level (which misses most
// non-determinism), we intercept at the libc level where ALL system
// interactions pass through.
//
// This file is compiled as a shared library (.dylib/.so) and injected via
// DYLD_INSERT_LIBRARIES (macOS) or LD_PRELOAD (Linux).

#ifndef V8_RECORDER_INTERCEPT_H_
#define V8_RECORDER_INTERCEPT_H_

#include "src/recording/recording_stream.h"

namespace v8_recorder {

// Initialize the interception layer
// mode: "record" or "replay"
// path: recording file path
void InterceptInit(const char* mode, const char* path);

// Shutdown
void InterceptShutdown();

}  // namespace v8_recorder

#endif  // V8_RECORDER_INTERCEPT_H_
