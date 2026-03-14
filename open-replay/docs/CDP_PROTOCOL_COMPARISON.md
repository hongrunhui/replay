# CDP 协议对比：Replay.io vs Open Replay

## Replay.io 使用的 CDP Methods

### Session 管理
| Method | Replay.io | Open Replay | 状态 |
|--------|:---------:|:-----------:|------|
| `Session.createSession` | ✅ | ✅ | 已实现 |
| `Session.releaseSession` | ✅ | ✅ | 已实现 |

### 录制信息
| Method | Replay.io | Open Replay | 状态 |
|--------|:---------:|:-----------:|------|
| `Recording.getDescription` | ✅ | ✅ | 已实现（含 scriptPath） |
| `Recording.getSources` | ✅ | ✅ | 已实现 |
| `Recording.getSourceContents` | ✅ | ✅ | 已实现（via readFile） |

### 调试控制
| Method | Replay.io | Open Replay | 状态 |
|--------|:---------:|:-----------:|------|
| `Debugger.setBreakpoint` | ✅ | ✅ | 已实现 |
| `Debugger.setBreakpointByUrl` | ✅ | ✅ | 已实现（runToLine 内部用） |
| `Debugger.removeBreakpoint` | ✅ | ✅ | 已实现 |
| `Debugger.getPossibleBreakpoints` | ✅ | ❌ | 未实现 |
| `Debugger.findStepTarget` | ✅ (自研) | ❌ | 未实现 — 计算 step back 目标 |

### 暂停与执行
| Method | Replay.io | Open Replay | 状态 |
|--------|:---------:|:-----------:|------|
| `Pause.getAllFrames` | ✅ | ✅ | 已实现 |
| `Pause.getScope` | ✅ | ⚠️ | 部分实现（通过 evaluateInFrame 替代） |
| `Pause.evaluateInFrame` | ✅ | ✅ | 已实现 |
| `Pause.getObjectPreview` | ✅ | ⚠️ | 部分实现（通过 evaluateInFrame） |
| `Pause.getObjectProperty` | ✅ | ❌ | 未实现 |

### 分析引擎
| Method | Replay.io | Open Replay | 状态 |
|--------|:---------:|:-----------:|------|
| `Analysis.createAnalysis` | ✅ | ❌ stub | 未实现（MapReduce 分析） |
| `Analysis.addLocation` | ✅ | ❌ stub | |
| `Analysis.runAnalysis` | ✅ | ❌ stub | |
| `Recording.collectHitCounts` | N/A | ✅ | 我们的替代方案（V8 Profiler Coverage） |

### Console
| Method | Replay.io | Open Replay | 状态 |
|--------|:---------:|:-----------:|------|
| `Console.findMessages` | ✅ | ✅ | 已实现（stdout 捕获） |

### 时间旅行
| Method | Replay.io | Open Replay | 状态 |
|--------|:---------:|:-----------:|------|
| `Recording.runToLine` | N/A (自研) | ✅ | 已实现（重启式） |
| `Recording.run` | N/A | ✅ | 已实现（无调试器回放） |
| `Recording.startEngine` | N/A | ✅ | 已实现 |

### Graphics（浏览器专用）
| Method | Replay.io | Open Replay | 状态 |
|--------|:---------:|:-----------:|------|
| `Graphics.findPaints` | ✅ | ❌ | N/A（Node.js 无截图） |
| `Graphics.getPaintContents` | ✅ | ❌ | N/A |

## 关键差距

### 1. `Pause.getScope` — 完整作用域链
Replay.io 返回完整的作用域层级（Global → Module → Function → Local → Closure → Block）。
我们只通过 `evaluateInFrame` 手动求值变量，没有自动枚举作用域内所有变量。

**修复方案**：在 protocol.ts 的 `Pause.getScope` 中调用 CDP `Runtime.getProperties` 遍历 scopeChain。

### 2. `Pause.getObjectPreview` — 对象懒加载
Replay.io 支持点击展开对象/数组查看属性。我们只返回 JSON.stringify 的字符串。

**修复方案**：在 protocol.ts 实现 `Pause.getObjectPreview`，调用 CDP `Runtime.getProperties`。

### 3. `Analysis.*` — MapReduce 分析
Replay.io 通过并行 replay pod 做批量分析（如"这个断点被命中了几次"）。
我们用 V8 Profiler Coverage 替代，功能等价但不支持并行。

### 4. `Debugger.findStepTarget` — 精确 step back 目标
Replay.io 能计算 "后退一步" 应该到哪里。我们只能 runToLine(currentLine - 1)。

## 总结

| 类别 | Replay.io 方法数 | Open Replay 已实现 | 覆盖率 |
|------|:---:|:---:|:---:|
| Session/Recording | 5 | 5 | 100% |
| Debugger | 5 | 3 | 60% |
| Pause | 5 | 2 | 40% |
| Analysis | 3 | 1 (替代方案) | 33% |
| Console | 1 | 1 | 100% |
| 时间旅行 | 1 | 3 | 300% (我们有更多) |
| **总计** | **20** | **15** | **75%** |
