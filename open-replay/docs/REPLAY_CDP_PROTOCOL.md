# Replay.io 完整 CDP 协议梳理

> 从 replay-github/devtools 源码中提取的所有协议方法
> 用于对照实现 Open Replay 的协议兼容层

---

## 1. Recording Domain

| Method | 参数 | 返回 | Open Replay |
|--------|------|------|:-----------:|
| `Recording.createSession` | `{recordingId, experimentalSettings?, focusRequest?}` | `{sessionId}` | ✅ |
| `Recording.releaseSession` | `{sessionId}` | `{}` | ✅ |
| `Recording.processRecording` | 处理参数 | 处理结果 | ❌ 不需要 |
| `Recording.addSourceMap` | sourcemap 参数 | 结果 | ❌ |
| `Recording.addOriginalSource` | 源码参数 | 结果 | ❌ |

## 2. Session Domain

| Method | 参数 | 返回 | Open Replay |
|--------|------|------|:-----------:|
| `Session.createPause` | `{point: ExecutionPoint}` | `{pauseId, stack, data}` | ❌ 用 runToLine 替代 |
| `Session.getBuildId` | `{}` | `{buildId}` | ✅ via getDescription |
| `Session.getEndpoint` | `{}` | `{endpoint: TimeStampedPoint}` | ❌ |
| `Session.getPointNearTime` | `{time}` | `{point}` | ❌ |
| `Session.findPoints` | `{pointSelector, pointLimits}` | `{nextBegin?}` | ❌ 替代了 Analysis |
| `Session.runEvaluation` | `{pointSelector, expression, ...}` | `{nextBegin?}` | ❌ 替代了 Analysis |
| `Session.findAnnotations` | `{kind}` | void (via event) | ❌ |
| `Session.ensureProcessed` | `{}` | 处理结果 | ❌ |

## 3. Debugger Domain

| Method | 参数 | 返回 | Open Replay |
|--------|------|------|:-----------:|
| `Debugger.findSources` | `{}` | void (via newSource event) | ✅ via getSources |
| `Debugger.getSourceContents` | `{sourceId}` | `{contents}` | ✅ via readFile |
| `Debugger.streamSourceContents` | `{sourceId}` | void (via chunks) | ❌ |
| `Debugger.getSourceOutline` | `{sourceId}` | 函数/类列表 | ❌ |
| `Debugger.getSourceMap` | `{sourceId}` | `{contents}` | ❌ |
| `Debugger.getPossibleBreakpoints` | `{sourceId, begin?, end?}` | `{lineLocations}` | ❌ |
| **`Debugger.getHitCounts`** | **`{sourceId, locations, maxHits?, range?}`** | **`{hits: HitCount[]}`** | **✅ 替代方案** |
| `Debugger.getScopeMap` | `{location}` | `{map: VariableMapping[]}` | ❌ |
| `Debugger.getMappedLocation` | `{location}` | `{mappedLocation}` | ❌ |
| `Debugger.findStepInTarget` | `{point}` | `{target: PauseDescription}` | ❌ |
| `Debugger.findStepOutTarget` | `{point}` | `{target: PauseDescription}` | ❌ |
| `Debugger.findStepOverTarget` | `{point}` | `{target: PauseDescription}` | ❌ |
| **`Debugger.findReverseStepOverTarget`** | **`{point}`** | **`{target: PauseDescription}`** | **❌ 关键缺失** |
| `Debugger.searchSourceContents` | `{query, sourceIds?}` | void (via matches event) | ❌ |
| `Debugger.searchFunctions` | `{query, sourceIds?}` | void (via matches event) | ❌ |

## 4. Pause Domain

| Method | 参数 | 返回 | Open Replay |
|--------|------|------|:-----------:|
| `Pause.evaluateInFrame` | `{frameId, expression, pure?, useOriginalScopes?}` | `{result}` | ✅ |
| `Pause.evaluateInGlobal` | `{expression, pure?}` | `{result}` | ❌ |
| `Pause.getAllFrames` | `{}` | `{frames, data}` | ✅ |
| `Pause.getTopFrame` | `{}` | `{frame, data}` | ❌ |
| `Pause.getFrameSteps` | `{frameId}` | `{steps: PointDescription[]}` | ❌ |
| `Pause.getScope` | `{scope: ScopeId}` | `{bindings, data}` | ✅ |
| `Pause.getExceptionValue` | `{}` | `{exception, data}` | ❌ |
| `Pause.getObjectPreview` | `{object, level?}` | `{data: PauseData}` | ⚠️ 部分 |
| `Pause.getObjectProperty` | `{object, name}` | `{result}` | ❌ |

## 5. Console Domain

| Method | 参数 | 返回 | Open Replay |
|--------|------|------|:-----------:|
| `Console.findMessages` | `{}` | `{overflow}` + events | ✅ |
| `Console.findMessagesInRange` | `{range}` | `{messages, overflow}` | ❌ |

## 6. Graphics Domain (浏览器专用)

| Method | 参数 | 返回 | Open Replay |
|--------|------|------|:-----------:|
| `Graphics.findPaints` | `{}` | void + events | ❌ N/A |
| `Graphics.getPaintContents` | `{point, mimeType}` | `{screen}` | ❌ N/A |

## 7. DOM Domain (浏览器专用)

| Method | Open Replay |
|--------|:-----------:|
| `DOM.getDocument` | ❌ N/A |
| `DOM.querySelector` | ❌ N/A |
| `DOM.performSearch` | ❌ N/A |
| `DOM.getAllBoundingClientRects` | ❌ N/A |
| `DOM.getBoundingClientRect` | ❌ N/A |
| `DOM.getBoxModel` | ❌ N/A |
| `DOM.getEventListeners` | ❌ N/A |
| `DOM.getParentNodes` | ❌ N/A |
| `DOM.repaintGraphics` | ❌ N/A |

## 8. CSS Domain (浏览器专用)

| Method | Open Replay |
|--------|:-----------:|
| `CSS.getAppliedRules` | ❌ N/A |
| `CSS.getComputedStyle` | ❌ N/A |

## 9. Network Domain

| Method | 参数 | 返回 | Open Replay |
|--------|------|------|:-----------:|
| `Network.findRequests` | `{}` | void + events | ❌ |
| `Network.getRequestBody` | `{id}` | void + events | ❌ |
| `Network.getResponseBody` | `{id}` | void + events | ❌ |

---

## HitCount 获取机制详解

### Replay.io 的方式

```
1. Debugger.getPossibleBreakpoints({ sourceId })
   → 返回 { lineLocations: SameLineSourceLocations[] }
   → 获取每行可断点的列位置

2. Debugger.getHitCounts({ sourceId, locations, maxHits?, range? })
   → 返回 { hits: HitCount[] }
   → 每个 HitCount = { hits: number, location: { line, column } }

3. 前端聚合为 LineNumberToHitCountMap:
   Map<lineNumber, { count: number, firstBreakableColumnIndex: number }>
```

**关键**：这是 Replay.io 的自研协议扩展，不是标准 CDP。他们的 cloud replay engine 原生支持这个 API。

### Open Replay 的替代方案

```
1. 启动临时 replay 进程 (--inspect-brk)
2. 连接 inspector，启用 Profiler
3. Profiler.startPreciseCoverage({ callCount: true, detailed: true })
4. Runtime.runIfWaitingForDebugger → 脚本运行
5. 脚本结束后 Profiler.takePreciseCoverage
   → 返回 { result: ScriptCoverage[] }
   → 每个 ScriptCoverage = { scriptId, url, functions: FunctionCoverage[] }
   → 每个 FunctionCoverage = { ranges: CoverageRange[] }
   → 每个 CoverageRange = { startOffset, endOffset, count }
6. 将 byte offset 转换为行号（扫描源码中的 \n）
7. 取每行所有覆盖范围的最大 count
```

**区别**：
- Replay.io: 精确到列级别，支持 range 过滤（只查某时间段的命中）
- Open Replay: 精确到行级别，统计整个执行过程的命中

---

## 变量/作用域获取机制详解

### Replay.io 的方式

```
1. Session.createPause({ point })
   → 在执行点创建暂停上下文

2. Pause.getAllFrames()
   → 返回调用栈帧，每帧有 scopeChain

3. Pause.getScope({ scope: scopeId })
   → 返回 bindings（变量绑定列表）

4. Debugger.getScopeMap({ location })
   → 返回 VariableMapping[]（原始变量名 → 编译后变量名映射）
   → 用于 source map 场景

5. Pause.getObjectPreview({ object, level? })
   → 返回对象的属性预览（支持嵌套层级控制）
   → level: "full" | "compact" | "name"

6. Pause.getObjectProperty({ object, name })
   → 获取单个属性值

7. Pause.evaluateInFrame({ frameId, expression, useOriginalScopes? })
   → 在帧上下文中求值表达式
   → useOriginalScopes 用于在原始代码作用域中求值
```

### Open Replay 的方式

```
1. Recording.runToLine({ file, line })
   → 重启进程运行到目标行
   → 返回 frames (callFrameId + lineNumber + scopeChain)

2. Pause.getScope({ frameId })
   → 遍历 scopeChain，对每个 scope 调用 Runtime.getProperties
   → 过滤 Node.js 内部变量
   → 返回 scopes[{ type, bindings[{ name, value, type }] }]

3. Pause.evaluateInFrame({ frameId, expression })
   → 调用 CDP Debugger.evaluateOnCallFrame
   → returnByValue: true
```

---

## Node.js 专用 vs 浏览器专用

| 领域 | 适用场景 | Open Replay 需要 |
|------|---------|:-------:|
| Recording/Session | 通用 | ✅ |
| Debugger | 通用 | ✅ |
| Pause | 通用 | ✅ |
| Console | 通用 | ✅ |
| Network | 通用（Node HTTP） | ⚠️ 可选 |
| Graphics/DOM/CSS | 浏览器专用 | ❌ 不需要 |

## 统计

| 类别 | Replay.io 总方法 | Node.js 相关 | Open Replay 已实现 | 覆盖率 |
|------|:---:|:---:|:---:|:---:|
| Recording | 5 | 2 | 2 | 100% |
| Session | 13 | 5 | 1 | 20% |
| Debugger | 16 | 10 | 4 | 40% |
| Pause | 9 | 9 | 4 | 44% |
| Console | 2 | 2 | 1 | 50% |
| Network | 3 | 3 | 0 | 0% |
| **总计** | **48** | **31** | **12** | **39%** |

## 优先实现的方法（按价值排序）

1. **`Debugger.getHitCounts`** — 已有替代实现（V8 Profiler），需要确保 UI 能显示
2. **`Pause.getObjectPreview`** — 对象展开查看，调试核心功能
3. **`Debugger.findReverseStepOverTarget`** — 精确后退目标计算
4. **`Session.createPause`** — 基于执行点的暂停（更精确的时间旅行）
5. **`Pause.getFrameSteps`** — 帧内单步位置列表
6. **`Network.findRequests`** — 网络请求面板
7. **`Console.findMessagesInRange`** — 范围内的 console 消息
