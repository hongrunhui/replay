# V8 Recorder - 基于 V8 引擎的 JavaScript 执行录制工具

## 项目概述

这是一个基于 V8 引擎实现的 JavaScript 执行录制工具，可以记录 JS 代码的完整执行过程，包括：
- 每个函数调用
- 变量变化
- 非确定性操作（随机数、时间、I/O）
- 完整的调用栈

## 目录结构

```
v8-recorder/
├── README.md                 # 本文件
├── setup.sh                  # 自动化设置脚本
├── build.sh                  # 编译脚本
├── patches/                  # V8 补丁文件
│   ├── 001-add-recorder.patch
│   ├── 002-instrument-interpreter.patch
│   └── 003-intercept-builtins.patch
├── src/                      # 录制器源码
│   ├── recorder/
│   │   ├── recorder.h
│   │   ├── recorder.cc
│   │   ├── replayer.h
│   │   └── replayer.cc
│   └── api/
│       └── v8-recorder-api.cc
├── examples/                 # 示例代码
│   ├── simple.cc
│   ├── fibonacci.cc
│   └── async.cc
└── test/                     # 测试文件
    └── test.js
```

## 快速开始

### 1. 环境要求

- Linux 或 macOS
- Python 3.x
- Git
- 至少 20GB 磁盘空间
- 8GB+ 内存

### 2. 自动化安装

**重要**: 如果你在中国大陆或需要代理访问 Google 服务，请先配置代理:

```bash
# 方法 1: 使用代理管理脚本 (推荐)
./proxy.sh enable    # 启用代理 (默认 127.0.0.1:7897)
./proxy.sh test      # 测试代理连接

# 方法 2: 编辑 setup.sh 设置代理
vim setup.sh
# 修改 PROXY_HOST 和 PROXY_PORT，设置 USE_PROXY=true

# 详细代理配置说明请查看 PROXY.md
```

然后运行安装脚本:

```bash
# 克隆本项目
cd v8-recorder

# 运行自动化设置脚本（会下载 V8 并应用补丁）
./setup.sh

# 编译（需要 30-60 分钟）
./build.sh
```

### 3. 手动安装（如果自动化失败）

详见下方"详细安装步骤"。

## 使用示例

### 录制 JavaScript 执行

```cpp
#include "include/v8.h"
#include "src/recorder/recorder.h"

int main() {
  // 初始化 V8
  v8::V8::InitializeICUDefaultLocation(argv[0]);
  v8::V8::InitializeExternalStartupData(argv[0]);
  v8::V8::Initialize();

  // 创建 Isolate
  v8::Isolate* isolate = v8::Isolate::New();
  {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = v8::Context::New(isolate);
    v8::Context::Scope context_scope(context);

    // 开始录制
    v8::Recorder::StartRecording("output.rec");

    // 执行 JavaScript
    const char* code = "function add(a, b) { return a + b; } add(1, 2);";
    v8::Local<v8::String> source = v8::String::NewFromUtf8(isolate, code);
    v8::Local<v8::Script> script = v8::Script::Compile(context, source);
    script->Run(context);

    // 停止录制
    v8::Recorder::StopRecording();
  }

  isolate->Dispose();
  v8::V8::Dispose();
  return 0;
}
```

### 重放录制

```cpp
#include "src/recorder/replayer.h"

int main() {
  v8::Replayer replayer;
  replayer.Load("output.rec");
  replayer.Replay();
  return 0;
}
```

## 详细安装步骤

### 步骤 1: 安装 depot_tools

```bash
# 下载 depot_tools
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
export PATH=$PATH:$(pwd)/depot_tools

# 添加到 ~/.bashrc 或 ~/.zshrc
echo 'export PATH=$PATH:'$(pwd)'/depot_tools' >> ~/.bashrc
```

### 步骤 2: 获取 V8 源码

```bash
# 创建工作目录
mkdir v8-workspace
cd v8-workspace

# 获取 V8
fetch v8
cd v8

# 切换到稳定版本
git checkout 10.8.168.25
gclient sync
```

### 步骤 3: 应用补丁

```bash
# 复制录制器源码到 V8 目录
cp -r ../v8-recorder/src/recorder src/
cp -r ../v8-recorder/src/api/* src/api/

# 应用补丁
git apply ../v8-recorder/patches/001-add-recorder.patch
git apply ../v8-recorder/patches/002-instrument-interpreter.patch
git apply ../v8-recorder/patches/003-intercept-builtins.patch
```

### 步骤 4: 编译

```bash
# 生成构建文件
tools/dev/v8gen.py x64.release

# 编译（需要 30-60 分钟）
ninja -C out.gn/x64.release
```

### 步骤 5: 编译示例

```bash
# 编译示例程序
g++ -std=c++17 \
  -I. -Iinclude \
  examples/simple.cc \
  -o simple \
  -Lout.gn/x64.release/obj \
  -lv8_monolith \
  -pthread

# 运行
./simple
```

## 录制文件格式

录制文件采用二进制格式：

```
Header (32 bytes):
  - Magic: "V8REC001" (8 bytes)
  - Version: uint32 (4 bytes)
  - Timestamp: uint64 (8 bytes)
  - Flags: uint32 (4 bytes)
  - Reserved: (8 bytes)

Execution Points:
  - Count: uint32
  - For each point:
    - ID: uint64
    - Timestamp: uint64
    - Bytecode Offset: int32
    - Function Name Length: uint32
    - Function Name: char[]
    - Line Number: int32
    - Column Number: int32

Non-Deterministic Data:
  - Count: uint32
  - For each data:
    - Type: uint8 (0=Random, 1=Time, 2=IO)
    - Execution Point: uint64
    - Data Length: uint32
    - Data: byte[]
```

## API 文档

### 录制 API

```cpp
namespace v8 {

class Recorder {
 public:
  // 开始录制
  static void StartRecording(const char* output_file);

  // 停止录制
  static void StopRecording();

  // 检查是否正在录制
  static bool IsRecording();

  // 记录执行点
  static void RecordExecutionPoint(
      int bytecode_offset,
      const char* function_name,
      int line_number,
      int column_number);

  // 记录非确定性数据
  static void RecordRandom(double value);
  static void RecordTime(double value);
  static void RecordIO(const char* operation, const void* data, size_t len);
};

} // namespace v8
```

### 重放 API

```cpp
namespace v8 {

class Replayer {
 public:
  // 加载录制文件
  bool Load(const char* input_file);

  // 重放
  void Replay();

  // 跳转到指定执行点
  void JumpTo(uint64_t execution_point);

  // 设置断点
  void SetBreakpoint(uint64_t execution_point);

  // 单步执行
  void Step();

  // 继续执行
  void Continue();
};

} // namespace v8
```

## 性能影响

- **录制开销**: 约 3-5x 慢于正常执行
- **文件大小**: 约 1MB / 10000 执行点
- **内存开销**: 约 100MB 额外内存

## 限制

1. **不支持多线程**: 当前版本只支持单线程 JavaScript
2. **不支持 WebAssembly**: 只能录制 JavaScript 代码
3. **不支持原生扩展**: 无法录制 C++ 扩展的执行

## 故障排除

### 编译错误

**问题**: `fatal error: 'recorder/recorder.h' file not found`

**解决**: 确保已正确复制源文件到 V8 目录

```bash
cp -r src/recorder v8/src/
```

### 运行时错误

**问题**: `Recorder not initialized`

**解决**: 确保在执行 JavaScript 前调用 `StartRecording()`

### 性能问题

**问题**: 录制速度太慢

**解决**:
1. 减少录制粒度（只在函数入口/出口记录）
2. 使用 Release 构建
3. 增加缓冲区大小

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

BSD 3-Clause License (与 V8 相同)

## 参考资料

- [V8 官方文档](https://v8.dev/docs)
- [V8 源码](https://github.com/v8/v8)
- [Replay.io 技术博客](https://blog.replay.io/)
