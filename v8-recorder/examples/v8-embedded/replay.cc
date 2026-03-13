// Copyright 2024 V8 Recorder Project
// Replay example — re-executes JavaScript with recorded platform values
//
// Uses ReplayPlatform to feed back recorded time/random values,
// producing identical output to the original recording.

#include <cstring>
#include <iostream>
#include <memory>
#include <string>
#include "include/libplatform/libplatform.h"
#include "include/v8.h"
#include "src/platform/replay_platform.h"

int main(int argc, char* argv[]) {
  if (argc < 2) {
    std::cerr << "Usage: " << argv[0] << " <recording.v8rec>" << std::endl;
    return 1;
  }

  const char* recording_file = argv[1];

  // Initialize V8
  v8::V8::InitializeICUDefaultLocation(argv[0]);
  v8::V8::InitializeExternalStartupData(argv[0]);

  // Create ReplayPlatform — loads the recording file
  auto platform = std::make_unique<v8_recorder::ReplayPlatform>(
      v8::platform::NewDefaultPlatform(), recording_file);

  // Restore random seed from recording
  const v8_recorder::Event* seed_event =
      platform->log().Next(v8_recorder::EventType::RANDOM_SEED);
  if (seed_event && seed_event->data.size() >= sizeof(int)) {
    int seed;
    std::memcpy(&seed, seed_event->data.data(), sizeof(seed));
    std::string seed_flag = "--random_seed=" + std::to_string(seed);
    v8::V8::SetFlagsFromString(seed_flag.c_str());
    std::cout << "[Replay] Restored random seed: " << seed << std::endl;
  }

  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();
  v8::Isolate::CreateParams create_params;
  create_params.array_buffer_allocator =
      v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  v8::Isolate* isolate = v8::Isolate::New(create_params);

  {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = v8::Context::New(isolate);
    v8::Context::Scope context_scope(context);

    // Same JavaScript as record.cc — Date.now() and Math.random()
    // will return the recorded values via ReplayPlatform
    const char* source = R"(
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }

      let result = fibonacci(10);
      let time1 = Date.now();
      let random1 = Math.random();
      let random2 = Math.random();
      let time2 = Date.now();

      const output = {
        fibonacci: result,
        time1: time1,
        time2: time2,
        random1: random1,
        random2: random2,
        elapsed: time2 - time1
      };

      JSON.stringify(output, null, 2);
    )";

    std::cout << "\n=== Replaying JavaScript Execution ===" << std::endl;

    v8::Local<v8::String> source_str =
        v8::String::NewFromUtf8(isolate, source).ToLocalChecked();
    v8::Local<v8::Script> script =
        v8::Script::Compile(context, source_str).ToLocalChecked();
    v8::Local<v8::Value> result = script->Run(context).ToLocalChecked();

    v8::String::Utf8Value utf8(isolate, result);
    std::cout << "Output:\n" << *utf8 << std::endl;
  }

  isolate->Dispose();
  v8::V8::Dispose();
  v8::V8::DisposePlatform();
  delete create_params.array_buffer_allocator;

  std::cout << "\nReplay complete. Output should match the recording."
            << std::endl;
  return 0;
}
