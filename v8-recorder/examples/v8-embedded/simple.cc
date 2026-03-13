// Copyright 2024 V8 Recorder Project
// Simple example demonstrating basic recording

#include <iostream>
#include <memory>
#include "include/libplatform/libplatform.h"
#include "include/v8.h"
#include "src/recorder/recorder.h"

int main(int argc, char* argv[]) {
  // 初始化 V8
  v8::V8::InitializeICUDefaultLocation(argv[0]);
  v8::V8::InitializeExternalStartupData(argv[0]);
  std::unique_ptr<v8::Platform> platform = v8::platform::NewDefaultPlatform();
  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();

  // 创建 Isolate
  v8::Isolate::CreateParams create_params;
  create_params.array_buffer_allocator =
      v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  v8::Isolate* isolate = v8::Isolate::New(create_params);

  {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope handle_scope(isolate);

    // 创建上下文
    v8::Local<v8::Context> context = v8::Context::New(isolate);
    v8::Context::Scope context_scope(context);

    // 开始录制
    std::cout << "Starting recording..." << std::endl;
    v8::internal::Recorder::GetInstance()->StartRecording("simple.rec");

    // 执行简单的 JavaScript 代码
    const char* source = R"(
      function add(a, b) {
        return a + b;
      }

      function multiply(a, b) {
        return a * b;
      }

      let result1 = add(2, 3);
      let result2 = multiply(4, 5);
      let result3 = add(result1, result2);

      console.log('Result:', result3);
    )";

    // 编译并运行
    v8::Local<v8::String> source_string =
        v8::String::NewFromUtf8(isolate, source).ToLocalChecked();
    v8::Local<v8::Script> script =
        v8::Script::Compile(context, source_string).ToLocalChecked();

    v8::Local<v8::Value> result = script->Run(context).ToLocalChecked();

    // 停止录制
    v8::internal::Recorder::GetInstance()->StopRecording();
    std::cout << "Recording stopped" << std::endl;

    // 打印结果
    v8::String::Utf8Value utf8(isolate, result);
    std::cout << "Script result: " << *utf8 << std::endl;
  }

  // 清理
  isolate->Dispose();
  v8::V8::Dispose();
  v8::V8::DisposePlatform();
  delete create_params.array_buffer_allocator;

  return 0;
}
