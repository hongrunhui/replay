# V8 Recorder 快速开始指南

## 🚀 5 分钟快速开始

### 1. 克隆项目

```bash
cd /Users/hongrunhui/Documents/code/各种框架源码/replay/v8-recorder
```

### 2. 运行自动化设置

```bash
./setup.sh
```

这个脚本会：
- 安装 depot_tools
- 下载 V8 源码（约 2GB）
- 应用录制器补丁
- 复制源文件

**预计时间**: 10-20 分钟（取决于网络速度）

### 3. 编译 V8

```bash
./build.sh
```

**预计时间**: 30-60 分钟（取决于 CPU）

### 4. 编译示例

```bash
./compile-examples.sh
```

**预计时间**: 1-2 分钟

### 5. 运行示例

```bash
# 简单示例
./simple

# Fibonacci 示例
./fibonacci
```

## 📊 预期输出

### Simple 示例

```
Starting recording...
[Recorder] Started recording to: simple.rec
Result: 25
[Recorder] Stopped recording
[Recorder] Total execution points: 156
[Recorder] Non-deterministic data: 1
Recording stopped
Script result: 25
```

### Fibonacci 示例

```
Recording Fibonacci execution...
[Recorder] Started recording to: fibonacci.rec
Fibonacci(10) = 55
Random: 0.7234567
Time: 1709876543210
[Recorder] Stopped recording
[Recorder] Total execution points: 2847
[Recorder] Non-deterministic data: 5
Final result: 55
```

## 🔍 查看录制文件

录制文件是二进制格式，可以用十六进制查看器查看：

```bash
# 查看文件头
hexdump -C simple.rec | head -20

# 查看文件大小
ls -lh *.rec
```

预期输出：
```
00000000  56 38 52 45 43 30 30 31  01 00 00 00 ab cd ef 12  |V8REC001........|
00000010  34 56 78 90 00 00 00 00  00 00 00 00 00 00 00 00  |4Vx.............|
...
```

## 📝 自定义录制

### 创建自己的示例

创建 `my_example.cc`:

```cpp
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

  v8::Isolate::CreateParams create_params;
  create_params.array_buffer_allocator =
      v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  v8::Isolate* isolate = v8::Isolate::New(create_params);

  {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = v8::Context::New(isolate);
    v8::Context::Scope context_scope(context);

    // 开始录制
    v8::internal::Recorder::GetInstance()->StartRecording("my_output.rec");

    // 你的 JavaScript 代码
    const char* source = R"(
      // 在这里写你的 JavaScript 代码
      function myFunction() {
        return "Hello, Recorder!";
      }
      myFunction();
    )";

    v8::Local<v8::String> source_string =
        v8::String::NewFromUtf8(isolate, source).ToLocalChecked();
    v8::Local<v8::Script> script =
        v8::Script::Compile(context, source_string).ToLocalChecked();
    script->Run(context);

    // 停止录制
    v8::internal::Recorder::GetInstance()->StopRecording();
  }

  isolate->Dispose();
  v8::V8::Dispose();
  v8::V8::DisposePlatform();
  delete create_params.array_buffer_allocator;

  return 0;
}
```

### 编译自定义示例

```bash
g++ -std=c++17 \
  -Iv8-workspace/v8 \
  -Iv8-workspace/v8/include \
  my_example.cc \
  -o my_example \
  -Lv8-workspace/v8/out.gn/x64.release/obj \
  -lv8_monolith \
  -pthread \
  -ldl

./my_example
```

## 🐛 故障排除

### 问题 1: depot_tools 命令找不到

```bash
export PATH=$PATH:$(pwd)/depot_tools
```

### 问题 2: 编译失败 - 找不到头文件

确保路径正确：
```bash
ls v8-workspace/v8/src/recorder/recorder.h
```

### 问题 3: 链接错误

确保 V8 已编译：
```bash
ls v8-workspace/v8/out.gn/x64.release/obj/libv8_monolith.a
```

### 问题 4: 运行时错误 - 找不到共享库

```bash
export LD_LIBRARY_PATH=v8-workspace/v8/out.gn/x64.release/obj:$LD_LIBRARY_PATH
```

## 📚 下一步

1. **实现重放器**: 查看 `src/recorder/replayer.h`
2. **添加更多拦截**: 修改 `patches/003-intercept-builtins.patch`
3. **优化性能**: 调整 `recorder.cc` 中的 `kFlushThreshold`
4. **可视化工具**: 编写 Python 脚本解析 `.rec` 文件

## 💡 提示

- 录制会显著降低执行速度（3-5x）
- 录制文件可能很大，注意磁盘空间
- 可以通过修改 `kFlushThreshold` 调整内存使用
- 使用 Release 构建以获得最佳性能

## 🎯 完整示例项目

查看 `examples/` 目录获取更多示例：
- `simple.cc` - 基础录制
- `fibonacci.cc` - 递归函数录制
- `async.cc` - 异步操作录制（待实现）

## 📞 获取帮助

如果遇到问题：
1. 检查 V8 版本是否正确（10.8.168.25）
2. 确保所有补丁都已应用
3. 查看编译输出的错误信息
4. 检查 `v8-workspace/v8/.recorder_patched` 文件是否存在
