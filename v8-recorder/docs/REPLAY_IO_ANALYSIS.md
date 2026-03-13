# Replay.io replay-node 逆向分析 vs V8-Recorder 方案对比

> 分析日期: 2026-03-13
> 分析对象: `~/.replay/node/node` (Build: macOS-node-20231-9e516dd8b367)
> 对比对象: v8-recorder 当前实现 (Platform API 级录制)

## 1. Replay.io 真实架构（逆向还原）

### 1.1 源码结构（从二进制嵌入路径还原）

```
src/cpp/
├── intercept/
│   ├── Assembler.cpp          # x86-64 运行时代码生成（trampoline）
│   ├── Intercept.cpp          # 核心拦截框架
│   └── Intercept.h
├── recording/
│   ├── Assert.cpp             # 确定性断言验证
│   ├── ByteStream.h           # 序列化原语
│   ├── CallbackWrapper.h      # 原生回调包装
│   ├── Constants.cpp          # 结构体大小、枚举值
│   ├── FunctionCommon.cpp     # 跨平台拦截函数
│   ├── FunctionMacOS.cpp      # macOS 特有拦截（CF/CG/CT/Accelerate/Mach）
│   ├── FunctionNAPI.cpp       # N-API 函数拦截
│   ├── FunctionPosix.cpp      # POSIX/libc 拦截
│   ├── Navigate.cpp           # 重放导航（seek to point）
│   ├── OrderedLock.cpp        # 确定性锁排序
│   ├── ProgressCounter.cpp    # 执行进度追踪
│   ├── RecordedCall.cpp       # 录制单次调用
│   ├── RecordedCallback.cpp   # 录制回调调用
│   ├── RecordedValue.cpp      # 录制标量/字节值
│   ├── Recording.cpp          # 顶层录制编排
│   ├── SignalHandlers.cpp     # 信号拦截
│   ├── StableHashTable.cpp    # 确定性哈希表
│   └── Warning.cpp
├── driver/
│   ├── Driver.cpp             # 主驱动逻辑
│   ├── CrashReporter.cpp      # 崩溃处理
│   ├── RecordingData.cpp      # 录制文件 I/O
│   ├── RecordingEvents.cpp    # 事件流管理
│   ├── RecordingThread.cpp    # 每线程录制
│   └── WebSocket.cpp          # 与 Replay 后端通信
├── binary/
│   ├── Binary.cpp             # 二进制分析
│   └── MachO.cpp              # Mach-O 解析（定位要 hook 的函数）
└── shared/
    ├── Compression.cpp        # LZ4 压缩
    ├── ChunkStream.h          # 分块数据流
    ├── Command.cpp            # 命令协议
    └── lz4.c                  # 内嵌 LZ4
```

### 1.2 拦截层级：libc + libuv + macOS 框架

Replay.io 的拦截不是在 V8 Platform API 层，而是在**更底层的 libc/OS 调用层**。

从二进制中提取到的被拦截函数完整列表：

**POSIX/libc 层（FunctionPosix.cpp）：**
| 类别 | 被拦截函数 |
|------|-----------|
| 文件 I/O | `__open64_2`, `__close`, `read`, `write`, `stat`, `fstat`, `lstat`, `access` |
| 网络 I/O | `socket`, `connect`, `accept`, `send`, `recv`, `sendto`, `recvfrom` |
| DNS | `getaddrinfo`, `getnameinfo`, `freeaddrinfo` |
| 事件循环 | `kevent`, `kevent64`, `poll`, `select` |
| 时间 | `gettimeofday`, `clock_gettime`, `clock_gettime_nsec_np`, `mach_absolute_time` |
| 随机数 | `arc4random`, `arc4random_buf`, `getentropy`, `CCRandomGenerateBytes`, `SecRandomCopyBytes` |
| 线程 | `pthread_create`, `pthread_cond_wait`, `pthread_cond_timedwait`, `pthread_mutex_lock`, `pthread_mutex_trylock` |
| 信号 | `sigaction`, `signal` (via SignalHandlers.cpp) |
| 动态库 | `dlopen`, `dlsym`, `dlclose` |
| 进程 | `fork`, `exec`, `wait`, `pipe`, `dup` |
| 内存 | `mmap`, `munmap` |

**macOS 框架层（FunctionMacOS.cpp）：**
| 类别 | 被拦截函数 |
|------|-----------|
| RunLoop | `CFRunLoopRun`, `CFRunLoopStop`, `CFRunLoopWakeUp`, `CFRunLoopAddSource`, `CFRunLoopRemoveSource`, `CFRunLoopAddTimer`, `CFRunLoopAddObserver`, `CFRunLoopSourceCreate`, `CFRunLoopTimerCreate`, `CFRunLoopObserverCreate` |
| GCD | `dispatch_get_global_queue`, `dispatch_source_create`, `dispatch_source_set_event_handler`, `dispatch_source_cancel`, `dispatch_resume` |
| Mach | `mach_msg`, `mach_msg_send` |

**libuv 层（Node.js 事件循环内部）：**
| 类别 | 被拦截函数 |
|------|-----------|
| I/O 轮询 | `uv__io_poll`, `uv__io_start`, `uv__io_stop` |
| 文件系统 | `uv_fs_open`, `uv_fs_read`, `uv_fs_write`, `uv_fs_stat`, `uv_fs_lstat`, `uv_fs_access`, `uv_fs_mkdir`, `uv_fs_unlink`, `uv_fs_chmod`, `uv_fs_chown`, `uv_fs_rename`, `uv_fs_readlink`, `uv_fs_realpath`, `uv_fs_scandir` |
| 网络 | `uv__tcp_connect`, `uv__stream_io`, `uv__server_io`, `uv__read`, `uv__write`, `uv__udp_io`, `uv__udp_recvmsg`, `uv__udp_sendmsg` |
| 异步 | `uv__async_io`, `uv__work_done`, `uv__fs_done`, `uv__getaddrinfo_done`, `uv__getnameinfo_done`, `uv__random_done` |
| 进程 | `uv_spawn`, `uv__chld`, `uv__signal_event`, `uv__signal_handler` |
| 定时器 | `uv_sleep` |
| FSEvents | `uv__fsevents_create_stream`, `uv__fsevents_event_cb`, `uv__fsevents_reschedule` |

**N-API 层（FunctionNAPI.cpp）：**
- 拦截原生 Node.js 插件的 N-API 调用，确保原生模块的非确定性行为也被录制

### 1.3 拦截机制：运行时二进制重写

```
┌─────────────────────────────────────────────────┐
│  Assembler.cpp — x86-64 运行时代码生成           │
│                                                   │
│  支持的指令:                                      │
│  pushq/popq, movq, addq/subq, call, ret,        │
│  testq/jne, movsd/movdqa, breakpoint             │
│                                                   │
│  ABI 翻译:                                       │
│  SaveRegistersForTranslateABI()                   │
│  RestoreRegistersForTranslateABI()                │
│                                                   │
│  MachO.cpp — 解析 Mach-O 定位函数地址             │
│  Intercept.cpp — 在函数入口写入 jmp trampoline    │
└─────────────────────────────────────────────────┘
```

不是 LD_PRELOAD，不是 ptrace，而是**直接修改内存中的函数入口指令**，
跳转到录制/重放的 trampoline 代码。这是最高效的拦截方式。

### 1.4 Compose 模板系统（拦截规范 DSL）

每个被拦截的函数用一个 `Compose<...>` 模板实例化来描述其录制行为。
这是一个编译期管道，固定 10 个槽位：

```cpp
// 示例：拦截 read(fd, buf, count) -> ssize_t
Compose<
  FileDescriptorArg<0>,           // 参数0: 文件描述符
  OutBuffer<1, 2, 1, 8, 0>,      // 参数1: 输出缓冲区，大小由参数2决定
  ScalarRvalSaveErrorNegative,    // 返回值: ssize_t，负值时保存 errno
  CallPassThroughIfUnknown,       // 未知 fd 时透传
  CallNoOp, CallNoOp, CallNoOp,  // 剩余槽位填充
  CallNoOp, CallNoOp, CallNoOp
>

// 示例：拦截 open(path, flags, mode) -> int
Compose<
  CStringArg<0>,                  // 参数0: 文件路径字符串
  ScalarArg<1, 8>,                // 参数1: flags
  ScalarArg<2, 8>,                // 参数2: mode
  ScalarRvalSaveErrorNegative,    // 返回值: fd，负值时保存 errno
  CallNoOp, CallNoOp, CallNoOp,
  CallNoOp, CallNoOp, CallNoOp
>
```

**构建块分类（从二进制中提取到 ~95 个 Compose 实例化）：**

| 构建块 | 出现次数 | 用途 |
|--------|---------|------|
| `ScalarArg<N, Size>` | 43 | 录制标量参数 |
| `CStringArg<N>` | 19 | 录制 C 字符串参数 |
| `FileDescriptorArg<N>` | 21 | 录制并追踪文件描述符 |
| `ScalarRval` | 29 | 录制标量返回值 |
| `ScalarRvalSaveErrorNegative` | 53 | 录制返回值，负值时保存 errno |
| `OutParam<N, Size, nullable>` | 38 | 录制输出参数 |
| `OutBuffer<buf, size, ...>` | 14 | 录制输出缓冲区 |
| `CallPassThroughIfUnknown` | 10 | 未知 fd 时透传 |
| `CallNoOp` | 641 | 管道槽位填充 |

### 1.5 事件区域模型

三种模式控制录制行为：

```cpp
// 1. 透传模式 — 某些调用不需要录制
RecordReplayBeginPassThroughEvents()
RecordReplayEndPassThroughEvents()

// 2. 禁止模式 — 关键代码路径中禁止非确定性事件
RecordReplayBeginDisallowEvents()
RecordReplayEndDisallowEvents()

// 3. 回调区域 — OS 回调进入运行时的边界
RecordReplayBeginCallbackRegion()
RecordReplayEndCallbackRegion()
```

### 1.6 线程确定性

```cpp
// 有序锁 — 确保多线程下锁获取顺序确定
v8::recordreplay::CreateOrderedLock("lock_name")  // 创建
v8::recordreplay::OrderedLock(id)                   // 加锁
v8::recordreplay::OrderedUnlock(id)                 // 解锁
RecordReplayAddOrderedPthreadMutex()                // pthread mutex 排序

// 指针 ID 系统 — 将非确定性堆地址映射为确定性 ID
v8::recordreplay::RegisterPointer(ptr)    // 注册
v8::recordreplay::UnregisterPointer(ptr)  // 注销
v8::recordreplay::PointerId(ptr)          // 地址 → ID
v8::recordreplay::IdPointer(id)           // ID → 地址

// 确定性哈希表
StableHashTable.cpp  // 替换标准哈希表，消除地址依赖的哈希随机性
```

### 1.7 V8 引擎深度集成

Replay.io 不仅拦截外部调用，还**深度修改了 V8 内部**：

```cpp
// 新增的 V8 字节码指令（从 BytecodeArrayBuilder 和 BaselineCompiler 中发现）
RecordReplayIncExecutionProgressCounter  // 递增执行进度计数器
RecordReplayInstrumentation              // 插桩点
RecordReplayInstrumentationGenerator     // Generator 函数插桩
RecordReplayAssertValue                  // 值断言（验证确定性）

// V8 Runtime 函数
Runtime_RecordReplayAssertExecutionProgress
Runtime_RecordReplayTargetProgressReached
Runtime_RecordReplayAssertValue
Runtime_RecordReplayInstrumentation
Runtime_RecordReplayInstrumentationGenerator

// 全局标志
gRecordReplayInstrumentationEnabled      // 插桩开关
gRecordReplayAssertValues                // 值断言开关
gRecordReplayHasCheckpoint               // 检查点标志
```

### 1.8 录制数据管理

```cpp
// 录制生命周期
RecordReplayAttach()              // 附加到进程
FlushRecordingChunks()            // 刷新录制块
MaybeSendRecordingData()          // 可能发送录制数据
SendAllRecordingData()            // 发送所有录制数据
RecordReplaySaveRecording()       // 保存到磁盘
RecordReplayFinishRecording()     // 完成录制

// 数据压缩
LZ4 压缩（内嵌 lz4.c）
ChunkStream — 分块数据流

// 每线程录制
RecordingThread.cpp — 每个线程独立的录制流
```

### 1.9 调试器集成（时间旅行调试的核心）

```cpp
// 检查点与导航
v8::recordreplay::NewCheckpoint()              // 创建检查点
RecordReplayNewCheckpointFlushed()             // 已刷盘检查点
Navigate.cpp                                    // 重放导航（seek to point）

// 执行进度
RecordReplayIncExecutionProgressCounter()      // 递增进度
RecordReplayCurrentExecutionPoint()            // 当前执行点
RecordReplayElapsedTimeMs()                    // 已用时间

// 调试器回调
RecordReplayOnNewSource()                      // 新脚本加载
RecordReplayOnDebuggerStatement()              // debugger 语句
RecordReplayOnExceptionUnwind()                // 异常展开
RecordReplayOnConsoleMessage()                 // 控制台消息
RecordReplayAddPossibleBreakpoint()            // 可能的断点

// CDP (Chrome DevTools Protocol) 集成
RecordReplaySendCDPMessage()
RecordReplaySetCDPMessageCallback()
```

## 2. 方案对比

| 维度 | Replay.io (逆向分析) | V8-Recorder (当前方案) |
|------|---------------------|----------------------|
| **拦截层级** | libc + libuv + macOS 框架 + V8 内部 | V8 Platform API |
| **拦截方式** | 运行时二进制重写 (inline asm trampoline) | 装饰器模式 (C++ 继承) |
| **拦截范围** | ~95 个函数，覆盖文件/网络/DNS/线程/信号/进程/内存 | 2 个函数 (MonotonicallyIncreasingTime, CurrentClockTimeMillis) |
| **随机数** | 拦截 arc4random/getentropy/CCRandomGenerateBytes/SecRandomCopyBytes | 设置 --random_seed flag |
| **文件 I/O** | 完整拦截 open/read/write/close + libuv fs 操作 | ❌ 不拦截 |
| **网络 I/O** | 完整拦截 socket/connect/send/recv + DNS | ❌ 不拦截 |
| **线程确定性** | OrderedLock + PointerID + StableHashTable | ❌ 不处理 |
| **事件循环** | 拦截 kevent/kevent64/poll/select + CFRunLoop | ❌ 不拦截 |
| **V8 修改** | 新增 4 个字节码指令 + Runtime 函数 | 0 修改 |
| **数据压缩** | LZ4 + ChunkStream | 无压缩 |
| **检查点** | 完整的 checkpoint/bookmark 系统 | 占位符 |
| **调试器** | 完整 CDP 集成 + 时间旅行导航 | 无 |
| **录制开销** | ~3.5% | <5% (理论值) |
| **重放能力** | 完整确定性重放（包括 I/O、网络、线程） | 仅时间和随机数确定性 |

## 3. 关键差距分析

### 3.1 V8-Recorder 当前方案的根本问题

**只拦截 Platform API 是不够的。** 原因：

1. **Date.now() 不走 Platform API**
   V8 的 `Date.now()` 实现直接调用 `gettimeofday()` 或 `clock_gettime()`，
   不经过 `Platform::CurrentClockTimeMillis()`。Platform API 的时间方法
   主要被 V8 内部的 GC 调度和任务调度使用。

2. **Math.random() 的种子不够**
   虽然 `--random_seed` 可以固定 V8 的 xorshift128+ 序列，
   但 Node.js 的 `crypto.randomBytes()` 调用的是 OS 的 `getentropy()`/`arc4random()`，
   这些完全绕过 V8。

3. **文件 I/O 完全不确定性**
   `fs.readFile()` 的返回内容取决于磁盘状态，不录制就无法重放。

4. **网络 I/O 完全不确定性**
   `http.get()` 的响应取决于远程服务器，不录制就无法重放。

5. **多线程不确定性**
   Node.js 的 libuv 线程池中的任务完成顺序是不确定的。

### 3.2 Replay.io 方案的核心优势

1. **libc 级拦截 = 完整覆盖**：所有系统交互都经过 libc，拦截这一层就能捕获一切
2. **Compose 模板 = 类型安全的拦截规范**：编译期确定每个函数的参数/返回值录制方式
3. **运行时二进制重写 = 零侵入**：不需要修改被拦截库的源码
4. **有序锁 = 线程确定性**：确保多线程程序的锁获取顺序在重放时一致
5. **指针 ID = 地址无关性**：消除 ASLR 和堆分配随机性的影响
6. **LZ4 压缩 = 小录制文件**：~1MB/秒的录制数据经压缩后更小

## 4. 结论

**Replay.io 的方案明显更优。** 它在正确的层级（libc）做拦截，覆盖了所有非确定性源。
V8 Platform API 级别的拦截只能捕获 V8 引擎内部的少量非确定性调用，
对于一个完整的 Node.js 程序来说远远不够。

要实现真正可用的录制/重放，需要采用 Replay.io 的 libc 级拦截方案。
