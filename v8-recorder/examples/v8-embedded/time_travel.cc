// Copyright 2024 V8 Recorder Project
// Time-travel debugging example
//
// Demonstrates replaying the same recording multiple times,
// each time producing identical results — the foundation of
// time-travel debugging.

#include <cstring>
#include <iostream>
#include <memory>
#include <string>
#include "include/libplatform/libplatform.h"
#include "include/v8.h"
#include "src/platform/replay_platform.h"

static const char* kSource = R"(
  let time = Date.now();
  let r1 = Math.random();
  let r2 = Math.random();
  JSON.stringify({ time, r1, r2 });
)";

// Run the script once using a ReplayPlatform loaded from the recording
std::string RunReplay(const char* recording_file, const char* argv0) {
  v8::V8::InitializeICUDefaultLocation(argv0);
  v8::V8::InitializeExternalStartupData(argv0);

  auto platform = std::make_unique<v8_recorder::ReplayPlatform>(
      v8::platform::NewDefaultPlatform(), recording_file);

  // Restore random seed
  const v8_recorder::Event* seed_event =
      platform->log().Next(v8_recorder::EventType::RANDOM_SEED);
  if (seed_event && seed_event->data.size() >= sizeof(int)) {
    int seed;
    std::memcpy(&seed, seed_event->data.data(), sizeof(seed));
    std::string flag = "--random_seed=" + std::to_string(seed);
    v8::V8::SetFlagsFromString(flag.c_str());
  }

  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();
  v8::Isolate::CreateParams create_params;
  create_params.array_buffer_allocator =
      v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  v8::Isolate* isolate = v8::Isolate::New(create_params);

  std::string output;
  {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = v8::Context::New(isolate);
    v8::Context::Scope context_scope(context);

    v8::Local<v8::String> source_str =
        v8::String::NewFromUtf8(isolate, kSource).ToLocalChecked();
    v8::Local<v8::Script> script =
        v8::Script::Compile(context, source_str).ToLocalChecked();
    v8::Local<v8::Value> result = script->Run(context).ToLocalChecked();

    v8::String::Utf8Value utf8(isolate, result);
    output = *utf8;
  }

  isolate->Dispose();
  v8::V8::Dispose();
  v8::V8::DisposePlatform();
  delete create_params.array_buffer_allocator;

  return output;
}

int main(int argc, char* argv[]) {
  if (argc < 2) {
    std::cerr << "Usage: " << argv[0] << " <recording.v8rec>" << std::endl;
    std::cerr << "\nFirst create a recording with the record example."
              << std::endl;
    return 1;
  }

  const char* recording_file = argv[1];
  constexpr int kRuns = 3;

  std::cout << "=== Time-Travel Debugging Demo ===" << std::endl;
  std::cout << "Replaying " << recording_file << " " << kRuns
            << " times...\n" << std::endl;

  std::string first_output;
  bool all_match = true;

  for (int i = 0; i < kRuns; i++) {
    std::cout << "--- Run " << (i + 1) << " ---" << std::endl;
    std::string output = RunReplay(recording_file, argv[0]);
    std::cout << "Result: " << output << "\n" << std::endl;

    if (i == 0) {
      first_output = output;
    } else if (output != first_output) {
      std::cout << "MISMATCH with run 1!" << std::endl;
      all_match = false;
    }
  }

  std::cout << "=== Determinism Check ===" << std::endl;
  if (all_match) {
    std::cout << "All " << kRuns
              << " runs produced identical output. Deterministic replay works!"
              << std::endl;
  } else {
    std::cout << "WARNING: Outputs differ. Replay is not fully deterministic."
              << std::endl;
  }

  return all_match ? 0 : 1;
}
