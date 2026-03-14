# Open Replay 功能对齐路线图

> 基于 Replay.io 功能对比，按投入产出比排序的开发计划
> 最后更新：2026-03-15

---

## Replay.io vs Open Replay 功能对比

### 确定性回放

| 能力 | Replay.io | Open Replay | 状态 |
|------|-----------|-------------|------|
| 时间 (Date.now) | ✅ V8 内部 + libc 双重保障 | ✅ gettimeofday 拦截有效 | ✅ 已解决 |
| Math.random() | ✅ 直接补丁 V8 PRNG | ✅ --random-seed 确定性种子 | ✅ 已解决 |
| crypto.randomBytes() | ✅ 补丁了 7 个 OpenSSL 文件 | ✅ RAND_bytes_ex DYLD_INTERPOSE | ✅ 已解决 |
| 文件 I/O | ✅ 完整录制+回放（虚拟文件系统） | ⚠️ 录制有效但回放跳过 | Phase 8 |
| 网络 I/O | ✅ 请求/响应完整录制回放 | ✅ socket read 返回录制数据 | ✅ 已解决(MVP) |
| 线程/事件循环 | ✅ 9 个 libuv 文件补丁 + 有序锁 | ❌ thread.cc 禁用 | 远期 |
| 回放偏差检测 | ✅ AssertValue 字节码自动检测 | ❌ 无 | Phase 11 |

### 调试能力

| 功能 | Replay.io | Open Replay | 状态 |
|------|-----------|-------------|------|
| 断点 | ✅ | ✅ --debug 模式 + Chrome DevTools | ✅ 已解决 |
| 前进单步 | ✅ | ✅ Chrome DevTools step over/into | ✅ 已解决 |
| 后退单步（时间旅行） | ✅ checkpoint + 从最近 checkpoint 重放 | ❌ | Phase 10 |
| 变量查看 | ✅ 任意时间点 | ✅ 断点处查看 (evaluateOnCallFrame) | ✅ 已解决 |
| 表达式求值 | ✅ | ✅ Chrome DevTools Console | ✅ 已解决 |
| 代码行命中次数 | ✅ MapReduce 分析引擎 | ❌ | 远期 |
| Console 消息关联执行点 | ✅ | ⚠️ Console 输出可见但未关联执行点 | 远期 |

### 平台与集成

| 项目 | Replay.io | Open Replay | 状态 |
|------|-----------|-------------|------|
| 浏览器录制 | ✅ Chromium + Firefox | ❌ Node.js only | 远期/不做 |
| Node.js 版本 | v16（锁定） | ✅ v20/v22（更现代） | ✅ 我们领先 |
| DevTools UI | ✅ 完整自研 | ⚠️ 通过 Chrome DevTools 连接 | Phase 12 |
| 云端回放 | ✅ K8s + S3 | ❌ 本地 only | 远期 |
| SourceMap | ✅ | ❌ | 远期 |
| CI/CD 集成 | ✅ Cypress/Playwright | ❌ | 远期 |
| CLI | ✅ | ✅ record/replay/list/delete/--debug | ✅ 基本持平 |

### 架构差异

| 维度 | Replay.io | Open Replay |
|------|-----------|-------------|
| 拦截方式 | 内联汇编 trampoline + 深度源码补丁（~70 V8 文件） | DYLD_INTERPOSE 动态注入（~15 V8 文件） |
| 交付形式 | 魔改的单体二进制（~80MB node） | 独立 dylib（84KB）注入原生 node |
| V8 字节码 | 7 个 | 4 个 |
| V8 运行时函数 | 8 个 | 5 个 |
| 事件对齐 | 全局执行点对齐 + AssertValue 验证 | per-why-hash 独立游标（容忍顺序变化） |
| 回放位置 | 云端 K8s pod | 本地同机 |
| 录制格式 | 私有二进制 + NDJSON 日志 | .orec（64B Header + Event Stream + 32B Tail） |
| 防递归 | `BeginDisallowEvents` / `BeginPassThroughEvents` API | InterceptGuard 深度计数器 + raw_syscall 直调内核 |
| Checkpoint | 完整内存快照 + 定期自动 | .orec 中写标记（基础实现） |
| Node.js 集成 | 静态链接进二进制 | dlopen 动态加载 + 延迟 dlsym |

---

## 已完成的 Phases

### Phase 1-3: V8 补丁 + Driver + Node 集成 ✅
- 4 个 V8 字节码 + 5 个运行时函数
- libopenreplay.dylib — 84KB 共享库
- .orec 录制文件格式
- dlopen/dlsym 动态加载

### Phase 4: 文件系统拦截 ✅
- DYLD_INTERPOSE for open/openat/read/close/stat/fstat/lstat
- 路径过滤（跳过 /usr/, /System/, /Library/, /dev/, /.openreplay/）
- fd 追踪（只拦截用户空间的文件操作）
- 回放时跳过 fs 拦截（cwd 不一致导致事件错位）

### Phase 5: CLI + Replay Server ✅
- `openreplay record <script>` — 录制
- `openreplay replay <uuid>` — 回放（支持部分 UUID）
- `openreplay list` / `openreplay delete` — 管理录制
- WebSocket + CDP 协议服务器框架
- Recording.run — 无调试器直接回放

### Phase 6: 随机数确定性 ✅
- **Math.random()**: CLI 录制时生成随机种子 → `--random-seed=N` → 存入 metadata → 回放时相同种子
- **crypto.randomBytes/randomUUID**: DYLD_INTERPOSE 拦截 OpenSSL `RAND_bytes_ex`
- 实际发现：Node.js v22 用 `RAND_bytes_ex`（不是 `RAND_bytes`），需链接 libcrypto

### Phase 7: 网络 I/O 拦截 ✅
- socket fd 追踪：在 `connect()` 时追踪（非 `socket()` 时），排除 loopback（inspector 用）
- 录制：真实网络调用，记录 socket read 数据（sockread.ret/sockread.data）
- 回放：connect/write 走真实网络（kqueue 需要真实 socket），read 返回录制数据
- getaddrinfo 拦截已写但禁用（addrinfo 重构不完整）
- 已验证：HTTP GET httpbin.org 响应完全一致回放

### Phase 9: 断点与调试 ✅
- `openreplay replay <uuid> --debug [--inspect-port 9229]`
- 使用 Node.js 原生 `--inspect-brk`，通过 Chrome DevTools 连接
- 断点设置/命中、变量查看、表达式求值全部工作
- Math.random() 通过 --random-seed 保持确定性
- 已知限制：`--debug` 模式不注入 driver（DYLD_INTERPOSE 与 inspector 冲突），时间/crypto 不确定

---

## 待完成的 Phases

### Phase 8: 文件 I/O 回放

**目标**: 回放时文件读取返回录制时的内容（即使文件已变更）

**当前障碍**: Node.js 模块加载的 stat/open 模式因 cwd 而异，导致事件流错位

**方案选项**:
- 方法 1：维护 "录制过的路径" 白名单，回放时只拦截白名单中的路径
- 方法 2：延迟拦截——等 Node.js 初始化完成后再启用 fs 拦截
- 方法 3：虚拟文件系统 — open 返回真实 fd，read 从录制数据返回内容

**优先级**: 中 — 大多数 Node.js 脚本的文件读取在相同环境下是确定的

---

### Phase 10: 时间旅行（后退）

**目标**: 从任意执行点回退到之前的状态

**依赖**: V8 进度计数器 (Phase 1 已有) + Checkpoint 增强

**方案**:
1. fork() 快照 — 利用 COW 页实现零成本内存快照
2. 定期自动 checkpoint（每 5 秒或每 10000 进度点）
3. "回退到时间 T" = 找到最近 checkpoint → 从该点重放到 T
4. Reverse Step = current_progress - 1 → 找 checkpoint → 重放

**难点**: 需要解决 inspector 与 REPLAYING 模式的冲突（Phase 9 已发现）

---

### Phase 11: 回放偏差检测

**目标**: 自动检测回放何时偏离了录制轨迹

**方案**: V8 AssertValue 字节码在 instrumentation 点验证变量哈希

---

### Phase 12: DevTools UI

**目标**: 提供可视化调试界面

**最小可用 UI**:
- 基于 Chrome DevTools Frontend（CDP 兼容）
- 源码面板 + Console + Call Stack + Scope
- 时间线滑块（滑动到任意执行点）

---

## 已知问题与技术债

| 问题 | 影响 | 解决方向 |
|------|------|----------|
| DYLD_INTERPOSE 与 --inspect-brk 冲突 | --debug 模式不能注入 driver | 需要研究 inspector 初始化时序 |
| macOS arm64 mach_absolute_time commpage | 部分 libuv 内部时间调用可能绕过拦截 | fishhook 运行时符号重绑定 |
| 回放事件耗尽返回垃圾值 | Inspector 模式下 Node.js 初始化卡死 | RecordReplayBytes 返回成功标志，调用方回退到真实调用 |
| getaddrinfo 回放 addrinfo 不完整 | DNS 拦截禁用 | 完整重构 addrinfo 链表 |
| 单线程 only | 不支持 worker_threads | 需要 libuv 线程池补丁 |
| 无离线网络回放 | --debug 模式需要真实网络 | 实现 socket read/write 完全从录制数据返回 |
