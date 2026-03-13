# V8 Recorder 使用指南

## 快速开始

### 1. 录制 JavaScript 执行

```bash
# 运行示例程序
./simple        # 录制简单的加法和乘法
./fibonacci     # 录制 Fibonacci 计算和非确定性操作

# 生成的录制文件
# - simple.rec
# - fibonacci.rec
```

### 2. 分析录制文件

```bash
# 查看统计信息
python3 analyze.py fibonacci.rec

# 查看执行轨迹
python3 analyze.py fibonacci.rec --trace
```

输出示例:
```
=== Recording File: fibonacci.rec ===
Magic: V8REC001
Version: 1
Timestamp: 1709876543210

=== Statistics ===
Total execution points: 287
Non-deterministic data: 2

=== Top 10 Functions ===
  fibonacci: 177 calls
  <anonymous>: 55 calls
  add: 30 calls
  multiply: 25 calls

=== Non-Deterministic Data ===
  RANDOM: 1
  TIME: 1

=== Call Stack ===
Maximum depth: 11

=== Execution Time ===
Duration: 15.43 ms (15430 μs)
```

### 3. 重放录制

```bash
# 交互式重放
./replay fibonacci.rec

# 选择重放模式:
# 1. 完整重放 - 自动执行所有执行点
# 2. 单步重放 - 按 Enter 逐步执行
# 3. 断点重放 - 在指定执行点暂停
```

## 编程接口

### 录制 API

```cpp
#include "src/recorder/recorder.h"

// 开始录制
v8::internal::Recorder::GetInstance()->StartRecording("output.rec");

// 执行 JavaScript 代码
// ...

// 停止录制
v8::internal::Recorder::GetInstance()->StopRecording();

// 检查录制状态
bool is_recording = v8::internal::Recorder::GetInstance()->IsRecording();
```

### 重放 API

```cpp
#include "src/recorder/replayer.h"

// 创建重放器
v8::internal::Replayer replayer;

// 加载录制文件
if (!replayer.Load("fibonacci.rec")) {
    std::cerr << "Failed to load recording" << std::endl;
    return 1;
}

// 开始重放
replayer.StartReplay();

// 逐个获取执行点
while (const auto* point = replayer.GetNextExecutionPoint()) {
    std::cout << "Function: " << point->function_name
              << " at line " << point->line_number << std::endl;

    // 获取非确定性数据
    double random_value;
    if (replayer.GetRandomValue(point->id, &random_value)) {
        std::cout << "  Random: " << random_value << std::endl;
    }
}
```

### 断点调试

```cpp
// 设置断点
replayer.SetBreakpoint(100);  // 在执行点 100 处暂停

// 开始重放
replayer.StartReplay();

// 重放会在断点处自动暂停
while (const auto* point = replayer.GetNextExecutionPoint()) {
    if (!replayer.IsReplaying()) {
        std::cout << "Breakpoint hit at: " << point->id << std::endl;
        break;
    }
}

// 单步执行
replayer.Step();

// 继续执行
replayer.Continue();

// 跳转到指定执行点
replayer.JumpTo(50);
```

## 录制文件格式

### 文件结构

```
┌─────────────────────────────────────┐
│ Header (32 bytes)                   │
├─────────────────────────────────────┤
│ Execution Points Block 1            │
│   - Count                           │
│   - Execution Point 1               │
│   - Execution Point 2               │
│   - ...                             │
├─────────────────────────────────────┤
│ Non-Deterministic Data Block 1      │
│   - Count                           │
│   - Data 1                          │
│   - Data 2                          │
│   - ...                             │
├─────────────────────────────────────┤
│ Execution Points Block 2            │
│ ...                                 │
└─────────────────────────────────────┘
```

### Header (32 bytes)

| 字段 | 类型 | 大小 | 说明 |
|------|------|------|------|
| Magic | char[8] | 8 bytes | "V8REC001" |
| Version | uint32 | 4 bytes | 文件格式版本 (1) |
| Timestamp | uint64 | 8 bytes | 录制时间戳 (毫秒) |
| Flags | uint32 | 4 bytes | 标志位 (保留) |
| Reserved | uint64 | 8 bytes | 保留字段 |

### Execution Point

| 字段 | 类型 | 说明 |
|------|------|------|
| ID | uint64 | 执行点唯一标识 |
| Timestamp | uint64 | 时间戳 (微秒) |
| Bytecode Offset | int32 | 字节码偏移 |
| Function Name Length | uint32 | 函数名长度 |
| Function Name | char[] | 函数名 |
| Line Number | int32 | 行号 |
| Column Number | int32 | 列号 |
| Stack Depth | uint32 | 调用栈深度 |

### Non-Deterministic Data

| 字段 | 类型 | 说明 |
|------|------|------|
| Type | uint8 | 数据类型 (0=Random, 1=Time, 2=IO, 3=External) |
| Execution Point ID | uint64 | 关联的执行点 ID |
| Data Length | uint32 | 数据长度 |
| Data | byte[] | 实际数据 |

## 性能优化

### 减少录制开销

1. **调整刷新阈值**

```cpp
// 在 recorder.h 中修改
static constexpr size_t kFlushThreshold = 10000;  // 增加到 10000
```

2. **选择性录制**

```cpp
// 只在关键代码段录制
Recorder::GetInstance()->StartRecording("critical.rec");
// 执行关键代码
Recorder::GetInstance()->StopRecording();
```

3. **使用 Release 构建**

```bash
# 编译时使用 Release 模式
tools/dev/v8gen.py x64.release
ninja -C out.gn/x64.release
```

### 减少文件大小

1. **压缩录制文件**

```bash
# 使用 gzip 压缩
gzip fibonacci.rec
# 生成 fibonacci.rec.gz

# 解压
gunzip fibonacci.rec.gz
```

2. **过滤执行点**

```cpp
// 只记录特定函数
void RecordExecutionPoint(...) {
    if (function_name == "fibonacci") {
        // 记录
    }
}
```

## 故障排除

### 问题 1: 录制文件过大

**原因**: 执行点过多

**解决方案**:
- 增加 `kFlushThreshold`
- 减少录制粒度
- 只录制关键函数

### 问题 2: 重放不一致

**原因**: 非确定性操作未被拦截

**解决方案**:
- 检查是否所有非确定性函数都被拦截
- 添加更多拦截点 (网络请求、文件 I/O 等)

### 问题 3: 性能下降严重

**原因**: 录制开销过大

**解决方案**:
- 使用 Release 构建
- 减少录制频率
- 使用采样录制

## 高级用法

### 自定义录制器

```cpp
class MyRecorder : public Recorder {
 public:
  void RecordCustomEvent(const char* event_name, const void* data, size_t len) {
    // 自定义事件录制
    RecordExternal(event_name, data, len);
  }
};
```

### 条件断点

```cpp
// 在特定条件下设置断点
for (size_t i = 0; i < replayer.GetTotalExecutionPoints(); i++) {
    const auto* point = &execution_points[i];
    if (point->function_name == "fibonacci" && point->stack_depth > 5) {
        replayer.SetBreakpoint(point->id);
    }
}
```

### 时间旅行调试

```cpp
// 跳转到过去的执行点
replayer.JumpTo(50);

// 从该点继续执行
replayer.Continue();

// 再次跳转
replayer.JumpTo(100);
```

## 最佳实践

1. **始终使用 RAII 管理录制**

```cpp
class RecordingSession {
 public:
  RecordingSession(const char* file) {
    Recorder::GetInstance()->StartRecording(file);
  }
  ~RecordingSession() {
    Recorder::GetInstance()->StopRecording();
  }
};

// 使用
{
  RecordingSession session("output.rec");
  // 执行代码
} // 自动停止录制
```

2. **定期刷新缓冲区**

```cpp
// 在长时间运行的程序中
if (execution_points_.size() >= kFlushThreshold) {
    Flush();
}
```

3. **错误处理**

```cpp
if (!Recorder::GetInstance()->StartRecording("output.rec")) {
    std::cerr << "Failed to start recording" << std::endl;
    return 1;
}
```

## 参考资料

- [V8 官方文档](https://v8.dev/docs)
- [Replay.io 技术博客](https://blog.replay.io/)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
