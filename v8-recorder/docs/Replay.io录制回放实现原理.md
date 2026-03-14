# Replay.io 录制回放实现原理

## 概述

Replay.io 的核心思路是**确定性重放**：大部分软件是确定性的，给定相同输入就会产生相同输出。因此只需录制非确定性来源（时间、随机数、I/O），重放时注入录制值即可精确重现执行过程。

录制开销约 3.5%，远低于传统可观测性工具。

---

## 1. 录制层架构

### 1.1 修改版 Node.js 二进制

Replay.io 使用一个**修改过的 Node.js v16 二进制文件**（约 80MB），静态链接了 Replay 录制运行时。录制在两个层面进行：

### 1.2 libc 层拦截

使用 inline assembly trampolines 拦截 libc 函数调用，录制非确定性数据：

- 系统调用结果（时间、随机数）
- 文件 I/O 操作
- 网络 I/O
- 线程原语
- 定时器事件

### 1.3 V8 字节码层插桩（核心）

Replay 在 V8 Ignition 解释器中新增了 **7 个专用字节码**（非 CallRuntime，而是独立 opcode）：

| 字节码 | 用途 |
|---|---|
| `RecordReplayIncExecutionProgressCounter` | 递增全局进度计数器 |
| `RecordReplayNotifyActivity` | 通知运行时有活动 |
| `RecordReplayInstrumentation` | 主插桩（kind + source_position） |
| `RecordReplayInstrumentationGenerator` | Generator/async 插桩 |
| `RecordReplayInstrumentationReturn` | 返回值插桩 |
| `RecordReplayAssertValue` | 录制/回放值一致性断言 |
| `RecordReplayTrackObjectId` | 对象身份追踪 |

对应 **8 个 Runtime 函数**（`src/runtime/runtime.h`）：

| Runtime 函数 | 参数 | 用途 |
|---|---|---|
| `RecordReplayAssertExecutionProgress` | 1 | 断言执行进度一致 |
| `RecordReplayTargetProgressReached` | 0 | 检查是否到达目标进度 |
| `RecordReplayNotifyActivity` | 0 | 通知活动 |
| `RecordReplayAssertValue` | 3 | 值一致性断言 |
| `RecordReplayInstrumentation` | 2 | 主插桩回调 |
| `RecordReplayInstrumentationGenerator` | 3 | Generator 插桩回调 |
| `RecordReplayInstrumentationReturn` | 3 | 返回值插桩回调 |
| `RecordReplayTrackObjectId` | 1 | 对象 ID 追踪 |

**字节码生成器**（`src/interpreter/bytecode-generator.cc`）在以下位置插入插桩：
- 语句位置（`SetStatementPosition` 中调用 `RecordReplayInstrumentation("breakpoint")`）
- 函数进入/退出
- 条件分支（if/else、switch-case）
- 循环迭代（for、while、do-while）
- 异常处理（throw/catch/finally）
- Generator/async（yield/await 前后）
- 变量赋值

**编译器全层适配**：Baseline、TurboFan、Maglev 三个编译层都为这些字节码生成了对应的机器码，确保 JIT 编译后插桩仍然生效。共涉及 V8 内 **70 个文件**的改动。

> 详细分析见 [调研/Replay-V8引擎改动分析.md](./调研/Replay-V8引擎改动分析.md)

### 1.4 执行点系统（Execution Points）

核心数据结构：
```cpp
extern uint64_t* gProgressCounter;  // 全局进度计数器指针
extern uint64_t gTargetProgress;    // 目标进度值（回放时使用）
```

工作原理：
1. 每个插桩点递增 `gProgressCounter`，形成全局执行序列
2. 回放时设置 `gTargetProgress`，当计数器达到目标值时触发 `RecordReplayTargetProgressReached`
3. 这实现了"执行到指定位置"的能力 — 时间旅行调试的基础
4. 支持 MapReduce 风格的聚合分析（用于计算行执行次数、查找断点命中点）

### 1.5 确定性保障

V8 层面的确定性改动（详见 [调研/Replay-V8引擎改动分析.md](./调研/Replay-V8引擎改动分析.md)）：
- **Math.random** — 录制随机数值，回放注入相同值
- **值序列化** — 禁用 SMI 优化路径，字符串统一双字节，避免 JIT/GC 差异
- **错误消息** — 录制 Error.stack 和格式化结果
- **堆/GC** — 9 个堆相关文件的确定性补丁
- **Inspector** — 9 个 Inspector 文件的适配

Node.js 层面的确定性改动（详见 [调研/Replay-Node改动分析.md](./调研/Replay-Node改动分析.md)）：
- **C++ 层** — 35+ 文件，覆盖文件系统、网络、加密、异步等模块
- **libuv** — 9 个文件，线程池/事件循环/I/O 确定性
- **OpenSSL** — 7 个文件，随机数/时间戳确定性
- **JS 运行时** — 6 个文件（`lib/internal/recordreplay/`），对象追踪、SourceMap 收集等

---

## 2. 录制数据格式

### 2.1 存储位置

```
~/.replay/<recording-id>          # 二进制录制文件
~/.replay/recordings.log          # NDJSON 格式日志
~/.replay/sourcemap-<hash>.map    # SourceMap 文件
~/.replay/source-<hash>           # 原始源码文件
```

### 2.2 录制文件结构（推断）

```
Header:
  - Magic Number
  - Version / Build ID
  - Recording ID
  - Timestamp

Sections:
  1. Execution Points     — 执行点 ID、时间戳、调用栈、作用域链
  2. Non-Deterministic    — 系统调用结果、网络响应、随机值、定时器
  3. DOM Snapshots        — 初始状态、增量变更（浏览器录制）
  4. Dependency Graph     — 节点、边、执行顺序
  5. Metadata             — 进程信息、环境变量、注解
```

### 2.3 日志事件

`recordings.log` 中记录的事件类型：

```
createRecording       — 录制开始
writeStarted/Finished — 数据写入
addMetadata           — 元数据添加
crashed               — 进程崩溃
uploadStarted/Finished — 上传状态
sourcemapAdded        — SourceMap 收集
processingStarted/Finished — 云端处理
```

---

## 3. 回放层架构

### 3.1 关键发现：回放在云端执行

Replay.io **不在本地回放**。行执行次数、变量状态等数据不是录制时直接存储的，而是回放时通过确定性重执行 + CDP 协议实时获取。

### 3.2 回放流程

```
用户打开 app.replay.io
    ↓
创建 Session（Kubernetes Pod）
    ↓
启动 Replay Chromium（REPLAYING 模式）
    ↓
加载录制文件到内存
    ↓
建立 WebSocket 连接（CDP 协议）
    ↓
用户通过 DevTools UI 控制回放
    ↓
云端引擎执行到目标执行点
    ↓
返回状态/变量给前端
```

### 3.3 时间旅行调试实现

- **Checkpoint 机制** — 周期性全状态快照
- **快速跳转** — 从最近的 checkpoint 执行到目标点
- **执行点验证** — 确保确定性重放
- **偏差检测** — 检测重放是否偏离录制

### 3.4 CDP 协议通信

连接地址：`wss://dispatch.replay.io`

**标准 CDP 域：**
- `Debugger` — 断点、单步、暂停
- `Runtime` — 表达式求值
- `Console` — Console 消息
- `DOM` / `CSS` / `Network` — 页面检查

**Replay 扩展域：**

| API | 用途 |
|---|---|
| `Session.createSession` | 创建回放会话 |
| `Debugger.setBreakpoint` | 设置断点 |
| `Debugger.findStepTarget` | 查找单步目标 |
| `Pause.evaluateInFrame` | 在调用帧中求值表达式 |
| `Pause.getAllFrames` | 获取调用栈 |
| `Pause.getScope` | 获取作用域 |
| `Pause.getObjectPreview` | 获取对象预览 |
| `Analysis.createAnalysis` | 创建 MapReduce 分析任务 |
| `Analysis.runAnalysis` | 运行分析 |
| `Graphics.findPaints` | 查找绘制事件 |
| `Graphics.getPaintContents` | 获取截图 |
| `Recording.getSourceContents` | 获取源码 |
| `Console.findMessages` | 查找 Console 消息 |

> 详细前端架构见 [调研/Replay-DevTools前端架构.md](./调研/Replay-DevTools前端架构.md)

### 3.5 DevTools 前端

Replay DevTools（app.replay.io）基于 React + Redux + Next.js 构建，使用 React 实验版（Concurrent Mode + Suspense for Data Fetching）。

核心架构特点：
- **37 个 Suspense Cache** — 数据获取与 UI 完全解耦
- **Protocol 抽象层** — WebSocket 通信封装为独立 `packages/protocol/`
- **CodeMirror 源码编辑器** — 支持行执行次数 badge、断点 gutter、变量 hover
- **面板化布局** — react-resizable-panels 实现灵活的多面板布局

> 详细架构见 [调研/Replay-DevTools前端架构.md](./调研/Replay-DevTools前端架构.md)

### 3.6 Viewer 功能实现原理

截图中各功能的实现方式：

| 功能 | 实现方式 |
|---|---|
| 源码展示 | 录制时收集 SourceMap + 原始源码 |
| 行执行次数（蓝色 badge） | 云端重放引擎通过 V8 Profiler 精确覆盖率获取 |
| 断点调试 | CDP `Debugger.setBreakpoint`，云端执行到断点暂停 |
| 变量 hover | CDP `Pause.evaluateInFrame` 在目标执行点求值 |
| Console 输出 | 录制时通过 `RecordReplayOnConsoleMessage()` 捕获 |
| 执行次数导航（1/12） | 执行点系统 + MapReduce 聚合 |

---

## 4. 三层架构总览

```
┌─────────────────────────────────────────────────┐
│  Layer 1: 录制（本地）                           │
│  修改版 Node.js/Chromium                         │
│  • libc 层系统调用拦截                           │
│  • V8 字节码插桩（执行点追踪）                    │
│  • 非确定性数据捕获                              │
│  • SourceMap 收集                                │
│  产出: ~/.replay/<recording-id>                  │
└─────────────────────────────────────────────────┘
                    ↓ Upload
┌─────────────────────────────────────────────────┐
│  Layer 2: 存储与处理（云端）                      │
│  • S3 存储（presigned URLs）                     │
│  • 元数据索引                                    │
│  • SourceMap 管理                                │
└─────────────────────────────────────────────────┘
                    ↓ User opens replay
┌─────────────────────────────────────────────────┐
│  Layer 3: 回放与调试（云端）                      │
│  Kubernetes Pod（每用户 session）                 │
│  • Replay Chromium 实例                          │
│  • 确定性重放引擎                                │
│  • CDP 协议服务器                                │
│  • 状态重建                                      │
│         ↓ WebSocket CDP                          │
│  浏览器 DevTools UI (app.replay.io)              │
└─────────────────────────────────────────────────┘
```

---

## 5. replayio npm 包的角色

`replayio` npm 包**不是**录制引擎本身，而是：

1. **CLI 工具** — 提供 `replayio record` 命令
2. **运行时启动器** — 下载并启动 Replay Chromium
3. **录制管理器** — 读取 `recordings.log`，管理录制文件
4. **上传客户端** — 处理 WebSocket 通信和 S3 上传
5. **元数据处理** — 管理 SourceMap 和元数据

---

## 6. 对本项目的启示

当前 v8-recorder 已实现 Layer 1 的 libc 层拦截。要实现类似 Replay.io 的 viewer，有三种可行路径：

| 方案 | 思路 | 优势 | 劣势 |
|---|---|---|---|
| **Node Inspector** | 录制时启动 `node --inspect`，通过 CDP 收集覆盖率+变量 | 不需修改 V8，数据精确 | 需要 Node.js 环境，有性能开销 |
| **代码插桩** | 录制前用 Babel/AST 转换源码，插入计数器和变量快照 | 不依赖 Inspector | 修改执行行为，变量快照复杂 |
| **本地重放** | 用 .v8rec 数据做确定性重放，配合 JS 解释器获取状态 | 最接近 Replay.io 思路 | 实现难度最大 |

### 环境变量控制

```bash
RECORD_ALL_CONTENT=1                    # 启用录制
RECORD_REPLAY_DIRECTORY=~/.replay       # 存储位置
RECORD_REPLAY_METADATA={...}            # 元数据 JSON
RECORD_REPLAY_VERBOSE=1                 # 调试日志
```

---

## 7. 源码仓库与深度分析文档

| 仓库 | 说明 | 深度分析 |
|---|---|---|
| `chromium-v8` | Replay 修改版 V8 引擎 | [V8引擎改动分析](./调研/Replay-V8引擎改动分析.md) |
| `node` | Replay 修改版 Node.js | [Node改动分析](./调研/Replay-Node改动分析.md) |
| `devtools` | Replay DevTools 前端 | [DevTools前端架构](./调研/Replay-DevTools前端架构.md) |
| `replay-cli` | CLI 工具与 npm 包 | 见本文第 5 节 |
| `docs` | 官方文档 | — |
