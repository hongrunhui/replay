// Copyright 2024 V8 Recorder Project
// Fibonacci example with recording

#include <iostream>
#include <memory>
#include "include/libplatform/libplatform.h"
#include "include/v8.h"
#include "src/recorder/recorder.h"

int main(int argc, char* argv[]) {
  v8::V8::InitializeICUDefaultLocation(argv[0]);
  v8::V8::InitializeExternalStartupData(argv[0]);
  std::unique_ptr<v8::Platform> platform = v8::platform::NewDefaultPlatform();
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

    std::cout << "Recording Fibonacci execution..." << std::endl;
    v8::internal::Recorder::GetInstance()->StartRecording("fibonacci.rec");

    // Fibonacci 递归实现
    const char* source = R"(
      function fibonacci(n) {
        if (n <= 1) {
          return n;
        }
        return fibonacci(n - 1) + fibonacci(n - 2);
      }

      // 计算 fibonacci(10)
      let result = fibonacci(10);
      console.log('Fibonacci(10) =', result);

      // 测试非确定性函数
      let random = Math.random();
      console.log('Random:', random);

      let time = Date.now();
      console.log('Time:', time);

      result;
    )";

    v8::Local<v8::String> source_string =
        v8::String::NewFromUtf8(isolate, source).ToLocalChecked();
    v8::Local<v8::Script> script =
        v8::Script::Compile(context, source_string).ToLocalChecked();

    v8::Local<v8::Value> result = script->Run(context).ToLocalChecked();

    v8::internal::Recorder::GetInstance()->StopRecording();

    v8::String::Utf8Value utf8(isolate, result);
    std::cout << "Final result: " << *utf8 << std::endl;
  }

  isolate->Dispose();
  v8::V8::Dispose();
  v8::V8::DisposePlatform();
  delete create_params.array_buffer_allocator;

  return 0;
}
