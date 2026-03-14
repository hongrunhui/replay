# Replay.io Node.js 改动分析

> 基于 node 仓库源码分析，涵盖 Node.js C++ 层、JS 运行时、V8 依赖、libuv、OpenSSL 等多层改动。

## 1. Node.js C++ 层改动（35+ 文件）

### 1.1 核心启动与环境

| 文件 | 改动 |
|---|---|
| `src/node.cc` | 主入口，Replay 录制模式初始化、环境变量检测 |
| `src/node.h` | Replay 相关声明 |
| `src/env.cc` | Environment 类扩展，录制状态管理 |
| `src/env.h` | Environment 头文件，新增 Replay 字段 |
| `src/node_main_instance.cc` | 主实例创建时的 Replay 初始化 |

### 1.2 模块拦截

| 文件 | 改动 |
|---|---|
| `src/node_file.cc` | 文件系统操作拦截（open/read/write/stat 等） |
| `src/node_dir.cc` | 目录操作拦截 |
| `src/node_os.cc` | OS 信息获取拦截（hostname、cpus、memory 等） |
| `src/node_http_parser.cc` | HTTP 解析器拦截 |
| `src/udp_wrap.cc` | UDP 网络操作拦截 |
| `src/cares_wrap.cc` | DNS 解析（c-ares）拦截 |
| `src/connection_wrap.cc` | TCP 连接拦截 |
| `src/stream_base.cc` | 流基类拦截 |
| `src/stream_pipe.cc` | 管道流拦截 |
| `src/node_buffer.cc` | Buffer 操作适配 |

### 1.3 异步与事件循环

| 文件 | 改动 |
|---|---|
| `src/async_wrap.cc` | 异步钩子包装器，确保异步操作确定性 |
| `src/handle_wrap.cc` | 句柄包装器适配 |
| `src/node_platform.cc` | 平台层适配（线程池、任务调度） |

### 1.4 安全与加密

| 文件 | 改动 |
|---|---|
| `src/crypto/crypto_random.cc` | 随机数生成拦截 |
| `src/crypto/crypto_context.cc` | 加密上下文适配 |
| `src/node_credentials.cc` | 凭证操作适配 |

### 1.5 Inspector 与调试

| 文件 | 改动 |
|---|---|
| `src/inspector/main_thread_interface.cc` | 主线程 Inspector 接口适配 |
| `src/inspector/worker_inspector.cc` | Worker Inspector 适配 |

### 1.6 其他 C++ 改动

| 文件 | 改动 |
|---|---|
| `src/node_binding.cc` | 原生模块绑定适配 |
| `src/node_native_module.cc` | 内置模块加载适配 |
| `src/node_errors.cc/h` | 错误处理适配 |
| `src/node_perf.cc` | 性能计时器拦截 |
| `src/node_process_methods.cc` | process.recordreplay API 暴露（见下方 1.7） |
| `src/node_v8.cc` | V8 相关接口适配 |
| `src/node_worker.cc` | Worker 线程适配 |
| `src/node_api.cc` | N-API 适配 |
| `src/api/callback.cc` | 回调机制适配 |
| `src/api/environment.cc` | 环境 API 适配 |
| `src/tracing/agent.cc` | 追踪代理适配 |

### 1.7 process.recordreplay JS API（`src/node_process_methods.cc`）

该文件将 Replay 功能暴露给 JS 层，是 C++ 与 JS 运行时的桥梁：

| API | 用途 |
|---|---|
| `recordReplayLog` | 向 Replay 驱动输出日志 |
| `recordReplayAssert` | 断言录制/回放一致性 |
| `recordReplayOnConsoleAPI` | Console API 回调 |
| `recordReplaySetCommandCallback` | 设置 CDP 命令回调 |
| `recordReplaySetClearPauseDataCallback` | 设置清除暂停数据回调 |
| `recordReplayIgnoreScript` | 标记脚本不需要插桩 |
| `recordReplaySendCDPMessage` | 发送 CDP 协议消息 |
| `recordReplayGetCurrentError` | 获取当前错误 |
| `recordReplayGetRecordingId` | 获取录制 ID |
| `recordReplayCurrentExecutionPoint` | 获取当前执行点 |
| `recordReplayElapsedTimeMs` | 获取已用时间 |
| `recordReplayAnnotationHook` | 注解钩子 |

## 2. JS 运行时改动（`lib/internal/recordreplay/`）

### 2.1 文件清单

| 文件 | 用途 |
|---|---|
| `main.js` | 录制运行时主入口，初始化所有模块 |
| `message.js` | 消息通信处理（进程间、Inspector 消息） |
| `object.js` | 对象追踪与序列化 |
| `preview.js` | 对象预览生成（用于调试器变量展示） |
| `sourcemap.js` | SourceMap 收集与处理 |
| `utils.js` | 工具函数（日志、断言、格式化等） |

### 2.2 核心功能

**main.js** — 录制运行时入口：
- 检测 `RECORD_ALL_CONTENT` 环境变量
- 初始化 CDP 消息处理和命令回调
- 实现 CDP 命令：`Target.countStackFrames`、`Target.evaluatePrivileged`、`Pause.evaluateInFrame`、`Pause.getAllFrames`、`Pause.getObjectPreview`、`Pause.getScope`
- 注册 process 事件钩子
- 设置 SourceMap 收集

**message.js** — 消息系统：
- 处理 Inspector 协议消息
- 管理录制/回放间的消息传递
- 支持 CDP 协议通信

**object.js** — 对象追踪：
- 为对象分配唯一 ID
- 追踪对象生命周期
- 支持对象快照

**preview.js** — 预览生成：
- 生成对象的可读预览
- 支持各种 JS 类型（Array、Map、Set、Promise 等）
- 用于调试器中的变量悬浮展示

**sourcemap.js** — SourceMap 处理：
- 拦截模块加载，收集 SourceMap
- 存储到 `~/.replay/sourcemap-<hash>.map`
- 存储原始源码到 `~/.replay/source-<hash>`

## 3. V8 依赖改动（`deps/v8/`）

Node.js 内嵌的 V8 引擎包含与 chromium-v8 仓库对应的改动（90+ 文件），主要包括：

- 字节码系统（7 个新字节码）
- Runtime 函数（8 个）
- 编译器适配（Baseline、TurboFan、Maglev）
- 执行点系统与进度计数器
- 堆/GC 确定性
- Inspector 适配

详见 [Replay-V8引擎改动分析.md](./Replay-V8引擎改动分析.md)。

## 4. libuv 改动（`deps/uv/`，9 个文件）

libuv 是 Node.js 的异步 I/O 库，Replay 对其进行了确定性补丁：

| 文件 | 改动 |
|---|---|
| `src/threadpool.c` | 线程池确定性：确保任务调度顺序一致 |
| `src/unix/async.c` | 异步通知确定性 |
| `src/unix/darwin.c` | macOS 特定适配 |
| `src/unix/fs.c` | 文件系统操作确定性（stat 结果、目录遍历顺序等） |
| `src/unix/kqueue.c` | kqueue 事件通知确定性 |
| `src/unix/process.c` | 子进程管理确定性 |
| `src/unix/signal.c` | 信号处理确定性 |
| `src/unix/stream.c` | 流操作确定性（读写顺序、缓冲区大小） |
| `src/unix/thread.c` | 线程操作确定性（互斥锁、条件变量） |

### 核心策略

libuv 的改动确保：
1. **线程池任务顺序** — 录制时记录任务完成顺序，回放时按相同顺序执行
2. **I/O 事件顺序** — kqueue/epoll 返回的事件顺序确定化
3. **文件系统** — stat 时间戳、目录遍历顺序等确定化
4. **网络** — 连接建立、数据到达顺序确定化

## 5. OpenSSL 改动（`deps/openssl/`，7 个文件）

| 文件 | 改动 |
|---|---|
| `crypto/rand/drbg_lib.c` | DRBG 随机数生成器确定性 |
| `crypto/rand/rand_lib.c` | 随机数库确定性 |
| `crypto/rand/rand_unix.c` | Unix 随机数源确定性（/dev/urandom 等） |
| `crypto/o_str.c` | 字符串操作适配 |
| `ssl/record/dtls1_bitmap.c` | DTLS 位图确定性 |
| `ssl/record/rec_layer_d1.c` | DTLS 记录层确定性 |
| `ssl/record/record_local.h` | 记录层头文件 |
| `ssl/record/ssl3_record.c` | SSL3 记录处理确定性 |

### 核心策略

- **随机数** — 录制时记录 CSPRNG 输出，回放时注入相同值
- **时间戳** — SSL 握手中的时间戳确定化
- **序列号** — DTLS 序列号确定化

## 6. 构建配置改动

- `node.gyp` — 添加 Replay 源文件到构建系统
- `configure.py` — 添加 `--enable-recordreplay` 配置选项
- 静态链接 Replay 运行时库

## 7. 关键文件路径清单

### C++ 层（35 个）
```
src/node.cc
src/node.h
src/env.cc
src/env.h
src/node_main_instance.cc
src/node_file.cc
src/node_dir.cc
src/node_os.cc
src/node_http_parser.cc
src/udp_wrap.cc
src/cares_wrap.cc
src/connection_wrap.cc
src/stream_base.cc
src/stream_pipe.cc
src/node_buffer.cc
src/async_wrap.cc
src/handle_wrap.cc
src/node_platform.cc
src/crypto/crypto_random.cc
src/crypto/crypto_context.cc
src/node_credentials.cc
src/inspector/main_thread_interface.cc
src/inspector/worker_inspector.cc
src/node_binding.cc
src/node_native_module.cc
src/node_errors.cc
src/node_errors.h
src/node_perf.cc
src/node_process_methods.cc
src/node_v8.cc
src/node_worker.cc
src/node_api.cc
src/api/callback.cc
src/api/environment.cc
src/tracing/agent.cc
```

### JS 运行时（6 个）
```
lib/internal/recordreplay/main.js
lib/internal/recordreplay/message.js
lib/internal/recordreplay/object.js
lib/internal/recordreplay/preview.js
lib/internal/recordreplay/sourcemap.js
lib/internal/recordreplay/utils.js
```

### libuv（9 个）
```
deps/uv/src/threadpool.c
deps/uv/src/unix/async.c
deps/uv/src/unix/darwin.c
deps/uv/src/unix/fs.c
deps/uv/src/unix/kqueue.c
deps/uv/src/unix/process.c
deps/uv/src/unix/signal.c
deps/uv/src/unix/stream.c
deps/uv/src/unix/thread.c
```

### OpenSSL（7 个）
```
deps/openssl/openssl/crypto/o_str.c
deps/openssl/openssl/crypto/rand/drbg_lib.c
deps/openssl/openssl/crypto/rand/rand_lib.c
deps/openssl/openssl/crypto/rand/rand_unix.c
deps/openssl/openssl/ssl/record/dtls1_bitmap.c
deps/openssl/openssl/ssl/record/rec_layer_d1.c
deps/openssl/openssl/ssl/record/record_local.h
deps/openssl/openssl/ssl/record/ssl3_record.c
```

### V8 依赖（90+ 个）
```
deps/v8/  — 与 chromium-v8 仓库对应的改动
```