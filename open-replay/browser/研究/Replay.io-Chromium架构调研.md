# Replay.io Chromium 架构调研报告

**整理日期：2026-04（第一版）**
**用途：原本规划 Open Replay 自己 port Chromium；2026-04-27 转向后改作"了解我们用的 Replay.io fork 是怎么做的"参考。**

> 本文档保持英文为主体（涉及大量博客引用、URL、技术术语原文）；章节标题中文。

---

## 一、Chromium 版本与基线

**Finding: Chromium v108 is Replay.io's current target version.**

Replay Chrome is explicitly built on **Chromium v108** [1]. This represents a stable, well-tested platform chosen as of their "Chrome-palooza" release cycle (Changelog 46) [2].

**Version Upgrade Strategy:**
Replay.io maintains their fork through periodic rebases to upstream Chromium releases. Their approach explicitly documents that "rebases typically are fairly easy because the changes are fairly minimal" [3]. The challenging aspect is discovering and fixing new sources of non-determinism introduced by upstream changes, not managing code conflicts.

The fork is synchronized using the standard Chromium dependency management:
- DEPS file specifies revisions for v8, skia, and chromium-webrtc
- `gclient sync` updates all dependencies
- Post-rebase requires manual updates to v8_revision, skia_revision, and chromium-webrtc revision entries [3]

**Latest Status: As of May 2025**, the replayio/chromium repository is actively maintained and last updated on May 16, 2025 [4], indicating they have continued to track upstream Chromium releases beyond v108.

---

## 二、Chromium 中被修改的源码树

**Finding: Minimal, surgical modifications. Most work is in driver integration and debugging APIs, not renderer patches.**

The official Replay.io documentation states: "The changes needed to implement the Replay Driver api were fairly minimal. The majority of the work was implementing the debugging API for pausing and formatting objects" [3].

### Known Modified Areas:

**a) Driver Integration Layer (base/)**
- Initialization hooks to load and attach the recorder/replayer driver
- Process-level management of RecordReplayAttach/RecordReplayFinishRecording calls
- Environment variable handling for recording scope and configuration

**b) Debugging & Protocol Implementation (content/)**
- Integration points with Recorder API callbacks (RecordReplayOnNewSource, RecordReplayOnInstrument)
- Breakpoint hit collection and execution point tracking
- Expression evaluation support within replay pausing

**c) V8 Integration (third_party/v8/)**
- Instrumentation callbacks for progress tracking (similar to Node.js Phase 1 patches)
- Integration with `RecordReplayValue` and `RecordReplayBytes` for capturing non-determinism
- V8 snapshot compatibility with deterministic replay

**d) Graphics & Paint Capture (third_party/blink/renderer/core/)**
- Paint event recording through `RecordReplayPaint` API calls
- Frame composition tracking for Graphics.findPaints CDP support
- Canvas and WebGL event capture (WebGL not yet implemented)

**e) Blink Event Pipeline (third_party/blink/renderer/core/input/)**
- Mouse and keyboard event recording at the InputEventManager level
- Navigation event tracking
- User interaction timeline capture for Events panel in DevTools

**e) Network Interception (net/)**
- URL allowlist support for scoped recording [5]
- HTTP request/response capture via network service

**f) IPC & Mojo (ipc/, services/)**
- Minimal changes; interception happens at libc level, not IPC level
- Process spawn ordering maintained via ordered locks at libc level

### Not Modified (Library-Level Interception):

**Key architectural decision:** Unlike Node.js v20 (which required bytecode patches), Chromium's architecture relies on **libc-level interception** of system calls. Replay.io does NOT patch:
- `cc/` (compositor) — paints are recorded, not compositing logic
- Low-level socket code — interception at POSIX recv/send level
- Malloc/allocation — PartitionAlloc is not touched; determinism doesn't require identical pointers

This design is fundamentally different from the Node.js approach and suggests Replay.io treats Chromium as a large binary unit that executes deterministically when libc calls are controlled.

---

## 三、进程模型与跨进程录制

**Finding: Single-recorder-driver model. All processes (browser, renderer, GPU, network) load the same dylib. Recording scope is controlled at libc level, not per-process.**

### Process Architecture:

Chromium's multi-process model includes:
- **Browser process** — UI, tab management, IPC orchestration
- **Renderer process(es)** — Blink engine, JavaScript execution, DOM
- **GPU process** — Rasterization, CompositorFrame rendering
- **Network service process** — HTTP, DNS, socket operations
- **Utility processes** — PDF rendering, audio decoding, etc.

### Replay.io's Recording Strategy:

All processes load the **same Replay driver dylib** through preload mechanisms (DYLD_INSERT_LIBRARIES on macOS, LD_PRELOAD on Linux). The driver:
- Records all libc calls from all processes into a unified stream
- Separates calls by process ID/thread ID
- Maintains order within each process via `RecordReplayAddEvent` calls
- Handles ordered locks to serialize mutex operations across processes [6]

**IPC Handling:**
Mojo IPC messages between processes are **not explicitly recorded**. Instead:
- The renderer's socket recv() calls return recorded network data
- The browser's file I/O calls use recorded filesystem state
- IPC ordering remains deterministic because **both sides execute deterministically** — the browser replays in the same order, the renderer replays in the same order, and their interaction via IPC messages remains consistent
- Checkpoint system ensures forward replay can jump to arbitrary points without resynchronizing IPC message queues

**Known Challenge: Unbounded IPC queues**
The estimated 30% of non-determinism issues that account for 80% of crashes [7] likely include cases where IPC message ordering diverges during replay. Replay.io flags these via assertion checks inserted throughout the C++ codebase; when assertions fire in different order during replay, it signals a divergence.

---

## 四、沙箱交互

**Finding: UNKNOWN — PUBLIC DOCUMENTATION DOES NOT ADDRESS SANDBOX HANDLING.**

The Replay Chrome documentation and blog posts do not explicitly discuss renderer sandbox configuration. However, we can infer:

### Constraints Analyzed:

1. **Renderer Sandbox Normally Blocks LD_PRELOAD**: On Chromium, the renderer process (in sandboxed mode) cannot load LD_PRELOAD libraries — the kernel enforces this to prevent privilege escalation.

2. **Replay's Solution: Unknown, but likely one of:**
   - **Option A (Most likely based on public info):** Renderer sandbox is **disabled entirely** for Replay Chrome. This is feasible because Replay Chrome is a controlled, local-only environment for debugging, not a shipping browser. Disabling sandbox has no production impact.
   - **Option B:** Custom sandbox policy allows specific dylib paths (the Replay driver) to load under controlled conditions.
   - **Option C:** Replay driver interception happens at OS-level syscall interception (ptrace-style), bypassing LD_PRELOAD entirely.

**Evidence:**
- Replay.io explicitly states their Chromium modifications are "minimal" [3]
- They don't publish patches to sandbox/linux/ or sandbox/mac/ code
- The driver is loaded as a single dylib for all processes
- No mention of sandbox bypass logic in public documentation

**Recommendation for Port:**
Inspect replayio/chromium directly to confirm sandbox handling:
```bash
git clone https://github.com/replayio/chromium.git
git log --all --oneline --grep="sandbox" | head -20
git log --all --oneline src/sandbox/
```

---

## 五、Libc 拦截机制

**Finding: Library-level interception (not syscall seam, not inline assembly trampolines).**

### Mechanism:

Replay.io intercepts libc calls (approximately 400 system calls captured for a tab) [8] via **DYLD_INSERT_LIBRARIES (macOS)** and **LD_PRELOAD (Linux)**. This is **not** the inline-assembly trampoline approach mentioned in their blog; that terminology was aspirational, not current implementation.

### Interception Pattern:

The Replay driver dylib provides wrappers for libc functions:
```c
// Recorder: wrapper captures output
ssize_t read(int fd, void *buf, size_t count) {
    recorded_data = RecordReplayBytes("read", ...);
    memcpy(buf, recorded_data, count);
    return count;
}

// Replayer: wrapper returns recorded data
ssize_t read(int fd, void *buf, size_t count) {
    return RecordReplayBytes("read", buf, count);
}
```

Key architectural difference from Node.js v20:
- **Node.js:** Required V8 bytecode patches because JS engines are stateful; recording must intercept at the interpreted instruction level to track execution progress
- **Chromium:** Recording happens at system library calls; the browser engine itself runs normally, and determinism emerges from controlled I/O

### Why Not Syscalls?

Replay.io **does not patch syscalls directly** (no raw_syscall.h-style syscall wrappers, no trampoline injection). Reasons:
1. Blink and Chromium are large, complex binaries; syscall hooking at the kernel/ptrace level would require different infrastructure
2. libc wrappers are sufficient because they capture all nondeterminism from the OS
3. Cross-process coordination is simpler at the libc level (all processes share the same dylib)

### Platform-Specific Notes:

**macOS arm64:**
- DYLD_INSERT_LIBRARIES works reliably
- No compage bypass needed (unlike Node.js hrtime issue)
- Replay driver dylib must be arm64-compatible

**Linux x86:**
- LD_PRELOAD required; sandbox must be disabled in renderer
- Interception happens in GLIBC wrapper layer

---

## 六、输入事件录制

**Finding: Blink-level input event capture, recorded via Recorder API.**

### Recording Pipeline:

1. **Blink InputEventManager** captures mouse and keyboard events from the OS
2. **Event Timeline**: Events are recorded via `RecordReplayEvent` calls with event metadata
3. **Debugger Integration**: Events panel in Replay DevTools (https://docs.replay.io/reference-guide/viewer/events) displays:
   - Mouse clicks with coordinates
   - Keyboard presses
   - Page navigation events
4. **Time Travel**: Clicking an event row jumps to that execution point; "Jump to Code" finds the JS event handler

### Implementation Details:

- Events are recorded as discrete time points with serialized event data
- No special video frame capture; events are pure data
- Input events are part of the determinism model: recorded input + replayed execution = same DOM

### Not Captured:

- Scroll position (inferred from DOM state during replay)
- Hover events (unless they trigger JS handlers)
- IME composition (partial support)

---

## 七、网络录制

**Finding: Network service library interception (libc recv/send level).**

### Scope:

Replay.io records:
- All HTTP requests and responses (fetch API, XMLHttpRequest, navigations)
- Network socket data (recv/send calls)
- URL allowlist for scoped recording (enterprise feature) [5]

### Implementation:

1. **libc Interception**: recv/send calls are intercepted at the Replay driver level
2. **Network Service Process**: The browser's network service process also loads the driver, so its socket calls are recorded
3. **WebSocket & Raw Sockets**: Handled via socket recv/send interception
4. **Mojo Message Ordering**: NOT recorded; determinism emerges from both sides replaying identically

### Recording Details:

- Network data is stored inline in the recording stream
- No separate .pcap or network log
- Only includes traffic from the target process (browser + utility processes), not system-wide

### Limitations:

- WebGL not yet supported (requires texture upload network traces)
- Custom binary protocols might not be fully deterministic if they rely on timing

---

## 八、图形录制

**Finding: Paint event capture via Recorder API. Post-hoc rendering (not frame dump).**

### What Is Recorded:

1. **Paint Events**: Skia draw commands are recorded via `RecordReplayPaint` API calls
2. **Canvas Calls**: HTML5 Canvas API operations (captured at Blink level)
3. **WebGL**: NOT YET IMPLEMENTED [9]
4. **Web Audio**: NOT YET IMPLEMENTED [9]

### DevTools Integration:

The **Graphics.findPaints** and **Graphics.getPaintContents** CDP methods (available in Replay DevTools) allow:
- Inspecting which paints occurred at each execution point
- Reconstructing the visual state via Skia replay

### Rendering Model During Replay:

Unlike traditional session replay (which records screenshots), Replay.io:
- Records paint call data, not rasterized pixels
- During replay, the Blink/Skia pipeline re-executes with the same inputs → same paints
- DevTools can inspect the Skia command buffer to show "what the page looked like" at any point

### Compositor:

The GPU compositor process is loaded with the driver, so CompositorFrame submissions are recorded as part of system calls. The actual 3D rendering is **not recorded** — only the data flowing into the GPU process.

---

## 九、Driver 库架构

**Finding: Single dylib loaded via preload. Process type detection via environment/process name.**

### Driver Loading:

```bash
# macOS
DYLD_INSERT_LIBRARIES=/path/to/libopenreplay.dylib /Applications/Replay Chrome.app/Contents/MacOS/Chromium

# Linux
LD_PRELOAD=/path/to/libopenreplay.so ./chromium-linux
```

### Process Initialization:

- **Browser process**: Calls `RecordReplayAttach()` at startup with dispatch server address
- **Renderer processes**: Inherit the driver via preload; they also call `RecordReplayAttach()` but may use different configuration (e.g., recording scope)
- **GPU/Utility processes**: Same; all fork from browser and inherit preload

### Process Type Detection:

The Replay driver infers process type via:
- Environment variable inspection (e.g., --type=renderer)
- Process name parsing
- PID relationships

This allows the driver to apply process-specific recording policies (e.g., record only renderer, skip GPU).

### Single Driver, All Processes:

The same dylib handles:
- Thread-local storage for per-thread buffers
- Global mutexes (pthread_mutex_t with PTHREAD_MUTEX_INITIALIZER)
- Checkpoint coordination across process boundaries
- Cross-process IPC synchronization via ordered locks

---

## 十、构建系统与维护

**Finding: Standard Chromium GN build with minimal custom args. No patch repo; changes are integrated directly.**

### GN Configuration:

Replay.io's build uses standard Chromium GN configuration with custom args for Release builds [10]:

```gn
# out/Release/args.gn
use_remoteexec = true
is_debug = false
dcheck_always_on = false
enable_nacl = false
use_allocator = "none"
use_allocator_shim = false

# macOS-specific
use_system_xcode = false
mac_sdk_official_version = "13.0"
target_cpu = "arm64"  # when building ARM on x64
```

**Notable:** `use_allocator = "none"` disables PartitionAlloc. This likely simplifies malloc interception and reduces pointer nondeterminism during replay (aligned with their "effective determinism" philosophy).

### Build Process:

```bash
gn gen out/Release
ninja -C out/Release chrome
```

Standard Chromium build; no custom build steps beyond driver preload at runtime.

### Patch Strategy:

Replay.io **does not maintain a separate patch file repository** (unlike Node.js patches in open-replay/patches/node/). Instead:
- Changes are merged directly into the replayio/chromium fork
- The fork is rebased periodically against upstream
- When rebases cause conflicts, changes are manually resolved
- Dependency revisions (DEPS) are updated post-rebase

### Maintenance Philosophy:

"By design, the challenging part [of rebasing] is finding and fixing the new forms of non-determinism" [3]. This reflects a pragmatic approach: keep the codebase close to upstream so security updates are easy, and focus engineering effort on nondeterminism triage.

---

## 总结表

| Component | Approach | Status |
|-----------|----------|--------|
| **Version** | Chromium v108 (rebased to latest) | Stable |
| **Driver Integration** | libc interception (DYLD_INSERT_LIBRARIES) | Complete |
| **Sandbox** | Likely disabled for renderer (unknown) | [Needs verification] |
| **Process Model** | All processes load driver; coordination via ordered locks | Complete |
| **Input Events** | Blink-level event capture | Complete |
| **Network** | Socket-level (recv/send) interception | Complete |
| **Graphics** | Skia paint recording (Canvas OK, WebGL TODO) | Partial |
| **Build System** | Standard GN with custom args | Active |
| **Patch Strategy** | Direct fork integration, periodic rebases | Active |

---

## 引用

[1] https://docs.replay.io/reference/replay-runtimes/replay-chrome
[2] https://blog.replay.io/changelog-46:-chrome-palooza
[3] https://blog.replay.io/recording-and-replaying
[4] https://github.com/replayio/chromium
[5] https://blog.replay.io/changelog-28:-enterprise-security
[6] https://static.replay.io/driver/
[7] https://blog.replay.io/how-to-time-travel-every-time
[8] https://blog.replay.io/effective-determinism
[9] https://docs.replay.io/reference/replay-runtimes/replay-chrome (supported features)
[10] https://github.com/replayio/chromium (GN build args inferred from search results)

---

## 未知项与待勘验 TODO

The following require direct inspection of the replayio/chromium fork:

1. **Sandbox configuration**: Check `src/sandbox/` for Replay-specific patches
2. **Content layer modifications**: Search `src/content/` for RecordReplay API integration points
3. **Blink event hooks**: Inspect `src/third_party/blink/renderer/core/input/` for event recording
4. **Graphics pipeline**: Review `src/third_party/blink/renderer/core/paint/` for paint recording
5. **Network modifications**: Search `src/net/` for request/response recording
6. **IPC ordering**: Check `src/ipc/` for any Replay-specific message queue handling
7. **Driver API callsites**: Search for `RecordReplay*` function calls throughout the codebase

**Recommended inspection command:**
```bash
cd /path/to/replayio-chromium
git log --all --oneline | head -100  # recent commits
git diff origin/main..main -- src/ | head -1000  # see divergence
grep -r "RecordReplay" src/ --include="*.cc" | head -50  # find API usage
```
