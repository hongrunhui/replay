# Replay.io Node 录制机制逆向分析

> 分析对象: `~/.replay/node/node`
> 分析日期: 2026-03-12
> Build ID: `macOS-node-20230531-9e516dd8b367-ae8a9ca6220f`

## 1. 基本信息

- **文件类型**: Mach-O 64-bit x86_64 可执行文件，约 80MB
- **本质**: 魔改过的 **Node.js v16** (module version 93) 二进制文件，静态链接了 Replay.io 的录制运行时
- **动态依赖**: 仅依赖 `CoreFoundation`、`libSystem.B.dylib`、`libc++.1.dylib`（几乎全部静态链接）
- **导出符号**: 116 个 `recordreplay` 相关符号

## 2. 核心录制原理 —— 确定性重放 (Deterministic Replay)

Replay 的核心思想：运行时程序本身是**大部分确定性的**。给定相同的输入（网络数据、用户事件等），程序会以相同方式运行。

**关键洞察:**
- 99.99% 的计算是确定性的，实际需要捕获的 OS 调用并不多
- 平均每秒大约 1MB 的录制数据——相比计算机每秒执行数十亿次操作微不足道
- 只需记录输入和内部非确定性因素，就能完全重放程序行为
- 录制开销约 3.5%，远低于 DataDog/Sentry 等可观测性工具

**录制而非快照：**
- 不是记录状态随时间的变化（对浏览器来说，加载一个网页就能执行数十亿次操作）
- 而是记录外部输入 + 非确定性源，然后重放时重新执行得到完全相同的行为

## 3. 拦截层实现 —— libc 级别函数拦截

Replay 不是通过 mock 函数或 ptrace，而是通过**内联汇编代码** (inline assembly trampolines) 来拦截底层 OS 库调用。

### 3.1 拦截框架 (namespace `recordreplay`)

核心 C++ 类和函数：

```cpp
// 拦截基础设施
recordreplay::InterceptSpecifier     // 定义要拦截的函数签名
recordreplay::CreateIntercept()      // 创建拦截点
recordreplay::DoIntercept()          // 执行拦截
recordreplay::DoInterceptCallback()  // 执行回调拦截

// 动态库级拦截
recordreplay::MaybeInterceptBinding()               // 拦截动态库绑定
recordreplay::MaybeInterceptDynamicLibraryBinding()  // 拦截 dlopen/dlsym
recordreplay::MaybeInterceptVTableEntry()            // 拦截虚函数表条目
recordreplay::InterceptCallbackVTableEntry()         // 回调的虚表拦截
recordreplay::GetFunctionForIntercept()              // 获取拦截函数
```

### 3.2 Compose 模板系统

使用 C++ 模板元编程组合拦截行为，非常精巧：

```cpp
// 参数录制模板
CStringArg<N>          // 记录第 N 个参数为 C 字符串
FileDescriptorArg<N>   // 记录文件描述符参数
ScalarArg<N, Size>     // 记录标量参数
UpdateCStringArg<N>    // 更新 C 字符串参数

// 返回值录制模板
ScalarRval                    // 记录标量返回值
ScalarRvalSaveErrorNegative   // 记录返回值，负值时保存 errno
ScalarRvalSaveErrorZero       // 记录返回值，零值时保存 errno
ScalarRvalMaybeAliasArg<N>    // 返回值可能是某个参数的别名

// 输出参数录制模板
OutBuffer<buf, size, ...>      // 记录输出缓冲区
OutBufferUpdateSize            // 更新大小的输出缓冲区
OutBufferRvalIsSize<buf, sz>   // 返回值就是输出大小
OutParam<N, Size, nullable>    // 记录输出参数
OutParamMaybeAliasArg<N, M>    // 可能是参数别名的输出参数
InOutParam<N, Size>            // 记录双向参数

// 控制流模板
CallNoOp                              // 空操作
CallPassThroughIfUnknown               // 未知调用时透传
CallPassThroughIfDisallowedOrUnknown   // 禁止或未知时透传
CallSetErrorIfUnknown<Constant>        // 未知时设置错误
CallIgnoreIfUnknown<N>                 // 未知时忽略
CallIgnore<N>                          // 忽略

// 组合示例：拦截一个接收(path, buf, size)并返回ssize_t的函数
// Compose<CStringArg<0>, OutBuffer<1,2,1,8,0>, ScalarRvalSaveErrorNegative, ...>
```

**这个方法的优雅之处**: libc 层面相当稳定且定义明确，拦截 libc 调用的开销极低。

## 4. 事件模型

三种事件区域管理模式：

### 4.1 透传模式 (PassThrough)
```cpp
RecordReplayBeginPassThroughEvents()
RecordReplayEndPassThroughEvents()
// 以及紧急控制
recordreplay::StopAllPassThroughEvents()
recordreplay::ResumeAllPassThroughEvents()
```
某些调用不需要录制，直接透传到真实 OS。

### 4.2 禁止事件模式 (Disallow)
```cpp
RecordReplayBeginDisallowEvents()
RecordReplayBeginDisallowEventsWithLabel(const char*)  // 带标签版本，方便调试
RecordReplayEndDisallowEvents()
```
在某些关键代码路径中禁止产生非确定性事件。

### 4.3 回调区域 (CallbackRegion)
```cpp
RecordReplayBeginCallbackRegion()
RecordReplayEndCallbackRegion()
// node 层:
node::recordreplay::BeginCallbackRegion()
node::recordreplay::EndCallbackRegion()
```
标记 OS 回调进入运行时的边界，这是录制外部输入的关键点。

**日志消息（从字符串提取）:**
```
InterceptCallback Start %s
InterceptCallback InsideCallbackRegion %zu %s
InterceptCallback Done %s
InterceptCallback Done
```

## 5. V8 引擎集成

在 `v8::recordreplay` 命名空间中暴露的完整 API：

### 5.1 状态查询
```cpp
v8::recordreplay::IsRecording()              // 是否在录制
v8::recordreplay::IsReplaying()              // 是否在重放
v8::recordreplay::IsRecordingOrReplaying()   // 任一
v8::recordreplay::HasDivergedFromRecording() // 重放是否偏离
```

### 5.2 数据录制
```cpp
v8::recordreplay::RecordReplayValue(const char* name, unsigned long val)
// 录制标量值（非确定性值如时间戳、随机数）

v8::recordreplay::RecordReplayBytes(const char* name, void* buf, unsigned long size)
// 录制字节流（如网络数据）
```

### 5.3 执行进度与检查点
```cpp
v8::recordreplay::NewCheckpoint()              // 创建检查点
v8::recordreplay::NewBookmark()                // 创建书签点
RecordReplayNewCheckpointFlushed()             // 已刷盘的检查点
RecordReplayProgressReached()                  // 进度到达
RecordReplayTargetProgressReached()            // 目标进度到达
RecordReplayCurrentExecutionPoint()            // 获取当前执行点
RecordReplayElapsedTimeMs()                    // 已用时间(ms)
RecordReplayIncExecutionProgressCounter()      // 递增执行进度计数器
RecordReplayEnableProgressCheckpoints()        // 启用进度检查点
```

### 5.4 指针 ID 系统
```cpp
v8::recordreplay::RegisterPointer(const void*)     // 注册指针
v8::recordreplay::UnregisterPointer(const void*)   // 注销指针
v8::recordreplay::PointerId(const void*)            // 获取指针 ID
v8::recordreplay::IdPointer(int)                    // ID -> 指针

// 将非确定性的堆地址映射为确定性的 ID
// 确保录制和重放时使用一致的标识符
```

### 5.5 有序锁 (Ordered Lock)
```cpp
v8::recordreplay::CreateOrderedLock(const char* name) // 创建
v8::recordreplay::OrderedLock(int id)                  // 加锁
v8::recordreplay::OrderedUnlock(int id)                // 解锁
RecordReplayAddOrderedPthreadMutex()                   // 添加有序 pthread mutex
```
确保多线程下锁的获取顺序确定性。

### 5.6 断言与诊断
```cpp
v8::recordreplay::Assert(const char* fmt, ...)
v8::recordreplay::AssertBytes(const char*, const void*, unsigned long)
v8::recordreplay::Diagnostic(const char* fmt, ...)
v8::recordreplay::Print(const char* fmt, ...)

RecordReplayAssertValue()
RecordReplayAssertExecutionProgress()
RecordReplayHadMismatch()              // "Invalid record-time call"
RecordReplayInvalidateRecording()
RecordReplayGetUnusableRecordingReason()
```

### 5.7 副作用控制
```cpp
v8::recordreplay::AllowSideEffects()
v8::recordreplay::AreEventsDisallowed()
v8::recordreplay::SetRecordingOrReplaying(void*)
```

### 5.8 调试器回调
```cpp
RecordReplayOnNewSource()              // 新脚本加载
RecordReplayOnDebuggerStatement()      // debugger 语句
RecordReplayOnExceptionUnwind()        // 异常展开
RecordReplayOnConsoleMessage()         // 控制台消息
RecordReplayOnAnnotation()             // 标注
RecordReplayOnInstrument()             // 插桩

RecordReplayAddPossibleBreakpoint()    // 添加可能的断点
RecordReplaySetPossibleBreakpointsCallback()
RecordReplaySetProgressCallback()
RecordReplaySetChangeInstrumentCallback()
RecordReplaySetCrashReasonCallback()
RecordReplaySetDefaultCommandCallback()
RecordReplaySetFaultCallback()
RecordReplaySetFreeCallback()
RecordReplaySetTrackObjectsCallback()
```

### 5.9 V8 桥接层（Node C++ 绑定）
```cpp
// 从 V8 FunctionCallbackInfo 暴露给 JS 的函数
node::process::RecordReplayLog()
node::process::RecordReplaySendCDPMessage()
node::process::RecordReplaySetCDPMessageCallback()

// Inspector 集成
node::process::RecordReplaySessionDelegate::SendMessageToFrontend()
```

## 6. 嵌入的 JS 模块

6 个内建 JS 模块被编译嵌入二进制中：

| 模块 | 用途 |
|------|------|
| `lib/internal/recordreplay/main.js` | 初始化入口，挂载 `process.recordreplay` 对象 |
| `lib/internal/recordreplay/message.js` | CDP 消息处理 |
| `lib/internal/recordreplay/object.js` | 对象序列化/预览 |
| `lib/internal/recordreplay/preview.js` | 调试预览功能 |
| `lib/internal/recordreplay/sourcemap.js` | Source map 处理与上传 |
| `lib/internal/recordreplay/utils.js` | 工具函数 |

### 6.1 process.recordreplay JS API

从 rawMethods (C++ 绑定) 暴露到 JS 层：

```javascript
// process.recordreplay 对象结构
const recordreplay = {
  // 基础信息
  recordingId: rawMethods.recordReplayRecordingId,
  currentPoint: rawMethods.recordReplayCurrentExecutionPoint,
  elapsedTime: rawMethods.recordReplayElapsedTimeMs,

  // 日志与断言
  log: rawMethods.recordReplayLog,
  assert: rawMethods.recordReplayAssert,

  // CDP 通信
  _sendCDPMessage: rawMethods.recordReplaySendCDPMessage,
  _setCDPMessageCallback: rawMethods.recordReplaySetCDPMessageCallback,

  // 脚本管理
  _ignoreScript: rawMethods.recordReplayIgnoreScript,

  // 调试器集成
  _onConsoleAPI: rawMethods.recordReplayOnConsoleAPI,
  _getCurrentError: rawMethods.recordReplayGetCurrentError,
  _setCommandCallback: rawMethods.recordReplaySetCommandCallback,
  _setClearPauseDataCallback: rawMethods.recordReplaySetClearPauseDataCallback,
};

// 初始化流程
const { initializeRecordReplay } = require('internal/recordreplay/main');
if (rawMethods.isRecordingOrReplaying()) {
  initializeRecordReplay();
}
```

### 6.2 录制事件与 URL 生成

```javascript
// 添加录制事件
addRecordingEvent({ recordingId, ... });

// 生成调试 URL
const point = rawMethods.recordReplayCurrentExecutionPoint();
const recordingId = rawMethods.recordReplayRecordingId();
const time = rawMethods.recordReplayElapsedTimeMs();
return `https://app.replay.io/recording/${recordingId}?point=${point}&hasFrames=true&time=${time}`;
```

### 6.3 录制目录管理

```javascript
// 获取录制目录 (与 gecko-dev 和 recordings cli 中的逻辑对应)
function getRecordingDirectory() {
  const recordingDir = process.env["RECORD_REPLAY_DIRECTORY"];
  if (recordingDir) return recordingDir;
  return path.join(homeDir, ".replay");
}

// 写入录制日志
const filepath = path.join(recordingDir, "recordings.log");

// 写入源码/sourcemap 到录制目录
function writeToRecordingDirectory(name, content) {
  const filepath = path.join(recordingDir, filename);
  // ...
}
```

## 7. 录制生命周期

```
RecordReplaySetApiKey()          ← 设置 API Key
        ↓
RecordReplayAttach()             ← 附加到进程，开始录制
        ↓
   [正常运行 Node.js 程序]
   - 拦截所有 libc 调用
   - 录制非确定性值
   - 创建 checkpoint
   - 记录 recording events
        ↓
RecordReplayFinishRecording()    ← 完成录制
        ↓
RecordReplaySaveRecording()      ← 保存到磁盘
        ↓
RecordReplayRememberRecording()  ← 记录到 recordings.log
```

**错误处理:**
- `RecordReplayInvalidateRecording()` — 使录制无效
- `RecordReplayGetUnusableRecordingReason()` — 获取不可用原因
- `RecordReplaySetCrashReasonCallback()` — 崩溃原因回调
- `RecordReplaySetCrashNote()` — 设置崩溃备注

## 8. 环境变量

| 变量 | 用途 |
|------|------|
| `RECORD_REPLAY_DIRECTORY` | 录制存储目录 (默认 `~/.replay`) |
| `RECORD_REPLAY_API_KEY` | API 密钥 (录制完成后会被 unsetenv) |
| `RECORD_REPLAY_SERVER` | 后端服务器地址 |
| `RECORD_REPLAY_DRIVER` | 驱动程序路径 (.so) |
| `RECORD_REPLAY_DISPATCH` | 调度配置 |
| `RECORD_REPLAY_DONT_RECORD` | 禁用录制 |
| `RECORD_REPLAY_INSTRUMENT_NODE` | Node 插桩开关 |
| `RECORD_REPLAY_METADATA` | 录制元数据 |
| `RECORD_REPLAY_METADATA_FILE` | 元数据文件路径 |
| `RECORD_REPLAY_RECORDING_ID_FILE` | 录制 ID 输出文件 |
| `RECORD_REPLAY_DISABLE_ASSERTS` | 禁用断言 |
| `RECORD_REPLAY_DISABLE_FEATURES` | 禁用特定功能 |
| `RECORD_REPLAY_DISABLE_FUNCTIONS` | 禁用特定函数拦截 |
| `RECORD_REPLAY_PRETEND_NOT_RECORDING` | 伪装未在录制 |
| `RECORD_REPLAY_JS_ASSERTS` | JS 断言控制 |
| `RECORD_REPLAY_JS_ASSERT_FILTERS` | JS 断言过滤器 |
| `RECORD_REPLAY_RECORD_JS_ASSERTS` | 录制 JS 断言 |
| `RECORD_REPLAY_LOG_DIRECTORY` | 日志目录 |
| `RECORD_REPLAY_CHECKPOINT_PROGRESS_INTERVAL` | 检查点进度间隔 |
| `RECORD_REPLAY_CRASH_AT_WARNING` | 警告时崩溃 (调试用) |
| `RECORD_REPLAY_DUMP_ANNOTATIONS` | 转储标注 |
| `RECORD_REPLAY_DUMP_PAINTS` | 转储绘制 |
| `RECORD_REPLAY_REMEMBER_ALL_DIAGNOSTICS` | 记住所有诊断信息 |
| `RECORD_REPLAY_TEST_ENVIRONMENT` | 测试环境标记 |

## 9. 整体架构图

```
┌───────────────────────────────────────────────────────┐
│                 Replay Node Binary (~80MB)             │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  Modified Node.js v16 (module version 93)        │  │
│  │                                                   │  │
│  │  ┌───────────────────────────────────────────┐   │  │
│  │  │  Modified V8 Engine                        │   │  │
│  │  │  v8::recordreplay namespace                │   │  │
│  │  │  - IsRecording/IsReplaying 状态管理        │   │  │
│  │  │  - Value/Bytes 非确定性数据录制            │   │  │
│  │  │  - Checkpoint/Bookmark 执行点管理          │   │  │
│  │  │  - OrderedLock 有序锁（线程确定性）        │   │  │
│  │  │  - Pointer ID 指针地址确定性映射           │   │  │
│  │  │  - Assert 重放一致性验证                   │   │  │
│  │  └───────────────────────────────────────────┘   │  │
│  │                                                   │  │
│  │  ┌───────────────────────────────────────────┐   │  │
│  │  │  recordreplay C++ Runtime                  │   │  │
│  │  │  - InterceptSpecifier 拦截规范定义         │   │  │
│  │  │  - Compose<> 模板元编程拦截组合            │   │  │
│  │  │  - Inline ASM trampolines 内联汇编跳板     │   │  │
│  │  │  - Event Regions:                          │   │  │
│  │  │    · PassThrough (透传，不录制)            │   │  │
│  │  │    · Disallow (禁止非确定性事件)           │   │  │
│  │  │    · CallbackRegion (OS回调边界)           │   │  │
│  │  │  - Recording file I/O                      │   │  │
│  │  │  - Dynamic library binding interception    │   │  │
│  │  └───────────────────────────────────────────┘   │  │
│  │                                                   │  │
│  │  ┌───────────────────────────────────────────┐   │  │
│  │  │  Embedded JS Modules (6个)                 │   │  │
│  │  │  - main.js    → 初始化 + process.recordreplay │ │
│  │  │  - message.js → CDP 消息桥接              │   │  │
│  │  │  - object.js  → 对象序列化                │   │  │
│  │  │  - preview.js → 调试预览                  │   │  │
│  │  │  - sourcemap.js → SourceMap 处理          │   │  │
│  │  │  - utils.js   → 工具函数                  │   │  │
│  │  └───────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  拦截目标: libc 调用, dylib 绑定, vtable 条目,       │
│  文件 I/O, 网络 I/O, 线程原语, 时间/随机数源         │
└───────────────────────────────────────────────────────┘
                    │ 录制数据写入
                    ▼
           ~/.replay/recordings.log
           ~/.replay/<recording-files>
                    │ 上传
                    ▼
           app.replay.io → 时间旅行调试 (Time Travel Debugging)
```

## 10. 与 rr (Record and Replay) 项目的对比

Replay.io 的创始人 (Jason Laster, Brian Hackett) 与 Mozilla 的 rr 项目有深厚渊源，但采用了不同的技术路线：

| 特性 | rr | Replay.io |
|------|-----|-----------|
| 拦截层级 | syscall 级 (ptrace) | libc/library 级 (inline asm) |
| 平台 | Linux only | macOS + Linux |
| 目标 | 通用 C/C++ 程序 | 浏览器/Node.js 运行时 |
| 多线程 | 单核模拟 | 有序锁确保确定性 |
| 修改内核 | 不需要 | 不需要 |
| 修改运行时 | 不需要 | 需要 (fork V8/Node) |
| 开销 | ~1.2x | ~1.035x (3.5%) |

## 11. 关键参考资源

- [How Replay Works (Blog)](https://blog.replay.io/how-replay-works)
- [How Programmatic Recordings Work (Docs)](https://docs.replay.io/learn-more/contribute/how-replay-works/how-programmatic-recordings-work)
- [replay-node-cli (GitHub)](https://github.com/replayio/replay-node-cli)
- [RecordReplay Org (GitHub)](https://github.com/RecordReplay)
- [Replay DevTools (GitHub)](https://github.com/replayio/devtools)
- [Replay Chrome Runtime Docs](https://docs.replay.io/reference/replay-runtimes/replay-chrome)

## 12. 分析方法

本分析使用以下逆向工程手段：
- `file` — 确定二进制类型
- `otool -L` — 查看动态库依赖
- `nm -gU` + `c++filt` — 导出符号分析与 C++ 名称还原
- `strings` + `grep` — 字符串提取与模式匹配
- Web 搜索 — 交叉验证官方文档和博客

未使用反汇编器 (如 Ghidra/IDA)，仅通过符号和字符串分析即获得了丰富的架构信息。
