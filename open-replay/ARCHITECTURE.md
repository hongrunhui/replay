# Open Replay 架构设计文档

## 一、产品定位

Open Replay 是一个 Node.js 确定性录制与回放工具。核心目标：

1. **录制**：运行 Node.js 脚本时，捕获所有非确定性系统调用（时间、随机数、文件 I/O）
2. **回放**：重新运行相同脚本，用录制数据替代真实系统调用，产生完全一致的输出
3. **调试**（规划中）：在回放过程中接入 Chrome DevTools Protocol，实现时间旅行调试

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户视角                                  │
│                                                                   │
│   $ openreplay record my-app.js     ← 录制                       │
│   $ openreplay list                 ← 查看录制列表                 │
│   $ openreplay replay <uuid>        ← 回放                       │
│   $ openreplay replay <uuid> --server  ← 启动调试服务器（规划中）   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLI (TypeScript)                              │
│  openreplay record / replay / list / delete                             │
│  cli/src/index.ts → record.ts / replay.ts / list.ts                     │
└──────────┬─────────────────────────────────┬────────────────────────────┘
           │ spawn node + env vars           │ WebSocket (--server 模式)
           ▼                                 ▼
┌──────────────────────┐     ┌──────────────────────────────────────────┐
│   Node.js 进程        │     │      Replay Server (TypeScript)          │
│                       │     │                                          │
│  ┌─────────────────┐ │     │  ┌─────────────┐   ┌──────────────────┐ │
│  │   用户脚本       │ │     │  │ WebSocket    │   │  ReplayEngine    │ │
│  │  (my-app.js)    │ │     │  │  Server      │◄──│  (CDP Client)    │ │
│  └────────┬────────┘ │     │  └──────┬──────┘   └────────┬─────────┘ │
│           │ libc 调用  │     │         │ CDP               │ spawn      │
│           ▼           │     │         ▼                   ▼            │
│  ┌─────────────────┐ │     │  ┌──────────────┐  ┌──────────────────┐ │
│  │ libopenreplay   │ │     │  │  Protocol    │  │  Node.js 进程     │ │
│  │   .dylib/.so    │ │     │  │  Handler     │  │  (replay mode)   │ │
│  └─────────────────┘ │     │  └──────────────┘  └──────────────────┘ │
└──────────────────────┘     └──────────────────────────────────────────┘
           │
           │ 录制数据读写
           ▼
┌──────────────────────┐
│  ~/.openreplay/       │
│  recordings/          │
│    <uuid>.orec        │
│                       │
│  [Header 64B]         │
│  [Events...]          │
│  [Checkpoints]        │
│  [Tail 32B]           │
└──────────────────────┘
```

---

## 三、核心实现原理

### 3.1 系统调用拦截机制

录制和回放的核心在于拦截 libc 系统调用。不同平台有不同机制：

| 平台        | 机制                | 原理                              |
|------------|---------------------|---------------------------------|
| macOS      | DYLD_INTERPOSE      | dyld 加载器替换函数指针              |
| Linux      | LD_PRELOAD          | 动态链接器符号覆盖                   |

**工作流程：**

```
录制模式:
  用户代码调用 gettimeofday()
       │
       ▼
  DYLD_INTERPOSE → my_gettimeofday()
       │
       ├─ InterceptGuard 检查（防止递归）
       ├─ 调用真实的 gettimeofday()     → 获得真实时间值
       ├─ RecordReplayBytes("gettimeofday", &tv)  → 写入 .orec 文件
       └─ 返回真实值给用户代码

回放模式（时间/随机数）:
  用户代码调用 gettimeofday()
       │
       ▼
  DYLD_INTERPOSE → my_gettimeofday()
       │
       ├─ InterceptGuard 检查
       ├─ RecordReplayBytes("gettimeofday", &tv)  → 从 .orec 读取录制值
       └─ 返回录制值（不调用真实函数）
```

### 3.2 防递归机制 (InterceptGuard)

```
问题：
  my_gettimeofday() → RecordReplayBytes() → writer.WriteEvent()
       → raw::write() → write()  ← 这里如果被拦截就无限递归！

解决方案 1: InterceptGuard + g_intercept_depth
  ┌───────────────────────────────────────┐
  │ g_intercept_depth = 0  → 可拦截        │
  │ g_intercept_depth > 0  → 直通(不拦截)   │
  └───────────────────────────────────────┘

解决方案 2: raw_syscall.h
  录制文件的 I/O 使用 syscall() 直接调用内核
  完全绕过 DYLD_INTERPOSE，从根本上避免递归
```

### 3.3 录制文件格式 (.orec)

```
Offset  Content
──────  ─────────────────────────────
0       "OREC0001"         ← 魔术字节
8       version: u32 = 1
12      flags: u32
16      timestamp: u64     ← 录制开始时间(ms)
24      build_id[32]       ← Node.js 版本标识
56      reserved: u64
──────  ─────────────────────────────  ← 64 字节 Header 结束
64      Event Stream:
        ┌─ type: u8 ──────── VALUE(0x01) / BYTES(0x02) / METADATA(0x20) / ...
        ├─ why_hash: u32 ─── FNV-1a("gettimeofday") 等标签哈希
        ├─ data_len: u32
        └─ data: [u8; data_len]

        ... 重复数千次 ...
──────  ─────────────────────────────
N       Checkpoint Index:
        cp_count: u32
        [CheckpointEntry] × cp_count
──────  ─────────────────────────────
N+M     File Tail (32 bytes):
        total_events: u64
        checkpoint_offset: u64
        metadata_offset: u64
        sentinel: u32 = 0xDEADBEEF
        reserved: u32
```

### 3.4 事件回放的游标系统

```
关键设计：每个 "why" 标签有独立游标

录制事件流 (按时间顺序):
  [mach_abs_time] [mach_abs_time] [gettimeofday] [mach_abs_time] [arc4random_buf] [gettimeofday]
       0               1               2               3               4               5

回放时的游标 (per-why-hash, 各自独立推进):
  "mach_abs_time"  cursor: 0 → 1 → 3    (跳过不匹配的事件)
  "gettimeofday"   cursor: 0 → 2 → 5    (独立搜索)
  "arc4random_buf" cursor: 0 → 4         (独立搜索)

优点：不同类型的系统调用顺序可以变化，只要同类型调用的相对顺序一致即可
```

---

## 四、V8 引擎补丁 (Phase 1)

为了支持「精确到字节码级别」的执行进度追踪，对 V8 引擎做了以下修改：

```
新增 4 个字节码:
  ┌────────────────────────────────┬──────────────────────────────┐
  │ IncExecutionProgressCounter    │ 在热路径递增全局计数器          │
  │ Instrumentation                │ 回放时触发断点/检查点           │
  │ InstrumentationGenerator       │ Generator 函数专用版本         │
  │ AssertValue                    │ 验证回放一致性                  │
  └────────────────────────────────┴──────────────────────────────┘

新增 5 个运行时函数:
  Runtime_RecordReplayAssertExecutionProgress
  Runtime_RecordReplayTargetProgressReached
  Runtime_RecordReplayAssertValue
  Runtime_RecordReplayInstrumentation
  Runtime_RecordReplayInstrumentationGenerator

关键设计:
  - 录制时: 只插入 IncProgressCounter (轻量，只递增一个计数器)
  - 回放时: 额外插入 Instrumentation (用于断点和时间旅行)
  - kBytecodeSiteOffset = 1<<16 强制使用 4 字节操作数，保证字节码偏移稳定
```

---

## 五、实现路径回顾

### Phase 1: V8 字节码补丁 ✅
- 在 V8 (Node.js v20) 中添加执行进度计数器
- 4 个字节码 + 5 个运行时函数 + 2 个外部引用
- 关键难点：`kBytecodeSiteOffset` 保证字节码偏移稳定

### Phase 2: Driver 核心 ✅
- `libopenreplay.dylib` — C++ 共享库
- 录制文件格式 (.orec)：Header + Event Stream + Checkpoint + Tail
- `RecordReplayValue` / `RecordReplayBytes` — 录制/回放原语
- `raw_syscall.h` — 绕过 DYLD_INTERPOSE 的内核直调用

### Phase 3: Node.js 集成 ✅
- `node-recordreplay.cc` — dlopen 加载 driver，解析符号
- V8 进度计数器通过延迟 dlsym 连接到 driver
- 关键教训：不能在 `__attribute__((constructor))` 中调用 dlsym

### Phase 4: 文件系统拦截 ✅
- `ShouldInterceptPath()` — 路径过滤（跳过 /usr/, /System/ 等）
- `g_tracked_fds` — fd 追踪，只拦截用户空间的文件操作
- 关键发现：回放时 fs 拦截会因 cwd 不同导致事件错位，改为录制时-only

### Phase 5: CLI + Replay Server ✅
- CLI: `openreplay record/replay/list/delete`
- Server: WebSocket + CDP 协议处理
- `Recording.run` — 无调试器的直接回放
- Metadata: 录制时存储脚本绝对路径，回放时自动定位

### Phase 6: 确定性回放 (进行中)
- 已知问题：macOS arm64 commpage 绕过 DYLD_INTERPOSE
- 需要：fishhook 库或 V8 内部补丁实现真正的时间确定性
- 需要：拦截 OpenSSL RAND_bytes 实现 crypto 确定性

---

## 六、关键架构决策

### 决策 1: 堆分配全局对象 (而非栈上静态对象)

```
问题：__attribute__((constructor)) 在 C++ 静态构造器之前运行
如果 RecordingWriter 是静态对象，构造器运行时其内部 std::mutex 未初始化
导致 "mutex lock failed: Invalid argument" 崩溃

解决：使用 new 懒初始化 + pthread_mutex_t PTHREAD_MUTEX_INITIALIZER
```

### 决策 2: 录制时-only 的文件系统拦截

```
问题：录制和回放时 Node.js 模块加载的 stat/open 调用模式不同
      （取决于 cwd、Node.js 版本等），导致事件流错位

解决：录制时捕获所有用户空间文件 I/O → 写入 .orec
      回放时完全不拦截文件系统 → 让真实 fs 调用直通
      未来改进：虚拟文件系统，从录制数据中重建文件内容
```

### 决策 3: 使用系统 Node.js 而非补丁版本回放

```
问题：补丁 Node.js (v20) 和录制 Node.js (v22) 版本不同
      模块加载路径差异导致事件消费错位

解决：ReplayEngine 默认使用 process.execPath (运行服务器的同一 Node.js)
      确保录制和回放使用相同版本
```

### 决策 4: per-why-hash 独立游标

```
问题：不同类型系统调用的相对顺序可能在录制和回放之间变化

解决：每个 "why" 标签（如 "gettimeofday"）有独立游标
      游标只匹配相同 hash 的事件，跳过不同 hash
      同类型调用顺序一致即可，不要求全局顺序完全一致
```

---

## 七、目录结构

```
open-replay/
├── driver/                    # C++ 共享库 (核心)
│   ├── src/
│   │   ├── driver.{h,cc}     # API + 全局状态
│   │   ├── raw_syscall.{h,cc}# 原始系统调用 (绕过拦截)
│   │   ├── format/           # 录制文件格式
│   │   │   └── recording.{h,cc}
│   │   ├── checkpoint/       # 检查点管理
│   │   │   └── checkpoint.{h,cc}
│   │   └── intercept/        # 系统调用拦截器
│   │       ├── common.h      # InterceptGuard + DYLD_INTERPOSE 宏
│   │       ├── time.cc       # 时间函数拦截
│   │       ├── random.cc     # 随机数拦截
│   │       ├── fs.cc         # 文件 I/O 拦截 (录制-only)
│   │       ├── net.cc        # 网络拦截 (未启用)
│   │       └── thread.cc     # 线程同步拦截
│   ├── build.sh              # 构建脚本
│   └── tests/                # 测试
├── patches/                   # V8/Node.js 补丁
│   ├── v8/                   # V8 字节码 + 运行时函数补丁
│   └── node/                 # Node.js driver 集成
├── cli/                       # CLI 工具 (TypeScript)
│   └── src/
│       ├── index.ts          # 命令路由
│       ├── record.ts         # 录制命令
│       ├── replay.ts         # 回放命令
│       └── list.ts           # 列表命令
├── server/                    # 回放服务器 (TypeScript)
│   └── src/
│       ├── index.ts          # WebSocket 服务器
│       ├── replay-engine.ts  # Node.js 进程控制 + CDP
│       ├── session.ts        # 回放会话管理
│       └── protocol.ts       # CDP 协议分发
└── devtools/                  # DevTools 前端 (规划中)
```

---

## 八、使用方法

```bash
# 1. 构建 driver
cd open-replay/driver && bash build.sh

# 2. 安装 CLI
cd open-replay && npm install
cd cli && npm run build && npm link

# 3. 录制
openreplay record your-app.js

# 4. 查看录制
openreplay list

# 5. 回放
openreplay replay <recording-uuid>

# 6. 通过 WebSocket 服务器回放 (编程访问)
openreplay replay <recording-uuid> --server --port 1234
```
