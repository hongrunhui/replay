# Replay.io V8 Fork —— 完整补丁清单

> 来源：`replay-github/chromium-v8/`（他们 Chromium 108 fork 里捆绑的 V8，~V8 10.8）
> 整理日期：2026-04-23
> 用途：对照我们 Node.js V8 补丁做差距分析（写于"准备 port 我们的补丁"时；2026-04-27 转向后，我们改用 Replay.io 的 fork 做基底，所以本文档从"port 计划"变成"了解我们继承了什么"的参考）
>
> **注**：表格、字节码名、文件路径、代码片段保持英文（这就是它们的真实形式）。本文档结构性中文 + 技术内容英文。

---

## 一、新增字节码（共 7 个 —— 我们有 4 个）

File: `src/interpreter/bytecodes.h` (lines 438–448)

| # | Bytecode | ImplicitRegisterUse | Operands | Open Replay? |
|---|----------|---------------------|----------|:---:|
| 1 | `RecordReplayIncExecutionProgressCounter` | `kNone` | — | ✅ |
| 2 | `RecordReplayNotifyActivity` | `kNone` | — | ❌ |
| 3 | `RecordReplayInstrumentation` | `kNone` | `kIdx` | ✅ |
| 4 | `RecordReplayInstrumentationGenerator` | `kNone` | `kIdx, kReg` | ✅ |
| 5 | `RecordReplayInstrumentationReturn` | `kNone` | `kIdx, kReg` | ❌ |
| 6 | `RecordReplayAssertValue` | `kReadWriteAccumulator` | `kIdx` | ✅ |
| 7 | `RecordReplayTrackObjectId` | `kNone` | `kReg` | ❌ |

**Missing (priority for browser replay):**
- **TrackObjectId** — assigns persistent object IDs for DevTools UI; critical for "pause at point, show same object" semantics
- **InstrumentationReturn** — captures return values; needed for step-out semantics
- **NotifyActivity** — lightweight marker; used for async-activity tracking

---

## 二、Ignition（解释器）Handler

File: `src/interpreter/interpreter-generator.cc` (lines 2850–2914)

All follow the same template: load context/closure/operands, `CallRuntime(...)`, `Dispatch()`.

The differentiator is `SetAccumulator(result)` on `RecordReplayAssertValue` — the runtime can rewrite the accumulator during replay (used when a recorded value differs from the live one and we must substitute).

---

## 三、Baseline JIT Handler

File: `src/baseline/baseline-compiler.cc` (lines 2288–2351)

Each handler wraps a `SaveAccumulatorScope` and emits a single `CallRuntime`. Note: their `IncExecutionProgressCounter` explicitly disables the fast-path they previously had (linear issue RUN-744 referenced in their code comments).

**Open Replay note:** our baseline handlers use `IndexAsSmi(0)` + `RegisterOperand(1)` patterns — matches Replay.io's approach.

---

## 四、TurboFan Graph Builder

File: `src/compiler/bytecode-graph-builder.cc` (lines 3602–3700)

Key pattern: `PrepareEagerCheckpoint()` before each call, `RecordAfterState(node, kAttachFrameState)` after. This lets the optimizer create deoptimization frames at exactly these points — critical for time-travel semantics (can't skip an instrumentation site during deopt).

**`RecordReplayIncExecutionProgressCounter` is special:** In recording mode, it uses a simplified `IncrementAndCheckProgressCounter()` operator (fast path, just increments). In replay mode or when `gRecordReplayAssertProgress` is on, it falls back to a full runtime call.

---

## 五、Maglev（中间层 JIT）Handler

File: `src/maglev/maglev-graph-builder.cc` (lines 3384–3428)

Minimal — `BuildCallRuntime()` for each. No graph-level optimization.

**Open Replay gap:** we didn't patch Maglev because Node.js v20 doesn't enable it by default. For Chromium we MUST patch Maglev (enabled by default in Chromium 117+) OR disable Maglev with `--no-maglev`.

---

## 六、Runtime 函数（共 8 个 —— 我们有 5 个）

File: `src/runtime/runtime.h` (FOR_EACH_INTRINSIC_INTERNAL, lines 151–158)

| Function | Args | Open Replay? |
|----------|:----:|:---:|
| `RecordReplayAssertExecutionProgress` | 1 | ✅ |
| `RecordReplayTargetProgressReached` | 0 | ✅ |
| `RecordReplayNotifyActivity` | 0 | ❌ |
| `RecordReplayAssertValue` | 3 | ✅ |
| `RecordReplayInstrumentation` | 2 | ✅ |
| `RecordReplayInstrumentationGenerator` | 3 | ✅ |
| `RecordReplayInstrumentationReturn` | 3 | ❌ |
| `RecordReplayTrackObjectId` | 1 | ❌ |

### Runtime Implementation Insights (`src/runtime/runtime-debug.cc`)

- **AssertExecutionProgress** (our entry point from IncProgressCounter bytecode) increments `*gProgressCounter` and checks `gTargetProgress`. When matched, calls `RecordReplayOnTargetProgressReached()` extern — this is the time-travel trigger.
- **InstrumentationReturn** sets a global `gCurrentReturnValue` then calls `OnInstrumentation()` then clears it. The global is how the debugger reads the "about-to-return" value.
- **TrackObjectId** calls `RecordReplayObjectId()` extern — the driver maintains a persistent id map for DevTools. **This is DevTools-critical.**

---

## 七、V8 公开 API 表面

File: `include/v8.h` (lines 91–204), `include/replayio.h`, `include/replayio-macros.h`

The `v8::recordreplay` namespace exposes ~70+ static methods. Groups:

### Already used by our driver
- `SetRecordingOrReplaying`, `IsRecording`, `IsReplaying`, `GetRecordingId`
- `RecordReplayValue`, `RecordReplayBytes`, `RecordReplayString`
- `Print`, `Diagnostic`, `Warning`, `Crash`
- `BeginPassThroughEvents`/`End...`, `BeginDisallowEvents`/`End...`

### Browser-critical additions (we need to add)
- **Event mode inspection**: `AreEventsPassedThrough(why?)`, `AreEventsDisallowed(why?)`, `IsInReplayCode(why?)` — allows embedder code to query recording state
- **Divergence**: `HasDivergedFromRecording()`, `InvalidateRecording(why)`, `HadMismatch()`, `AllowSideEffects()`
- **Ordered locks**: `CreateOrderedLock(name)`, `OrderedLock(id)`, `OrderedUnlock(id)` — **multi-process coordination primitive**
- **Pointer registry**: `RegisterPointer/UnregisterPointer/PointerId/IdPointer` — persistent handle across checkpoints
- **Dependency graph**: `NewDependencyGraphNode`, `AddDependencyGraphEdge`, `BeginDependencyExecution`, `EndDependencyExecution` — records async-task causality (powers Performance analysis)
- **Buffer assertions**: `BeginAssertBufferAllocations`, `EndAssertBufferAllocations` — debug aid for flaky recordings
- **Feature gates**: `IsRecordingOrReplaying(feature, subfeature)` — conditional determinism layers

### RAII helpers (headers)
- `AutoPassThroughEvents`, `AutoDisallowEvents`, `AutoOrderedLock`, `AutoDependencyExecution`, `AutoAssertMaybeEventsDisallowed`, `AutoAssertBufferAllocations`

---

## 八、Inspector（Chrome DevTools Protocol）集成

Four files patched:

| File | Purpose |
|------|---------|
| `src/inspector/v8-debugger-agent-impl.cc` | `V8RecordReplayGetCurrentException()` extern; replay-safe exception fetch |
| `src/inspector/v8-inspector-session-impl.cc` | `RecordReplayMessageAnnotation(kind, contents)` on every inspector message; `V8RecordReplayOnAnnotation()` callback; uses `AutoDisallowEvents` around command dispatch |
| `src/inspector/injected-script.cc` | `RecordReplayObjectId()` for remote object → persistent id |
| `src/inspector/v8-console-message.cc` | `V8RecordReplayOnConsoleMessage(bookmark)`; records console assertion landmarks |

**This is what allows DevTools to work in replay mode:** inspector commands are marked as `DisallowEvents` so they don't themselves generate recording events; the session annotates messages so the driver can correlate commands with execution points.

---

## 九、Math.random()

File: `src/numbers/math-random.cc` (line 68)

```cpp
base::RandomNumberGenerator::XorShift128(&state.s0, &state.s1);
double v = base::RandomNumberGenerator::ToDouble(state.s0);
recordreplay::RecordReplayBytes("MathRandom", &v, sizeof(v));
cache.set(i, v);
```

Single line insertion. Records each double as it refills the RNG cache. Trivial to port — **we already do this differently** (via `--random-seed`, which is coarser but simpler). For browser we should switch to the Replay.io approach since browsers can't accept a CLI seed arg.

---

## 十、横切：isolate.cc / api.cc / debug.cc / execution.cc

Many small hooks (13 in api.cc, 6 in execution.cc, handful in debug.cc):

- **Source content replacement**: `Module::Evaluate` and script compile paths let the driver substitute source on replay
- **Default context fallback**: `V8RecordReplayGetDefaultContext()` handles "no current context" during replay
- **Exception unwind**: `RecordReplayOnExceptionUnwind()` hook; lets driver observe throws
- **Debugger statement**: `V8RecordReplayOnDebuggerStatement()`
- **Dependency graph execution scope**: `BeginDependencyExecution`/`End...` wraps function invocations

---

## 十一、编译器标志

File: `src/codegen/compiler.cc` (lines 1611–1625)

`SetRecordReplayFlags()` sets per-compile bytecode-generator flags:
- `emit_record_replay_bytecodes` — on when recording or replaying AND events not disallowed
- `record_replay_assert_values` — on when recording AND asserts enabled

This is the key gating point: **whether bytecodes emit our new opcodes at compile time** is controlled globally by driver state. A JS function compiled during a `DisallowEvents` region gets NO instrumentation — later calls to it run at full speed.

File: `src/codegen/compiler.cc` (lines 3610–3630): `GetSharedFunctionInfoForScriptImpl()` records the script_id via `RecordReplayValue` so the same script gets the same ID on replay. **Script-ID stability is foundational.**

---

## 十二、Mutex / 有序锁

File: `src/base/platform/mutex.cc` (line 85)

```cpp
extern "C" void V8RecordReplayAddOrderedPthreadMutex(const char* name, void* mutex);
// ...
V8RecordReplayAddOrderedPthreadMutex(ordered_name, mutex);
```

Every V8-created pthread_mutex is registered with the driver at construction. The driver then enforces a consistent lock-acquisition order during replay — critical for deterministic multi-threaded execution (and Chromium has many threads per process).

**Open Replay gap:** we disable thread interception entirely (`thread.cc` disabled). For browser we must implement ordered locks — or accept single-thread-only replay (which rules out main renderer).

---

## 差距总结（与我们 Node.js V8 补丁的对比）

### What we have, works
- Progress counter (bytecode + runtime + external ref)
- Instrumentation points (function entry/call sites)
- AssertValue for divergence check
- Basic `RecordReplayBytes`/`RecordReplayValue` via function pointers
- Dynamic-load driver initialization

### What we need to add for Chromium
1. **3 missing bytecodes** (NotifyActivity, InstrumentationReturn, TrackObjectId) + their 3 runtime functions
2. **Maglev handlers** (Chromium enables Maglev by default)
3. **Full `v8::recordreplay` public API** — dozens of methods; our current `runtime-recordreplay.cc` only stubs 8 function pointers. Needs to grow to ~50.
4. **Ordered lock infrastructure** in the driver — `V8RecordReplayAddOrderedPthreadMutex` callback + serialization logic
5. **Inspector patches** — console/debugger/injected-script hooks
6. **Math.random() inline record** — replace --random-seed approach
7. **Compiler flags plumbing** — `emit_record_replay_bytecodes` gating
8. **Script ID recording** in `GetSharedFunctionInfoForScriptImpl`

### What stays unchanged
- File format (.orec) works as-is for browser
- `raw_syscall.h` — still needed for recording-stream I/O
- InterceptGuard — still needed

---

## 决策：V8 版本对齐（已被 2026-04-27 转向作废）

Our Node.js V8 patches target **V8 11.3** (Node.js v20). Replay.io targets **V8 10.8** (Chromium 108).

Chromium V8 version reference:
- Chromium 108 → V8 10.8
- Chromium 114 → V8 11.4
- Chromium 116 → V8 11.6
- Chromium 120 → V8 12.0

**Recommendation: target Chromium 116** — V8 11.6 is close enough to our 11.3 patches that API diffs are minor, AND we get newer web platform features (makes demo more impressive). Chromium 108 is 3+ years old and missing critical features (e.g., Baseline stability, View Transitions).

Alternative: **Chromium 120** (latest stable as of early 2024) — V8 12.0 has more API churn but we get modern renderer. Maglev is fully default-on. More patch effort.

**Going with Chromium 116** for first attempt.
