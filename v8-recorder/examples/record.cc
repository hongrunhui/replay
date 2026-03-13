// Copyright 2024 V8 Recorder Project
// Recording example — demonstrates platform-level recording
//
// All non-deterministic V8 platform calls (time, etc.) are automatically
// captured by RecordingPlatform. No V8 patches needed.

#include <iostream>
#include <memory>
#include <string>
#include "include/libplatform/libplatform.h"
#include "include/v8.h"
#include "src/platform/recording_platform.h"

int main(int argc, char* argv[]) {
  const char* output_file = "output.v8rec";
  if (argc >= 2) output_file = argv[1];

  // Initialize V8
  v8::V8::InitializeICUDefaultLocation(argv[0]);
  v8::V8::InitializeExternalStartupData(argv[0]);

  // Set deterministic random seed and record it
  int random_seed = 42;
  std::string seed_flag = "--random_seed=" + std::to_string(random_seed);
  v8::V8::SetFlagsFromString(seed_flag.c_str());

  // Create RecordingPlatform wrapping the default platform
  auto platform = std::make_unique<v8_recorder::RecordingPlatform>(
      v8::platform::NewDefaultPlatform(), output_file);

  // Record the random seed into the event log
  platform->log().Append(v8_recorder::EventType::RANDOM_SEED,
                          &random_seed, sizeof(random_seed));

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

    // JavaScript that uses non-deterministic APIs
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

    std::cout << "\n=== Recording JavaScript Execution ===" << std::endl;

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

  std::cout << "\nRecording saved to: " << output_file << std::endl;
  return 0;
}
