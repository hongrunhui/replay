# Replay.io V8 引擎改动分析

> 基于 chromium-v8 仓库源码分析，共涉及 70 个文件的改动。

## 1. 新增字节码（7 个）

在 `src/interpreter/bytecodes.h` 中新增：

| 字节码 | 操作数 | 用途 |
|---|---|---|
| `RecordReplayIncExecutionProgressCounter` | 无 | 递增执行进度计数器，用于追踪执行位置 |
| `RecordReplayNotifyActivity` | 无 | 通知 Replay 运行时有活动发生 |
| `RecordReplayInstrumentation` | `kIdx, kIdx` | 主插桩字节码，记录执行点（kind + source_position） |
| `RecordReplayInstrumentationGenerator` | `kIdx, kIdx, kReg` | Generator/async 函数插桩（额外传入 generator 对象） |
| `RecordReplayInstrumentationReturn` | `kIdx, kIdx, kReg` | 返回值插桩（额外传入返回值寄存器） |
| `RecordReplayAssertValue` | `kIdx, kIdx` | 断言值一致性（录制/回放对比） |
| `RecordReplayTrackObjectId` | `kReg` | 追踪对象身份 ID |

## 2. Runtime 函数（8 个）

在 `src/runtime/runtime.h` 中新增：

| Runtime 函数 | 参数数量 | 用途 |
|---|---|---|
| `RecordReplayAssertExecutionProgress` | 1 | 断言执行进度一致 |
| `RecordReplayTargetProgressReached` | 0 | 检查是否到达目标进度点 |
| `RecordReplayNotifyActivity` | 0 | 通知活动发生 |
| `RecordReplayAssertValue` | 3 | 断言值在录制/回放间一致 |
| `RecordReplayInstrumentation` | 2 | 主插桩回调（kind, source_position） |
| `RecordReplayInstrumentationGenerator` | 3 | Generator 插桩回调 |
| `RecordReplayInstrumentationReturn` | 3 | 返回值插桩回调 |
| `RecordReplayTrackObjectId` | 1 | 对象 ID 追踪 |

实现位于 `src/runtime/runtime-internal.cc` 和 `src/runtime/runtime-debug.cc`。

## 3. 字节码生成器插桩

### 3.1 BytecodeArrayBuilder（`src/interpreter/bytecode-array-builder.h/cc`）

新增方法：
- `RecordReplayOnProgress()` — 发射进度计数器递增字节码
- `RecordReplayAssertValue(desc)` — 发射值断言字节码
- `RecordReplayRegisterInstrumentationSite(kind, source_position)` — 注册插桩站点
- `RecordReplayInstrumentation(kind, source_position)` — 发射主插桩字节码
- `RecordReplayInstrumentationGenerator(kind, generator_object)` — 发射 Generator 插桩
- `RecordReplayInstrumentationReturn(kind, return_value, source_position)` — 发射返回值插桩
- `RecordReplayTrackObjectId(object)` — 发射对象追踪字节码
- `EmitRecordReplayInstrumentationOpcodes()` — 判断是否需要发射插桩

### 3.2 BytecodeGenerator（`src/interpreter/bytecode-generator.cc`）

在以下位置插入插桩字节码：
- **语句位置**：`SetStatementPosition()` 中调用 `RecordReplayInstrumentation("breakpoint")`
- **函数入口/出口**：函数体开始和返回前
- **条件分支**：if/else、switch-case
- **循环**：for、while、do-while 的每次迭代
- **异常处理**：throw/catch/finally
- **Generator/Async**：yield/await 前后
- **变量赋值**：赋值操作后

### 3.3 解释器生成器（`src/interpreter/interpreter-generator.cc`）

为每个新字节码生成对应的解释器处理程序（handler），调用对应的 Runtime 函数。

## 4. 编译器层适配

### 4.1 Baseline 编译器（`src/baseline/baseline-compiler.cc`）

为 Replay 字节码生成 Baseline JIT 代码，确保 Baseline 编译的代码也能正确执行插桩。

### 4.2 TurboFan 编译器

- **`src/compiler/bytecode-graph-builder.cc`** — 将 Replay 字节码转换为 TurboFan IR 节点
- **`src/compiler/effect-control-linearizer.cc`** — 处理 Replay 节点的效果/控制流线性化
- **`src/compiler/js-call-reducer.cc`** — 在 JS 调用优化中考虑 Replay 约束
- **`src/compiler/js-native-context-specialization.cc`** — 原生上下文特化中的 Replay 适配

### 4.3 Maglev 编译器（`src/maglev/maglev-graph-builder.cc`）

在 Maglev 中间层编译器中处理 Replay 字节码，生成对应的 Maglev IR。

## 5. 执行点系统与进度计数器

### 5.1 外部引用（`src/codegen/external-reference.h/cc`）

```cpp
extern uint64_t* gProgressCounter;    // 全局进度计数器指针
extern uint64_t gTargetProgress;      // 目标进度值

ExternalReference::record_replay_progress_counter()  // 获取计数器地址
ExternalReference::record_replay_target_progress()   // 获取目标进度地址
```

### 5.2 工作原理

1. 每个插桩点递增 `gProgressCounter`
2. 回放时设置 `gTargetProgress`，当计数器达到目标值时触发 `RecordReplayTargetProgressReached`
3. 这实现了"执行到指定位置"的能力（时间旅行调试的基础）

## 6. 确定性保障改动

### 6.1 Math.random（`src/numbers/math-random.cc`）

```cpp
recordreplay::RecordReplayBytes("MathRandom", &v, sizeof(v));
```
录制随机数值，回放时注入相同值。

### 6.2 值序列化（`src/objects/value-serializer.cc`）

- SMI 优化路径禁用：避免 JIT 导致的 SMI/HeapNumber 差异
- 字符串统一为双字节：避免单/双字节表示的不确定性
- 对象/数组序列化走慢路径：避免 JIT/GC 导致的序列化差异

### 6.3 错误消息（`src/execution/messages.cc`）

```cpp
recordreplay::RecordReplayString("ErrorUtils::FormatStackTrace", str);
recordreplay::RecordReplayString("MessageFormatter::Format", str);
```
录制错误堆栈和消息格式化结果，确保回放一致。

### 6.4 Promise/Async 优化禁用（`src/compiler/js-call-reducer.cc`）

录制/回放模式下禁用所有 Promise 相关的 TurboFan 优化，避免非确定性行为：
- `ReducePromiseConstructor()` — 禁用
- `ReducePromisePrototypeFinally()` — 禁用
- `ReducePromisePrototypeThen()` — 禁用
- `ReduceJSAsyncFunctionEnter/Reject/Resolve()` — 禁用
- `ReduceJSPromiseResolve()` — 禁用

### 6.5 编译缓存（`src/codegen/compilation-cache.cc`）

禁用 eval 缓存（`no-eval-cache` 特性标志），避免缓存命中的不确定性。

### 6.6 AST 作用域（`src/ast/scopes.cc`）

`force-variable-context-allocation` 特性标志：回放时强制将变量分配到上下文（而非栈），确保调试器能访问所有变量（RUN-2604）。

### 6.7 编译标志（`src/parsing/parse-info.cc`）

- `record_replay_ignore` — 标记不需要插桩的脚本
- `record_replay_assert_values` — 启用值断言
- `RecordReplayAssertValues(url)` — 根据脚本 URL 判断是否启用断言

## 7. 堆与 GC 改动

| 文件 | 改动 |
|---|---|
| `src/heap/heap.cc` | GC 触发时机确定性 |
| `src/heap/heap-inl.h` | 内联堆操作适配 |
| `src/heap/gc-tracer.cc` | GC 追踪器适配 |
| `src/heap/concurrent-allocator.cc` | 并发分配器确定性 |
| `src/heap/incremental-marking-job.cc` | 增量标记任务适配 |
| `src/heap/large-spaces.cc` | 大对象空间适配 |
| `src/heap/local-heap.cc` | 本地堆适配 |
| `src/heap/memory-reducer.cc/h` | 内存缩减器适配 |
| `src/heap/scavenge-job.cc` | 新生代 GC 适配 |

核心思路：GC 是非确定性来源，需要确保录制和回放时 GC 行为一致。

## 8. Debug/Inspector 改动

| 文件 | 改动 |
|---|---|
| `src/debug/debug.cc` | 调试器核心适配 |
| `src/debug/debug-stack-trace-iterator.cc` | 堆栈迭代器适配 |
| `src/inspector/v8-inspector-impl.cc` | Inspector 实现适配 |
| `src/inspector/v8-inspector-session-impl.cc/h` | Session 管理，协议消息注解 |
| `src/inspector/v8-debugger-agent-impl.cc` | 调试代理适配 |
| `src/inspector/v8-runtime-agent-impl.cc` | 运行时代理适配 |
| `src/inspector/v8-console-message.cc` | Console 消息捕获 |
| `src/inspector/injected-script.cc` | 注入脚本适配 |
| `src/inspector/value-mirror.cc` | 值镜像适配 |

关键功能：
- `RecordReplayMessageAnnotation()` — 为协议消息添加录制注解
- `V8RecordReplayOnAnnotation()` — 外部注解回调
- `V8RecordReplayNewBookmark()` — 创建执行书签（用于异常处理）

## 9. 对象追踪与字符串录制

### 9.1 专用模块（`src/replay/replayio.cc/h`）

```cpp
namespace v8::replayio {
  Handle<String> RecordReplayStringHandle(why, isolate, input);
  // 录制字符串内容，回放时返回录制值
}
```

### 9.2 对象相关（`src/objects/`）

- `js-objects.cc/js-objects-inl.h` — JS 对象操作适配
- `objects.cc` — 通用对象操作适配

## 10. 平台与基础设施

| 文件 | 改动 |
|---|---|
| `src/base/logging.cc` | 日志系统适配（崩溃时不终止录制） |
| `src/base/platform/mutex.cc` | 互斥锁确定性 |
| `src/base/platform/platform-darwin.cc` | macOS 平台适配 |
| `src/base/platform/platform-linux.cc` | Linux 平台适配 |
| `src/handles/handles.cc` | 句柄系统适配 |
| `src/libplatform/tracing/tracing-controller.cc` | 追踪控制器适配 |
| `src/codegen/x64/assembler-x64.cc` | x64 汇编器适配 |
| `src/wasm/wasm-code-manager.h` | WASM 代码管理器适配 |

## 11. 公共 API

### include/replayio.h

Replay 运行时的 C++ API 头文件，定义了：
- `recordreplay::IsRecordingOrReplaying()` — 检查当前模式
- `recordreplay::IsRecording()` / `IsReplaying()` — 分别检查
- `recordreplay::RecordReplayValue()` — 录制/回放标量值
- `recordreplay::RecordReplayBytes()` — 录制/回放字节块
- `recordreplay::RecordReplayString()` — 录制/回放字符串
- `recordreplay::AreEventsDisallowed()` — 检查事件是否被禁止
- `recordreplay::InvalidateRecording()` — 使录制无效
- `recordreplay::Print()` / `Warning()` / `Diagnostic()` — 日志输出
- `recordreplay::Assert()` / `HasAsserts()` — 断言系统

### include/replayio-macros.h

Replay 相关的宏定义。

### include/v8.h

在 V8 公共 API 中添加 `recordreplay` 类：
```cpp
class V8_EXPORT recordreplay {
  static RecordReplayValue(why, v);
  static RecordReplayBytes(why, buf, size);
  static RecordReplayString(why, str);
  // ...
};
```

## 12. 完整文件清单（70 个）

### 公共头文件（5 个）
- `include/replayio.h`
- `include/replayio-macros.h`
- `include/v8.h`
- `include/v8-object.h`
- `include/v8-platform.h`

### 解释器（4 个）
- `src/interpreter/bytecodes.h`
- `src/interpreter/bytecode-array-builder.h`
- `src/interpreter/bytecode-array-builder.cc`
- `src/interpreter/bytecode-generator.cc`
- `src/interpreter/interpreter-generator.cc`

### 编译器（5 个）
- `src/baseline/baseline-compiler.cc`
- `src/compiler/bytecode-graph-builder.cc`
- `src/compiler/effect-control-linearizer.cc`
- `src/compiler/js-call-reducer.cc`
- `src/compiler/js-native-context-specialization.cc`
- `src/maglev/maglev-graph-builder.cc`

### 运行时（3 个）
- `src/runtime/runtime.h`
- `src/runtime/runtime-internal.cc`
- `src/runtime/runtime-debug.cc`

### 执行层（7 个）
- `src/execution/execution.cc`
- `src/execution/frames.cc`
- `src/execution/futex-emulation.cc`
- `src/execution/isolate.cc`
- `src/execution/isolate.h`
- `src/execution/messages.cc`
- `src/execution/microtask-queue.h`
- `src/execution/stack-guard.cc`

### 堆/GC（9 个）
- `src/heap/heap.cc`
- `src/heap/heap-inl.h`
- `src/heap/gc-tracer.cc`
- `src/heap/concurrent-allocator.cc`
- `src/heap/incremental-marking-job.cc`
- `src/heap/large-spaces.cc`
- `src/heap/local-heap.cc`
- `src/heap/memory-reducer.cc`
- `src/heap/memory-reducer.h`
- `src/heap/scavenge-job.cc`

### Inspector/Debug（9 个）
- `src/debug/debug.cc`
- `src/debug/debug-stack-trace-iterator.cc`
- `src/inspector/v8-inspector-impl.cc`
- `src/inspector/v8-inspector-session-impl.cc`
- `src/inspector/v8-inspector-session-impl.h`
- `src/inspector/v8-debugger-agent-impl.cc`
- `src/inspector/v8-runtime-agent-impl.cc`
- `src/inspector/v8-console-message.cc`
- `src/inspector/injected-script.cc`
- `src/inspector/value-mirror.cc`

### 对象/值（5 个）
- `src/objects/js-objects.cc`
- `src/objects/js-objects-inl.h`
- `src/objects/objects.cc`
- `src/objects/value-serializer.cc`
- `src/numbers/math-random.cc`

### Replay 专用模块（2 个）
- `src/replay/replayio.cc`
- `src/replay/replayio.h`

### 代码生成（3 个）
- `src/codegen/external-reference.h` (推断)
- `src/codegen/compilation-cache.cc`
- `src/codegen/compiler.cc`
- `src/codegen/x64/assembler-x64.cc`

### 平台/基础（6 个）
- `src/base/logging.cc`
- `src/base/platform/mutex.cc`
- `src/base/platform/platform-darwin.cc`
- `src/base/platform/platform-linux.cc`
- `src/handles/handles.cc`
- `src/libplatform/tracing/tracing-controller.cc`

### 其他（5 个）
- `src/api/api.cc`
- `src/ast/scopes.cc`
- `src/builtins/builtins-global.cc`
- `src/parsing/parse-info.cc`
- `src/parsing/pending-compilation-error-handler.cc`
- `src/profiler/heap-snapshot-generator.cc`
- `src/wasm/wasm-code-manager.h`