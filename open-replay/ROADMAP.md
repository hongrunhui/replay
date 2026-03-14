# Open Replay 功能对齐路线图

> 基于 Replay.io 功能对比，按投入产出比排序的开发计划

---

## Replay.io vs Open Replay 功能对比

### 确定性回放

| 能力 | Replay.io | Open Replay | 差距 |
|------|-----------|-------------|------|
| 时间 (Date.now) | ✅ V8 内部 + libc 双重保障 | ✅ gettimeofday 拦截有效 | 基本持平 |
| Math.random() | ✅ 直接补丁 V8 PRNG | ✅ --random-seed 确定性种子 | 已解决 |
| crypto.randomBytes() | ✅ 补丁了 7 个 OpenSSL 文件 | ✅ RAND_bytes_ex DYLD_INTERPOSE | 已解决 |
| 文件 I/O | ✅ 完整录制+回放（虚拟文件系统） | ⚠️ 录制有效但回放跳过 | **Phase 8** |
| 网络 I/O | ✅ 请求/响应完整录制回放 | ✅ socket read 返回录制数据 | 已解决(MVP) |
| 线程/事件循环 | ✅ 9 个 libuv 文件补丁 + 有序锁 | ❌ thread.cc 禁用 | 远期 |
| 回放偏差检测 | ✅ AssertValue 字节码自动检测 | ❌ 无 | **Phase 11** |

### 调试能力

| 功能 | Replay.io | Open Replay | 差距 |
|------|-----------|-------------|------|
| 断点 | ✅ | ❌ 框架有但未实现 | **Phase 9** |
| 前进单步 | ✅ | ❌ | **Phase 9** |
| 后退单步（时间旅行） | ✅ checkpoint + 从最近 checkpoint 重放 | ❌ | **Phase 10** |
| 变量查看 | ✅ 任意时间点 | ❌ | **Phase 9** |
| 表达式求值 | ✅ | ❌ | **Phase 9** |
| 代码行命中次数 | ✅ MapReduce 分析引擎 | ❌ | 远期 |
| Console 消息关联执行点 | ✅ | ❌ | **Phase 9** |

### 平台与集成

| 项目 | Replay.io | Open Replay | 差距 |
|------|-----------|-------------|------|
| 浏览器录制 | ✅ Chromium + Firefox | ❌ Node.js only | 远期/不做 |
| Node.js 版本 | v16（锁定） | ✅ v20（更现代） | 我们领先 |
| DevTools UI | ✅ 完整自研 | ❌ 空目录 | **Phase 12** |
| 云端回放 | ✅ K8s + S3 | ❌ 本地 only | 远期 |
| SourceMap | ✅ | ❌ | 远期 |
| CI/CD 集成 | ✅ Cypress/Playwright | ❌ | 远期 |
| CLI | ✅ | ✅ 基础可用 | 基本持平 |

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

## 当前状态 (v0.1)

已实现：
- [x] 时间确定性回放 (gettimeofday, clock_gettime, time, mach_absolute_time)
- [x] libc 随机数拦截 (arc4random, arc4random_buf, getentropy)
- [x] 文件 I/O 录制（路径过滤 + fd 追踪，录制-only）
- [x] V8 进度计数器 (4 字节码 + 5 运行时函数)
- [x] .orec 录制文件格式 (Header + Event Stream + Checkpoint + Tail)
- [x] CLI 工具 (record / replay / list / delete)
- [x] Replay Server 框架 (WebSocket + CDP)

未实现（与 Replay.io 的差距）：
- [ ] Math.random() 确定性
- [ ] crypto.randomBytes() 确定性
- [ ] 网络 I/O 拦截与回放
- [ ] 文件 I/O 回放（虚拟文件系统）
- [ ] 断点 + 单步调试
- [ ] 时间旅行（后退）
- [ ] 回放偏差检测
- [ ] DevTools UI
- [ ] SourceMap 支持

---

## Phase 6: 随机数确定性

**目标**: Math.random() 和 crypto.randomBytes() 在回放时返回录制值

### 6.1 Math.random() — V8 PRNG 种子拦截
- V8 的 Math.random() 使用 xorshift128+ PRNG
- PRNG 种子来源：V8 调用平台的 `GenerateEntropy()` → 最终调用 `getentropy()` 或读 `/dev/urandom`
- 方案 A：确保 `getentropy()` DYLD_INTERPOSE 正确拦截种子读取
- 方案 B：在 V8 补丁中直接把种子源替换为 driver API
- 验证：录制和回放 `Math.random()` 序列完全一致

### 6.2 crypto.randomBytes() — OpenSSL RAND_bytes 拦截
- Node.js crypto 模块底层用 OpenSSL 的 `RAND_bytes()`
- `RAND_bytes` 不走 `arc4random_buf`，而是用 OpenSSL 自己的 entropy pool
- 方案：DYLD_INTERPOSE 拦截 `RAND_bytes` 和 `RAND_seed`
- 验证：`crypto.randomBytes(8)` 和 `crypto.randomUUID()` 在回放时一致

---

## Phase 7: 网络 I/O 拦截与回放

**目标**: HTTP/HTTPS 请求在回放时返回录制的响应

### 7.1 启用 net.cc
- 取消 `#if 0` 注释，启用 DYLD_INTERPOSE
- 对 connect/accept/recv/send/poll 实现录制和回放
- 路径过滤：跳过 localhost inspector 连接（避免干扰 --inspect）

### 7.2 回放模式网络处理
- 录制时：真实发起网络请求，记录返回数据
- 回放时：不发真实请求，从录制数据中返回（类似 mock server）
- 需处理：非阻塞 socket + poll/select 语义

### 7.3 DNS 拦截
- 拦截 `getaddrinfo` — Node.js 的 DNS 解析入口
- 录制 DNS 结果，回放时直接返回

---

## Phase 8: 文件 I/O 回放

**目标**: 回放时文件读取返回录制时的内容（即使文件已变更）

### 8.1 区分用户 I/O 和模块加载
- 问题：Node.js 模块加载的 stat/open 模式因 cwd 而异
- 方案：只拦截 "用户代码发起的" 文件操作
  - 方法 1：维护 "录制过的路径" 白名单，回放时只拦截白名单中的路径
  - 方法 2：在录制时给每个 open 事件附加调用栈指纹，回放时匹配
  - 方法 3：延迟拦截——等 Node.js 初始化完成后再启用 fs 拦截

### 8.2 虚拟文件系统 (VFS)
- 录制时：把文件内容存入 .orec（read.data 事件已有这些数据）
- 回放时：open 返回真实 fd，但 read 从录制数据中返回内容
- 需要：路径→事件序列的映射表

---

## Phase 9: 断点与单步调试

**目标**: 连接 DevTools，在回放中设断点、单步执行

### 9.1 V8 进度计数器 → 断点
- 已有：IncExecutionProgressCounter 字节码在热路径递增计数器
- 需要：当 counter 达到目标值时暂停执行
  - `RecordReplayTargetProgressReached()` → 触发 Debugger.pause
  - Server 设定 target_progress，引擎运行到该点后暂停

### 9.2 CDP 断点映射
- 用户在 DevTools 设置 `Debugger.setBreakpoint(file:line)`
- Server 需要将 (file, line) 映射到 progress counter 值
- 方案：录制时建立 (scriptId, line, column) → progress 的映射表

### 9.3 单步执行
- Step Over：target_progress = current + 1（下一个 instrumentation 点）
- Step Into：需要解析字节码中的 Call 指令
- Step Out：需要记录 frame 的 entry progress

---

## Phase 10: 时间旅行（后退）

**目标**: 从任意执行点回退到之前的状态

### 10.1 Checkpoint 增强
- 已有：RecordReplayNewCheckpoint() 在 .orec 中写入 checkpoint 标记
- 需要：checkpoint 时保存完整内存快照（或使用 fork()）
- 方案 A：fork() — 利用 COW 页实现零成本快照
- 方案 B：定期自动 checkpoint（如每 5 秒或每 10000 进度点）

### 10.2 从 Checkpoint 重放
- "回退到时间 T" = 找到 T 之前最近的 checkpoint → 从该点重放到 T
- Reader.SeekToCheckpoint() 已存在，需要连通到引擎控制

### 10.3 Reverse Step
- Step Back = 找到 current_progress - 1 对应的 checkpoint，重放到该点
- 需要精确的 progress → 源码位置映射

---

## Phase 11: 回放偏差检测

**目标**: 自动检测回放何时偏离了录制轨迹

### 11.1 AssertValue 字节码
- 已有：V8 AssertValue 字节码在 instrumentation 点比较值
- 需要：回放时在每个 instrumentation 点验证变量哈希
- 偏差时：报告偏差位置，提供诊断信息

---

## Phase 12: DevTools UI

**目标**: 提供可视化调试界面

### 12.1 最小可用 UI
- 基于 Chrome DevTools Frontend（CDP 兼容）
- 源码面板 + Console + Call Stack + Scope
- 时间线滑块（滑动到任意执行点）

### 12.2 Open Replay 专属功能
- 录制列表面板
- 执行进度可视化
- 代码行命中热力图
