# Replay.io 重放机制与断点调试原理

## 1. 核心架构：云端重放

### 1.1 重放模式概述

**关键发现**: Replay.io 的重放**不是在本地浏览器**进行，而是在**云端**运行！

```
┌─────────────────────────────────────────────────────────────┐
│  用户浏览器 (https://app.replay.io)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  DevTools UI                                         │   │
│  │  • 时间轴                                            │   │
│  │  • 断点管理                                          │   │
│  │  • 变量检查                                          │   │
│  │  • 控制台                                            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                    ↓ WebSocket (CDP)
┌─────────────────────────────────────────────────────────────┐
│  Replay Cloud Backend                                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Replay Engine (云端 Replay Chromium 实例)           │   │
│  │  • 加载录制文件                                      │   │
│  │  • 确定性重放                                        │   │
│  │  • 断点处理                                          │   │
│  │  • CDP 协议服务                                      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 2. 重放工作流程

### 2.1 完整流程

```
1. 用户上传录制文件
   ↓
2. 云端存储 (S3)
   ↓
3. 用户打开 Replay (https://app.replay.io)
   ↓
4. 云端启动 Replay Chromium 实例
   ↓
5. 加载录制文件到内存
   ↓
6. 进入重放模式 (RecordReplayIsReplaying() = true)
   ↓
7. 建立 WebSocket 连接 (CDP)
   ↓
8. 用户通过 DevTools UI 控制重放
   ↓
9. 云端执行重放并返回结果
```

### 2.2 重放模式检测

```cpp
// 从二进制中提取的函数
RecordReplayIsReplaying()              // 检查是否在重放模式
gRecordingOrReplaying                  // 全局状态标志
recordreplay::IsReplaying()            // C++ 命名空间函数
recordreplay::IsRecordingOrReplaying() // 检查录制或重放
```

**实现**:
```cpp
// 伪代码
enum Mode {
  NORMAL,      // 正常模式
  RECORDING,   // 录制模式
  REPLAYING    // 重放模式
};

static Mode gCurrentMode = NORMAL;

bool RecordReplayIsReplaying() {
  return gCurrentMode == REPLAYING;
}
```

## 3. 确定性重放原理

### 3.1 核心机制

**录制阶段**:
```cpp
void ExecuteCode() {
  if (IsRecording()) {
    // 记录非确定性输入
    double time = SystemTime();
    RecordValue(time);

    // 执行代码
    result = DoSomething(time);

    // 记录执行点
    RecordExecutionPoint();
  }
}
```

**重放阶段**:
```cpp
void ExecuteCode() {
  if (IsReplaying()) {
    // 读取记录的值
    double time = ReadRecordedValue();

    // 使用记录的值执行
    result = DoSomething(time);

    // 验证执行点
    VerifyExecutionPoint();
  }
}
```

### 3.2 非确定性源处理

| 非确定性源 | 录制 | 重放 |
|-----------|------|------|
| `Date.now()` | 记录系统时间 | 返回记录的时间 |
| `Math.random()` | 记录随机数 | 返回记录的随机数 |
| 网络请求 | 记录响应 | 返回记录的响应 |
| 用户输入 | 记录事件 | 按时间重放事件 |
| 定时器 | 记录触发时间 | 按记录时间触发 |
| Promise | 记录解决顺序 | 按记录顺序解决 |

## 4. 断点调试实现

### 4.1 断点 API

```cpp
// 从二进制中提取
RecordReplayAddPossibleBreakpoint         // 添加可能的断点
RecordReplaySetPossibleBreakpointsCallback // 设置断点回调
RecordReplaySetClearPauseDataCallback     // 设置清除暂停数据回调
```

### 4.2 断点工作流程

```
用户在 DevTools 设置断点
    ↓
WebSocket 发送 Debugger.setBreakpoint
    ↓
云端 Replay Engine 接收
    ↓
标记执行点为断点
    ↓
重放执行到断点
    ↓
暂停执行 (Pause)
    ↓
收集暂停状态
    ↓
通过 WebSocket 返回给前端
    ↓
DevTools 显示暂停状态
```

### 4.3 暂停状态管理

```javascript
// replay_command_handlers.js

const CommandCallbacks = {
  "Pause.evaluateInFrame": Pause_evaluateInFrame,
  "Pause.evaluateInGlobal": Pause_evaluateInGlobal,
  "Pause.getAllFrames": Pause_getAllFrames,
  "Pause.getExceptionValue": Pause_getExceptionValue,
  "Pause.getObjectPreview": Pause_getObjectPreview,
  "Pause.getObjectProperty": Pause_getObjectProperty,
  "Pause.getScope": Pause_getScope,
  // ...
};
```

**暂停时可以做什么**:
1. 查看调用栈 (`Pause.getAllFrames`)
2. 检查变量 (`Pause.getScope`)
3. 评估表达式 (`Pause.evaluateInFrame`)
4. 查看对象属性 (`Pause.getObjectProperty`)
5. 获取异常值 (`Pause.getExceptionValue`)

## 5. 时间旅行调试

### 5.1 执行点跳转

```cpp
RecordReplayProgressCounter()              // 当前进度
RecordReplayTargetProgressReached()        // 到达目标进度
RecordReplayProgressReached()              // 进度到达回调
```

**实现原理**:
```cpp
// 伪代码
void JumpToExecutionPoint(uint64_t targetPoint) {
  if (targetPoint < currentPoint) {
    // 向后跳转：从最近的检查点恢复
    Checkpoint* checkpoint = FindNearestCheckpoint(targetPoint);
    RestoreCheckpoint(checkpoint);
    currentPoint = checkpoint->point;
  }

  // 向前执行到目标点
  while (currentPoint < targetPoint) {
    ExecuteNextInstruction();
    currentPoint++;
  }

  // 到达目标点，触发暂停
  TriggerPause();
}
```

### 5.2 检查点机制

```cpp
RecordReplayNewCheckpoint()                // 创建检查点
RecordReplayNewBookmark()                  // 创建书签
```

**检查点内容**:
- 完整的内存状态
- 调用栈
- 变量值
- DOM 状态
- 执行点位置

**优化**: 不是每个执行点都创建检查点，而是定期创建（如每 5 秒）

## 6. CDP (Chrome DevTools Protocol) 集成

### 6.1 协议通信

```javascript
// 前端发送命令
{
  id: 1,
  method: "Debugger.setBreakpoint",
  params: {
    location: {
      scriptId: "123",
      lineNumber: 42
    }
  }
}

// 云端返回结果
{
  id: 1,
  result: {
    breakpointId: "bp-1",
    actualLocation: {
      scriptId: "123",
      lineNumber: 42,
      columnNumber: 0
    }
  }
}

// 云端发送事件
{
  method: "Debugger.paused",
  params: {
    callFrames: [...],
    reason: "breakpoint",
    hitBreakpoints: ["bp-1"]
  }
}
```

### 6.2 支持的 CDP 命令

**Debugger 域**:
- `Debugger.setBreakpoint` - 设置断点
- `Debugger.removeBreakpoint` - 移除断点
- `Debugger.getPossibleBreakpoints` - 获取可能的断点
- `Debugger.pause` - 暂停执行
- `Debugger.resume` - 继续执行
- `Debugger.stepOver` - 单步跳过
- `Debugger.stepInto` - 单步进入
- `Debugger.stepOut` - 单步跳出

**Runtime 域**:
- `Runtime.evaluate` - 评估表达式
- `Runtime.getProperties` - 获取属性
- `Runtime.callFunctionOn` - 调用函数

**Pause 域** (Replay 自定义):
- `Pause.evaluateInFrame` - 在帧中评估
- `Pause.getAllFrames` - 获取所有帧
- `Pause.getScope` - 获取作用域

## 7. 云端架构

### 7.1 Kubernetes 部署

根据搜索结果，Replay.io 使用 Kubernetes 管理云端浏览器实例：

```yaml
# 伪配置
apiVersion: v1
kind: Pod
metadata:
  name: replay-engine-{session-id}
spec:
  containers:
  - name: replay-chromium
    image: replay/chromium:108.0.5359.0
    env:
    - name: REPLAY_MODE
      value: "REPLAYING"
    - name: RECORDING_ID
      value: "{recording-id}"
    resources:
      limits:
        memory: "4Gi"
        cpu: "2"
```

### 7.2 会话管理

```
用户打开 Replay
    ↓
创建会话 (Session)
    ↓
分配 Kubernetes Pod
    ↓
启动 Replay Chromium
    ↓
加载录制文件
    ↓
建立 WebSocket 连接
    ↓
用户调试
    ↓
会话结束
    ↓
销毁 Pod
```

### 7.3 资源优化

**挑战**: 每个用户都需要一个浏览器实例，资源消耗大

**优化策略**:
1. **按需启动**: 只在用户打开 Replay 时启动
2. **自动回收**: 空闲一段时间后销毁
3. **资源限制**: 限制 CPU 和内存使用
4. **共享检查点**: 多个用户可以共享相同录制的检查点

## 8. 偏离检测

### 8.1 偏离检测机制

```cpp
RecordReplayHasDivergedFromRecording()     // 检查是否偏离
RecordReplayHadMismatch()                  // 检测到不匹配
```

**实现**:
```cpp
void RecordReplayAssertValue(Value value) {
  if (IsReplaying()) {
    Value expected = ReadRecordedValue();
    if (value != expected) {
      // 检测到偏离！
      gHasDiverged = true;

      // 记录偏离信息
      LogDivergence({
        executionPoint: currentPoint,
        expected: expected,
        actual: value,
        stackTrace: GetStackTrace()
      });

      // 可选：触发调试器
      if (ShouldBreakOnDivergence()) {
        TriggerDebugger();
      }
    }
  }
}
```

### 8.2 偏离原因

可能导致偏离的原因：
1. **录制文件损坏**
2. **浏览器版本不匹配**
3. **系统环境差异**
4. **并发问题**（多线程竞争）
5. **外部依赖变化**（如 CDN 资源）

## 9. 性能优化

### 9.1 快速跳转

**问题**: 从头重放到目标点可能很慢

**解决方案**:
1. **检查点**: 定期保存完整状态
2. **增量重放**: 从最近的检查点开始
3. **并行分析**: 提前分析录制文件

### 9.2 按需加载

**问题**: 录制文件可能很大

**解决方案**:
1. **分段加载**: 只加载需要的部分
2. **流式传输**: 边加载边重放
3. **缓存**: 缓存常用的检查点

## 10. 与本地录制的对比

| 特性 | 本地录制 | 云端重放 |
|------|---------|---------|
| 录制位置 | 本地浏览器 | 本地浏览器 |
| 重放位置 | ❌ 不支持 | ✅ 云端浏览器 |
| 断点调试 | ❌ | ✅ |
| 时间旅行 | ❌ | ✅ |
| 协作 | ❌ | ✅ 分享链接 |
| 资源消耗 | 低 | 高（云端） |
| 网络要求 | 低 | 高（需要上传） |

## 11. 技术优势

### 11.1 vs 传统调试器

**传统调试器**:
- 只能向前执行
- 难以复现 Bug
- 无法回溯

**Replay.io**:
- ✅ 可以向后跳转
- ✅ 完全可复现
- ✅ 任意时间点检查

### 11.2 vs Session Replay

**Session Replay**:
- 只记录 DOM 变化
- 无法调试代码
- 不支持断点

**Replay.io**:
- ✅ 记录完整运行时
- ✅ 支持代码调试
- ✅ 支持断点和变量检查

## 12. 总结

### 12.1 重放架构

```
录制 (本地)
  ↓
上传 (云端存储)
  ↓
重放 (云端 Kubernetes)
  ↓
调试 (浏览器 DevTools UI)
```

### 12.2 关键技术

1. **云端重放引擎**
   - Kubernetes 管理
   - 按需启动/销毁
   - 资源隔离

2. **确定性重放**
   - 非确定性源拦截
   - 执行点验证
   - 偏离检测

3. **时间旅行**
   - 检查点机制
   - 快速跳转
   - 任意时间点暂停

4. **CDP 集成**
   - 标准协议
   - 完整 DevTools 支持
   - 自定义扩展

### 12.3 回答原问题

**Q: 回放是如何实现的？**
A: 在云端运行 Replay Chromium，加载录制文件，使用记录的非确定性数据进行确定性重放。

**Q: 断点是如何工作的？**
A: 云端 Replay Engine 在执行到断点时暂停，收集状态，通过 WebSocket (CDP) 返回给前端 DevTools UI。

**Q: 是云端跑浏览器吗？**
A: **是的！** 使用 Kubernetes 在云端运行 Replay Chromium 实例，每个用户会话一个实例。

---

**参考资料**:
- [How Replay Works](https://blog.replay.io/how-to-build-a-time-machine)
- [Inspecting Runtimes](https://medium.com/replay-io/inspecting-runtimes-caeca007a4b1)
- [Cloud Development Environment Journey](https://blog.replay.io/our-cloud-development-environment-journey)
- [How Time Travel Works](https://docs.replay.io/basics/time-travel/how-does-time-travel-work)

**文档版本**: 1.0
**创建日期**: 2026-03-03
**核心发现**: 云端重放 + Kubernetes 架构
