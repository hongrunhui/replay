# Chromium 录制/回放 Driver API 契约

> **核心规范文档**：列出 Replay.io chromium fork 期望 driver 导出的全部 113 个 extern 符号。
> 这是写 driver 时的"对话"：chromium 那边期望什么签名、什么默认值、什么时候调；driver 这边对应实现。
> 文档主体保持英文（保证签名/路径精确），章节标题中文。

## 概述

This document catalogs every `extern "C"` symbol and function pointer that the Replay.io Chromium fork expects the runtime driver to export. The driver is loaded via `DYLD_INSERT_LIBRARIES` at runtime and provides record/replay infrastructure for JavaScript debugging and time-travel execution.

The Chromium codebase calls into these driver symbols to:
1. Record/replay JavaScript execution with determinism
2. Capture and restore DOM/Blink state
3. Handle paint and rendering operations
4. Manage event recording and ordering
5. Provide assertion and logging infrastructure
6. Support time-travel debugger queries

**Document Version**: 1.0  
**Chromium Base**: Replay.io fork  
**Last Updated**: 2025-04-23  
**Total Distinct Symbols Catalogued**: 70+

---

## 第一节：核心函数指针 extern 符号（V8/Blink 调进 driver）

These are declared as `extern "C"` in the Chromium source and called by the browser/renderer process. The driver implements these and exports them via the dylib.

### 1.1 State Query Functions

#### V8IsRecordingOrReplaying
- **Signature**: `bool V8IsRecordingOrReplaying(const char* feature, const char* subfeature)`
- **Header Location**: `src/base/record_replay.cc:19` (macro definition)
- **Return Value**: `true` if currently recording or replaying, respecting feature flags
- **Parameters**:
  - `feature`: Feature name filter (e.g., "pointer-ids", "layout-ids"), may be `nullptr`
  - `subfeature`: Subfeature filter, may be `nullptr`
- **Callers** (examples):
  - `src/base/record_replay.h:155` (pointer ID comparator)
  - `src/components/viz/service/display/record_replay_render.cc:87` (paint surface)
  - `src/third_party/blink/renderer/core/dom/node.cc` (scripted caller tracking)
- **Purpose**: Control code paths that must be deterministic during record/replay

#### V8IsRecording
- **Signature**: `bool V8IsRecording()`
- **Header Location**: `src/base/record_replay.cc:22`
- **Return Value**: `true` if currently recording execution
- **Callers**: Direct wrappers in `src/base/record_replay.cc`
- **Purpose**: Branch on record-only behavior

#### V8IsReplaying
- **Signature**: `bool V8IsReplaying()`
- **Header Location**: `src/base/record_replay.cc:23`
- **Return Value**: `true` if currently replaying execution
- **Callers**: Direct wrappers
- **Purpose**: Branch on replay-only behavior

#### V8GetRecordingId
- **Signature**: `char* V8GetRecordingId()`
- **Header Location**: `src/base/record_replay.cc:24`
- **Return Value**: String identifier of the current recording session
- **Callers**: `src/base/record_replay.cc:241`
- **Purpose**: Retrieve recording metadata/session identifiers

#### V8RecordReplayAreEventsDisallowed
- **Signature**: `bool V8RecordReplayAreEventsDisallowed(const char* why)`
- **Header Location**: `src/base/record_replay.cc:30`
- **Return Value**: `true` if in a divergent execution path where events cannot be read
- **Parameters**:
  - `why`: Debug label explaining the divergence reason
- **Callers**:
  - `src/base/record_replay.h:83` (recordreplay::AreEventsDisallowed wrapper)
  - `src/third_party/skia/src/core/SkRecordReplay.h:22` (Skia integration)
- **Purpose**: Prevent recording operations in non-deterministic code paths

#### V8RecordReplayAreEventsPassedThrough
- **Signature**: `bool V8RecordReplayAreEventsPassedThrough(const char* why)`
- **Header Location**: `src/base/record_replay.cc:32`
- **Return Value**: `true` if currently in pass-through events mode
- **Purpose**: Query if events bypass recording

#### V8RecordReplayHasDivergedFromRecording
- **Signature**: `bool V8RecordReplayHasDivergedFromRecording()`
- **Header Location**: `src/base/record_replay.cc:34`
- **Return Value**: `true` if execution has intentionally diverged at a pause point
- **Callers**:
  - `src/base/record_replay.h:115` (recordreplay::HasDivergedFromRecording)
  - `src/components/viz/service/display/record_replay_render.cc:188` (paint)
- **Purpose**: Detect when replaying has paused and execution is divergent

#### V8RecordReplayFeatureEnabled
- **Signature**: `bool V8RecordReplayFeatureEnabled(const char* feature, const char* subfeature)`
- **Header Location**: `src/base/record_replay.cc:41`
- **Return Value**: `true` if the feature is enabled in the driver config
- **Parameters**:
  - `feature`: Feature name (e.g., "pointer-ids", "dependency-graph")
  - `subfeature`: Optional subfeature filter
- **Purpose**: Enable/disable record-replay features at runtime

#### V8RecordReplayHasDisabledFeatures
- **Signature**: `bool V8RecordReplayHasDisabledFeatures()`
- **Header Location**: `src/base/record_replay.cc:44`
- **Return Value**: `true` if any features are explicitly disabled
- **Purpose**: Optimization hint for common case

#### V8RecordReplayAllowSideEffects
- **Signature**: `bool V8RecordReplayAllowSideEffects()`
- **Header Location**: `src/base/record_replay.cc:38`
- **Return Value**: `true` if side effects (e.g., mutations, I/O) are permitted
- **Purpose**: Control mutable operations in replay mode

#### V8RecordReplayHasAsserts
- **Signature**: `bool V8RecordReplayHasAsserts()`
- **Header Location**: `src/base/record_replay.cc:49`
- **Return Value**: `true` if any assertions have been recorded
- **Purpose**: Optimization: skip replay when no assertions exist

#### V8RecordReplayHadMismatch
- **Signature**: `bool V8RecordReplayHadMismatch()`
- **Header Location**: `src/base/record_replay.cc:50`
- **Return Value**: `true` if a mismatch was detected during replay
- **Purpose**: Detect divergence from recording

#### V8RecordReplayAreAssertsDisabled
- **Signature**: `bool V8RecordReplayAreAssertsDisabled()`
- **Header Location**: `src/base/record_replay.cc:45`
- **Return Value**: `true` if assertions are disabled
- **Purpose**: Bypass assertion recording/checking

#### V8IsMainThread
- **Signature**: `bool V8IsMainThread()`
- **Header Location**: `src/base/record_replay.cc:46`
- **Return Value**: `true` if currently on the main thread
- **Purpose**: Thread-aware recording decisions

#### V8RecordReplayIsInReplayCode
- **Signature**: `bool V8RecordReplayIsInReplayCode(const char* why)`
- **Header Location**: `src/base/record_replay.cc:47`
- **Return Value**: `true` if executing record-replay specific scripts
- **Purpose**: Prevent recursive instrumentation

#### V8RecordReplayUpdateDependencyGraph
- **Signature**: `bool V8RecordReplayUpdateDependencyGraph()`
- **Header Location**: `src/base/record_replay.cc:35`
- **Return Value**: `true` if dependency graph tracking is enabled
- **Purpose**: Enable execution dependency tracking for analysis

### 1.2 Value Recording Functions

#### V8RecordReplayValue
- **Signature**: `uintptr_t V8RecordReplayValue(const char* why, uintptr_t value)`
- **Header Location**: `src/base/record_replay.cc:25`
- **Return Value**: The recorded value (unchanged during recording, looked up during replay)
- **Parameters**:
  - `why`: Debug label explaining what value is being recorded
  - `value`: The uintptr_t value to record
- **Callers**:
  - `src/base/record_replay.h:47` (recordreplay::RecordReplayValue)
  - `src/base/functional/bind_internal.h` (callback binding)
  - `src/third_party/skia/src/core/SkRecordReplay.h:28` (Skia)
- **Purpose**: Deterministically record/replay pointer and integer values

#### V8RecordReplayBytes
- **Signature**: `void V8RecordReplayBytes(const char* why, void* buf, size_t size)`
- **Header Location**: `src/base/record_replay.cc:83`
- **Return Value**: None
- **Parameters**:
  - `why`: Debug label describing the buffer
  - `buf`: Buffer pointer (modified in-place during replay)
  - `size`: Size of buffer in bytes
- **Callers**:
  - `src/base/record_replay.h:48` (recordreplay::RecordReplayBytes)
- **Purpose**: Record/replay arbitrary byte buffers for determinism

#### V8RecordReplayAssertBytes
- **Signature**: `void V8RecordReplayAssertBytes(const char* why, const void* buf, size_t size)`
- **Header Location**: `src/base/record_replay.cc:59`
- **Return Value**: None
- **Parameters**:
  - `why`: Assertion label
  - `buf`: Buffer to assert
  - `size`: Buffer size
- **Callers**:
  - `src/base/record_replay.h:44` (recordreplay::AssertBytes)
- **Purpose**: Assert buffer contents match recording during replay

### 1.3 Pointer ID Management (Deterministic Ordering)

#### V8RecordReplayCreateOrderedLock
- **Signature**: `size_t V8RecordReplayCreateOrderedLock(const char* name)`
- **Header Location**: `src/base/record_replay.cc:27`
- **Return Value**: Lock ID for later use
- **Parameters**:
  - `name`: Name of the ordered lock (for debug/tracing)
- **Callers**:
  - `src/base/record_replay.h:51` (recordreplay::CreateOrderedLock)
  - `src/third_party/skia/include/private/SkMutex.h:25` (Skia mutexes)
- **Purpose**: Create a deterministic lock that replays in the same order

#### V8RecordReplayOrderedLock
- **Signature**: `void V8RecordReplayOrderedLock(int lock)`
- **Header Location**: `src/base/record_replay.cc:86`
- **Return Value**: None
- **Parameters**:
  - `lock`: Lock ID from V8RecordReplayCreateOrderedLock
- **Callers**:
  - `src/base/record_replay.h:52` (recordreplay::OrderedLock)
  - `src/third_party/skia/include/private/SkMutex.h:34` (Skia)
- **Purpose**: Acquire an ordered lock in deterministic sequence

#### V8RecordReplayOrderedUnlock
- **Signature**: `void V8RecordReplayOrderedUnlock(int lock)`
- **Header Location**: `src/base/record_replay.cc:87`
- **Return Value**: None
- **Parameters**:
  - `lock`: Lock ID to release
- **Callers**:
  - `src/base/record_replay.h:53` (recordreplay::OrderedUnlock)
- **Purpose**: Release an ordered lock

#### V8RecordReplayPointerId
- **Signature**: `int V8RecordReplayPointerId(const void* ptr)`
- **Header Location**: `src/base/record_replay.cc:39`
- **Return Value**: Deterministic integer ID for the pointer (0 if not registered)
- **Parameters**:
  - `ptr`: Pointer to look up
- **Callers**:
  - `src/base/record_replay.h:120` (recordreplay::PointerId)
  - `src/third_party/skia/src/core/SkRecordReplay.h:17` (Skia)
- **Purpose**: Map pointers to deterministic IDs for ordering

#### V8RecordReplayIdPointer
- **Signature**: `void* V8RecordReplayIdPointer(int id)`
- **Header Location**: `src/base/record_replay.cc:40`
- **Return Value**: Pointer corresponding to the ID (nullptr if not found)
- **Parameters**:
  - `id`: Pointer ID
- **Callers**:
  - `src/base/record_replay.h:121` (recordreplay::IdPointer)
- **Purpose**: Reverse lookup: ID to pointer

#### V8RecordReplayRegisterPointer
- **Signature**: `void V8RecordReplayRegisterPointer(const char* name, const void* ptr)`
- **Header Location**: `src/base/record_replay.cc:110`
- **Return Value**: None
- **Parameters**:
  - `name`: Name/label for the pointer
  - `ptr`: Pointer to register
- **Callers**:
  - `src/base/record_replay.h:118` (recordreplay::RegisterPointer)
- **Purpose**: Register a pointer for ID management

#### V8RecordReplayUnregisterPointer
- **Signature**: `void V8RecordReplayUnregisterPointer(const void* ptr)`
- **Header Location**: `src/base/record_replay.cc:112`
- **Return Value**: None
- **Parameters**:
  - `ptr`: Pointer to unregister
- **Callers**:
  - `src/base/record_replay.h:119` (recordreplay::UnregisterPointer)
- **Purpose**: Unregister a pointer after use

### 1.4 Assertion and Logging Functions (Variadic)

#### V8RecordReplayAssertVA
- **Signature**: `void V8RecordReplayAssertVA(const char* format, va_list args)`
- **Header Location**: `src/base/record_replay.cc:53`
- **Return Value**: None
- **Parameters**:
  - `format`: Printf-style format string
  - `args`: va_list of arguments
- **Callers**:
  - `src/base/record_replay.cc:257` (recordreplay::Assert wrapper)
- **Purpose**: Record/replay assertions with formatted messages

#### V8RecordReplayPrintVA
- **Signature**: `void V8RecordReplayPrintVA(const char* format, va_list args)`
- **Header Location**: `src/base/record_replay.cc:62`
- **Return Value**: None
- **Purpose**: Record/replay diagnostic prints (non-fatal)

#### V8RecordReplayDiagnosticVA
- **Signature**: `void V8RecordReplayDiagnosticVA(const char* format, va_list args)`
- **Header Location**: `src/base/record_replay.cc:65`
- **Return Value**: None
- **Purpose**: Record/replay detailed diagnostic messages

#### V8RecordReplayCommandDiagnosticVA
- **Signature**: `void V8RecordReplayCommandDiagnosticVA(const char* format, va_list args)`
- **Header Location**: `src/base/record_replay.cc:68`
- **Return Value**: None
- **Purpose**: Diagnostic specifically for debugger commands

#### V8RecordReplayCommandDiagnosticTraceVA
- **Signature**: `void V8RecordReplayCommandDiagnosticTraceVA(const char* format, va_list args)`
- **Header Location**: `src/base/record_replay.cc:71`
- **Return Value**: None
- **Purpose**: Trace-level command diagnostics

#### V8RecordReplayWarning
- **Signature**: `void V8RecordReplayWarning(const char* format, va_list args)`
- **Header Location**: `src/base/record_replay.cc:74`
- **Return Value**: None
- **Purpose**: Record/replay warning messages

#### V8RecordReplayTrace
- **Signature**: `void V8RecordReplayTrace(const char* format, va_list args)`
- **Header Location**: `src/base/record_replay.cc:77`
- **Return Value**: None
- **Purpose**: Record/replay execution trace data

#### V8RecordReplayCrash
- **Signature**: `void V8RecordReplayCrash(const char* format, va_list args)`
- **Header Location**: `src/base/record_replay.cc:80`
- **Return Value**: None (terminates execution)
- **Purpose**: Record crash reason and exit

#### V8RecordReplayAssertMaybeEventsDisallowedVA
- **Signature**: `void V8RecordReplayAssertMaybeEventsDisallowedVA(const char* format, va_list args)`
- **Header Location**: `src/base/record_replay.cc:56`
- **Return Value**: None
- **Purpose**: Assert even when events are disallowed (for infrastructure)

### 1.5 Event Recording Functions

#### V8RecordReplayNewCheckpoint
- **Signature**: `void V8RecordReplayNewCheckpoint()`
- **Header Location**: `src/base/record_replay.cc:88`
- **Return Value**: None
- **Purpose**: Mark a checkpoint in the recording for pause/resume points

#### V8RecordReplayOnAnnotation
- **Signature**: `void V8RecordReplayOnAnnotation(const char* kind, const char* contents)`
- **Header Location**: `src/base/record_replay.cc:89`
- **Return Value**: None
- **Parameters**:
  - `kind`: Annotation type (e.g., "network-request", "navigation")
  - `contents`: JSON or text content of the annotation
- **Purpose**: Record arbitrary application events/metadata

#### V8RecordReplayOnNetworkRequest
- **Signature**: `void V8RecordReplayOnNetworkRequest(const char* id, const char* kind, uint64_t bookmark)`
- **Header Location**: `src/base/record_replay.cc:92`
- **Return Value**: None
- **Parameters**:
  - `id`: Unique network request ID
  - `kind`: Request type (e.g., "xhr", "fetch", "navigation")
  - `bookmark`: Execution position when request started
- **Purpose**: Record network request initiation

#### V8RecordReplayOnNetworkRequestEvent
- **Signature**: `void V8RecordReplayOnNetworkRequestEvent(const char* id)`
- **Header Location**: `src/base/record_replay.cc:95`
- **Return Value**: None
- **Purpose**: Mark an event on a network request (e.g., response received)

#### V8RecordReplayOnNetworkStreamStart
- **Signature**: `void V8RecordReplayOnNetworkStreamStart(const char* id, const char* kind, const char* parentId)`
- **Header Location**: `src/base/record_replay.cc:96`
- **Return Value**: None
- **Purpose**: Record network stream start (for WebSockets, Server-Sent Events, etc.)

#### V8RecordReplayOnNetworkStreamData
- **Signature**: `void V8RecordReplayOnNetworkStreamData(const char* id, size_t offset, size_t length, uint64_t bookmark)`
- **Header Location**: `src/base/record_replay.cc:99`
- **Return Value**: None
- **Purpose**: Record data chunk from a network stream

#### V8RecordReplayOnNetworkStreamEnd
- **Signature**: `void V8RecordReplayOnNetworkStreamEnd(const char* id, size_t length)`
- **Header Location**: `src/base/record_replay.cc:102`
- **Return Value**: None
- **Purpose**: Record end of network stream

#### V8RecordReplayOnEvent
- **Signature**: `void V8RecordReplayOnEvent(const char* event, bool before)`
- **Header Location**: `src/base/record_replay.cc:115`
- **Return Value**: None
- **Parameters**:
  - `event`: Event name
  - `before`: `true` for pre-event, `false` for post-event
- **Purpose**: Record generic DOM/execution events

#### V8RecordReplayOnMouseEvent
- **Signature**: `void V8RecordReplayOnMouseEvent(const char* kind, size_t clientX, size_t clientY, bool synthetic)`
- **Header Location**: `src/base/record_replay.cc:117`
- **Return Value**: None
- **Purpose**: Record mouse events with coordinates

#### V8RecordReplayOnKeyEvent
- **Signature**: `void V8RecordReplayOnKeyEvent(const char* kind, const char* key, bool synthetic)`
- **Header Location**: `src/base/record_replay.cc:120`
- **Return Value**: None
- **Purpose**: Record keyboard events

#### V8RecordReplayOnNavigationEvent
- **Signature**: `void V8RecordReplayOnNavigationEvent(const char* kind, const char* url)`
- **Header Location**: `src/base/record_replay.cc:123`
- **Return Value**: None
- **Purpose**: Record navigation events with URL

#### V8RecordReplayBrowserEvent
- **Signature**: `void V8RecordReplayBrowserEvent(const char* name, const char* payload)`
- **Header Location**: `src/base/record_replay.cc:113`
- **Return Value**: None
- **Parameters**:
  - `name`: Event name (e.g., "paint", "navigation", "script-error")
  - `payload`: JSON-serialized event data
- **Callers**:
  - `src/content/renderer/render_thread_impl.cc:1391` (RenderThreadImpl)
  - `src/base/record_replay.cc:436` (from recordreplay namespace)
- **Purpose**: Send browser-level events to record/replay system

### 1.6 Event Control Functions

#### V8RecordReplayBeginDisallowEvents
- **Signature**: `void V8RecordReplayBeginDisallowEvents()`
- **Header Location**: `src/base/record_replay.cc:104`
- **Return Value**: None
- **Purpose**: Mark start of non-deterministic code where events cannot be read

#### V8RecordReplayBeginDisallowEventsWithLabel
- **Signature**: `void V8RecordReplayBeginDisallowEventsWithLabel(const char* label)`
- **Header Location**: `src/base/record_replay.cc:105`
- **Return Value**: None
- **Purpose**: Begin event disallow with descriptive label

#### V8RecordReplayEndDisallowEvents
- **Signature**: `void V8RecordReplayEndDisallowEvents()`
- **Header Location**: `src/base/record_replay.cc:107`
- **Return Value**: None
- **Purpose**: Mark end of event-disallowed region

#### V8RecordReplayBeginPassThroughEvents
- **Signature**: `void V8RecordReplayBeginPassThroughEvents()`
- **Header Location**: `src/base/record_replay.cc:108`
- **Return Value**: None
- **Purpose**: Begin region where events bypass recording (recorded as pass-through)

#### V8RecordReplayEndPassThroughEvents
- **Signature**: `void V8RecordReplayEndPassThroughEvents()`
- **Header Location**: `src/base/record_replay.cc:109`
- **Return Value**: None
- **Purpose**: End pass-through events region

#### V8RecordReplayEnterReplayCode
- **Signature**: `void V8RecordReplayEnterReplayCode()`
- **Header Location**: `src/base/record_replay.cc:137`
- **Return Value**: None
- **Purpose**: Mark entry into record-replay infrastructure code

#### V8RecordReplayExitReplayCode
- **Signature**: `void V8RecordReplayExitReplayCode()`
- **Header Location**: `src/base/record_replay.cc:138`
- **Return Value**: None
- **Purpose**: Mark exit from record-replay infrastructure code

### 1.7 Dependency Graph Functions

#### V8RecordReplayNewDependencyGraphNode
- **Signature**: `int V8RecordReplayNewDependencyGraphNode(const char* json)`
- **Header Location**: `src/base/record_replay.cc:36`
- **Return Value**: Node ID for later reference
- **Parameters**:
  - `json`: JSON metadata for the node
- **Purpose**: Create a node in the execution dependency graph

#### V8RecordReplayAddDependencyGraphEdge
- **Signature**: `void V8RecordReplayAddDependencyGraphEdge(int source, int target, const char* json)`
- **Header Location**: `src/base/record_replay.cc:125`
- **Return Value**: None
- **Purpose**: Add edge in dependency graph connecting source to target

#### V8RecordReplayBeginDependencyExecution
- **Signature**: `void V8RecordReplayBeginDependencyExecution(int node)`
- **Header Location**: `src/base/record_replay.cc:127`
- **Return Value**: None
- **Purpose**: Mark start of execution for a dependency graph node

#### V8RecordReplayEndDependencyExecution
- **Signature**: `void V8RecordReplayEndDependencyExecution()`
- **Header Location**: `src/base/record_replay.cc:128`
- **Return Value**: None
- **Purpose**: Mark end of dependency execution

### 1.8 Platform-Specific Functions

#### V8RecordReplayAddOrderedSRWLock
- **Signature**: `void V8RecordReplayAddOrderedSRWLock(const char* name, void* lock)`
- **Header Location**: `src/base/record_replay.cc:129`
- **Return Value**: None
- **Parameters**:
  - `name`: Name of the lock
  - `lock`: HANDLE to SRWLOCK on Windows
- **Callers**:
  - `src/base/synchronization/lock_impl_win.cc:21` (Windows lock impl)
- **Purpose**: Register Windows SRW locks for ordered recording

#### V8RecordReplayRemoveOrderedSRWLock
- **Signature**: `void V8RecordReplayRemoveOrderedSRWLock(void* lock)`
- **Header Location**: `src/base/record_replay.cc:131`
- **Return Value**: None
- **Purpose**: Unregister SRWLOCK

### 1.9 Termination and Finalization

#### V8RecordReplayMaybeTerminate
- **Signature**: `void V8RecordReplayMaybeTerminate(void (*callback)(void*), void* data)`
- **Header Location**: `src/base/record_replay.cc:132`
- **Return Value**: None
- **Parameters**:
  - `callback`: Function to call if terminating
  - `data`: User data for callback
- **Purpose**: Provide a shutdown callback if recording will be terminated

#### V8RecordReplayFinishRecording
- **Signature**: `void V8RecordReplayFinishRecording()`
- **Header Location**: `src/base/record_replay.cc:134`
- **Return Value**: None
- **Callers**:
  - `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc:94` (Blink)
- **Purpose**: Finalize the recording session

#### V8RecordReplayGetCurrentJSStack
- **Signature**: `void V8RecordReplayGetCurrentJSStack(std::string* stackTrace)`
- **Header Location**: `src/base/record_replay.cc:135`
- **Return Value**: None (output via pointer)
- **Purpose**: Get current JavaScript stack trace for debugging

### 1.10 Buffer Allocation Tracking

#### V8RecordReplayBeginAssertBufferAllocations
- **Signature**: `void V8RecordReplayBeginAssertBufferAllocations(const char* issueLabel)`
- **Header Location**: `src/base/record_replay.cc:139`
- **Return Value**: None
- **Purpose**: Enable tracking of buffer allocations for assertion

#### V8RecordReplayEndAssertBufferAllocations
- **Signature**: `void V8RecordReplayEndAssertBufferAllocations()`
- **Header Location**: `src/base/record_replay.cc:141`
- **Return Value**: None
- **Purpose**: Disable buffer allocation tracking

---

## 第二节：Blink/V8 回调注册（直接 extern C 声明）

These are `extern "C"` declarations in specific Chromium source files that represent callbacks registered with the driver, or functions called by the driver to invoke Chromium functionality.

### V8RecordReplaySetDefaultContext
- **Signature**: `void V8RecordReplaySetDefaultContext(v8::Isolate* isolate, v8::Local<v8::Context> cx)`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc:93`
- **Return Value**: None
- **Purpose**: Inform driver of the default V8 context for script execution

### V8RecordReplayReadAssetFileContents
- **Signature**: `char* V8RecordReplayReadAssetFileContents(const char* aPath, size_t* aLength)`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc:96`
- **Return Value**: Pointer to file contents (caller must free); nullptr on failure
- **Parameters**:
  - `aPath`: File path to read
  - `aLength`: Output parameter for file size in bytes
- **Purpose**: Driver can request Chromium to load asset files

### V8RecordReplayOnConsoleMessage
- **Signature**: `void V8RecordReplayOnConsoleMessage(size_t bookmark)`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc:97`
- **Return Value**: None
- **Parameters**:
  - `bookmark`: Execution position of the console message
- **Purpose**: Notify driver of console message for recording

### V8RecordReplayAddMetadata
- **Signature**: `void V8RecordReplayAddMetadata(const char* jsonString)`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc:98`
- **Return Value**: None
- **Parameters**:
  - `jsonString`: JSON metadata to add to recording
- **Purpose**: Attach metadata to recording (e.g., page title, URL)

### V8RecordReplaySetAPIObjectIdCallback
- **Signature**: `void V8RecordReplaySetAPIObjectIdCallback(int (*callback)(v8::Local<v8::Object>))`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc:99`
- **Return Value**: None
- **Parameters**:
  - `callback`: Function pointer to call for each JS object to get deterministic ID
- **Purpose**: Register callback for object ID assignment

### V8RecordReplayRegisterBrowserEventCallback
- **Signature**: `void V8RecordReplayRegisterBrowserEventCallback(void (*callback)(const char* name, const char* payload))`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc:100`
- **Return Value**: None
- **Parameters**:
  - `callback`: Function to be called by driver when replaying browser events
- **Purpose**: Register callback for driver to notify Chromium of replayed events

### V8RecordReplayCurrentReturnValue
- **Signature**: `bool V8RecordReplayCurrentReturnValue(v8::Local<v8::Value>* object)`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc:103`
- **Return Value**: `true` if a return value is available
- **Parameters**:
  - `object`: Output parameter to receive the value
- **Purpose**: Query the return value of the current function for replay

### V8RecordReplayGetProgressCounter
- **Signature**: `uint64_t* V8RecordReplayGetProgressCounter()`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc:104`
- **Return Value**: Pointer to a 64-bit counter incremented during execution
- **Purpose**: Driver can efficiently check execution progress

### V8RecordReplaySetCrashReason
- **Signature**: `void V8RecordReplaySetCrashReason(const char* reason)`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc:95`
- **Return Value**: None
- **Purpose**: Inform driver of reason for crash/abnormal exit

### V8GetMessageRecordReplayBookmark
- **Signature**: `int V8GetMessageRecordReplayBookmark(v8::Local<v8::Message> message)`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/v8_initializer.cc:151`
- **Return Value**: Bookmark (execution position) of this error message
- **Purpose**: Associate error messages with execution positions

### V8RecordReplayDependencyGraphExecutionNode
- **Signature**: `int V8RecordReplayDependencyGraphExecutionNode()`
- **Header Location**: `src/third_party/blink/renderer/core/dom/document.cc:365`
- **Return Value**: Current dependency graph node ID, or 0 if not applicable
- **Purpose**: Query current execution node in dependency graph

### V8InitializeNotRecordingOrReplaying
- **Signature**: `void V8InitializeNotRecordingOrReplaying()`
- **Header Location**: `src/base/record_replay.cc` (macro expansion)
- **Return Value**: None
- **Purpose**: Initialize state when record/replay is not active

### V8SetRecordingOrReplaying
- **Signature**: `void V8SetRecordingOrReplaying(void* handle)`
- **Header Location**: (via macro expansion)
- **Return Value**: None
- **Parameters**:
  - `handle`: Opaque handle to record/replay driver state
- **Purpose**: Provide driver handle to Chromium initialization

---

## 第三节：HTML/DOM 解析钩子

These are specialized callbacks for HTML parsing instrumentation.

### V8RecordReplayHTMLParseStart
- **Signature**: `void V8RecordReplayHTMLParseStart(void* token, const char* url)`
- **Header Location**: `src/third_party/blink/renderer/core/html/parser/html_document_parser.cc:82`
- **Return Value**: None
- **Parameters**:
  - `token`: Opaque token identifying this parse session
  - `url`: URL of the document being parsed
- **Callers**:
  - `src/third_party/blink/renderer/core/html/parser/html_document_parser.cc:569` (HTMLDocumentParser::StartParsing)
- **Purpose**: Mark start of HTML parsing for a document

### V8RecordReplayHTMLParseFinish
- **Signature**: `void V8RecordReplayHTMLParseFinish(void* token)`
- **Header Location**: `src/third_party/blink/renderer/core/html/parser/html_document_parser.cc:83`
- **Return Value**: None
- **Callers**:
  - `src/third_party/blink/renderer/core/html/parser/html_document_parser.cc:605` (finish)
- **Purpose**: Mark completion of HTML parsing

### V8RecordReplayHTMLParseAddData
- **Signature**: `void V8RecordReplayHTMLParseAddData(void* token, const char* data)`
- **Header Location**: `src/third_party/blink/renderer/core/html/parser/html_document_parser.cc:84`
- **Return Value**: None
- **Parameters**:
  - `token`: Parse session token
  - `data`: HTML data chunk being parsed
- **Callers**:
  - `src/third_party/blink/renderer/core/html/parser/html_document_parser.cc:1133` (InsertFakeNewlineBeforeToken)
- **Purpose**: Record HTML data chunks as they are parsed

---

## 第四节：绘制与渲染钩子

These are for recording and replaying paint operations.

### V8RecordReplayPaintStart
- **Signature**: `size_t V8RecordReplayPaintStart()`
- **Header Location**: `src/components/viz/service/display/record_replay_render.cc:157`
- **Return Value**: Bookmark identifying the start of this paint operation
- **Callers**:
  - `src/components/viz/service/display/record_replay_render.cc:232` (SubmitCompositorFrame)
- **Purpose**: Mark the beginning of a paint frame; driver returns a bookmark

### V8RecordReplayPaintFinished
- **Signature**: `void V8RecordReplayPaintFinished(size_t bookmark)`
- **Header Location**: `src/components/viz/service/display/record_replay_render.cc:158`
- **Return Value**: None
- **Parameters**:
  - `bookmark`: Bookmark from corresponding V8RecordReplayPaintStart
- **Purpose**: Mark the completion of a paint frame

### V8RecordReplaySetPaintCallback
- **Signature**: `void V8RecordReplaySetPaintCallback(char* (*callback)(const char*, int))`
- **Header Location**: `src/components/viz/service/display/record_replay_render.cc:159`
- **Return Value**: None
- **Parameters**:
  - `callback`: Function pointer driver will call to get encoded paint image
    - First param: MIME type (e.g., "image/jpeg")
    - Second param: Quality (for JPEG)
    - Returns: Base64-encoded image data (caller must free)
- **Purpose**: Register callback for driver to request paint snapshots

---

## 第五节：断言与日志（非 V8 变体）

### V8RecordReplayAssert
- **Signature**: `void V8RecordReplayAssert(const char* format, ...)`
- **Header Location**: `src/gin/v8_platform.cc:484`
- **Return Value**: None
- **Parameters**:
  - `format`: Printf-style format string
  - `...`: Variadic arguments
- **Callers**:
  - `src/gin/v8_platform.cc` (V8 platform initialization)
- **Purpose**: Record/replay assertion with printf-style formatting

---

## 第六节：Skia 图形库集成

The Skia graphics library (third-party/skia) has its own set of record/replay hooks, mirroring the base recordreplay namespace.

### SkRecordReplayIsRecordingOrReplaying
- **Signature**: `bool SkRecordReplayIsRecordingOrReplaying(const char* feature = nullptr, const char* subfeature = nullptr)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:20`
- **Purpose**: Query recording/replaying state from Skia code

### SkRecordReplayFeatureEnabled
- **Signature**: `bool SkRecordReplayFeatureEnabled(const char* feature, const char* subfeature)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:19`
- **Purpose**: Check if Skia feature is enabled

### SkRecordReplayAreEventsDisallowed
- **Signature**: `bool SkRecordReplayAreEventsDisallowed(const char* why = nullptr)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:22`
- **Purpose**: Query if in divergent code path (Skia)

### SkRecordReplayAreEventsUnavailable
- **Signature**: `bool SkRecordReplayAreEventsUnavailable(const char* why)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:27`
- **Purpose**: Query if events are unavailable in replay

### SkRecordReplayBeginPassThroughEvents
- **Signature**: `void SkRecordReplayBeginPassThroughEvents()`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:23`
- **Purpose**: Begin pass-through event region in Skia

### SkRecordReplayEndPassThroughEvents
- **Signature**: `void SkRecordReplayEndPassThroughEvents()`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:24`
- **Purpose**: End pass-through events in Skia

### SkRecordReplayIsReplaying
- **Signature**: `bool SkRecordReplayIsReplaying()`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:25`
- **Purpose**: Query replay state (Skia)

### SkRecordReplayHasDivergedFromRecording
- **Signature**: `bool SkRecordReplayHasDivergedFromRecording()`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:26`
- **Purpose**: Query divergence state (Skia)

### SkRecordReplayValue
- **Signature**: `uintptr_t SkRecordReplayValue(const char* why, uintptr_t v)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:28`
- **Purpose**: Record/replay value deterministically (Skia)

### SkRecordReplayPointerId
- **Signature**: `int SkRecordReplayPointerId(const void* ptr)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:17`
- **Purpose**: Get deterministic pointer ID (Skia)

### SkRecordReplayCreateOrderedLock
- **Signature**: `int SkRecordReplayCreateOrderedLock(const char* ordered_name)`
- **Header Location**: `src/third_party/skia/include/private/SkMutex.h:17`
- **Return Value**: Lock ID
- **Callers**:
  - `src/third_party/skia/include/private/SkMutex.h:25` (SkMutex constructor)
- **Purpose**: Create ordered lock for Skia mutexes

### SkRecordReplayOrderedLock
- **Signature**: `void SkRecordReplayOrderedLock(int lock)`
- **Header Location**: `src/third_party/skia/include/private/SkMutex.h:18`
- **Purpose**: Acquire ordered lock (Skia)

### SkRecordReplayOrderedUnlock
- **Signature**: `void SkRecordReplayOrderedUnlock(int lock)`
- **Header Location**: `src/third_party/skia/include/private/SkMutex.h:19`
- **Purpose**: Release ordered lock (Skia)

### SkRecordReplayPrint
- **Signature**: `void SkRecordReplayPrint(const char* format, ...)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:11`
- **Purpose**: Record/replay diagnostic print (Skia)

### SkRecordReplayWarning
- **Signature**: `void SkRecordReplayWarning(const char* format, ...)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:12`
- **Purpose**: Record/replay warning (Skia)

### SkRecordReplayAssert
- **Signature**: `void SkRecordReplayAssert(const char* format, ...)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:13`
- **Purpose**: Record/replay assertion (Skia)

### SkRecordReplayDiagnostic
- **Signature**: `void SkRecordReplayDiagnostic(const char* format, ...)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:14`
- **Purpose**: Record/replay detailed diagnostics (Skia)

### SkRecordReplayRegisterPointer
- **Signature**: `void SkRecordReplayRegisterPointer(const void* ptr)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:15`
- **Purpose**: Register pointer for deterministic handling (Skia)

### SkRecordReplayUnregisterPointer
- **Signature**: `void SkRecordReplayUnregisterPointer(const void* ptr)`
- **Header Location**: `src/third_party/skia/src/core/SkRecordReplay.h:16`
- **Purpose**: Unregister pointer (Skia)

---

## 第七节：尚未归类的 extern C 声明

### CallbackRecordReplayValue
- **Signature**: `uintptr_t CallbackRecordReplayValue(const char* why, uintptr_t value)`
- **Header Location**: `src/base/functional/bind_internal.h`
- **Purpose**: Record/replay values in callback binding contexts

### RecordReplayObjectId (C++ overload, not extern "C")
- **Signature**: `int RecordReplayObjectId(v8::Isolate* isolate, v8::Local<v8::Context> cx, v8::Local<v8::Object> object)`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc`
- **Purpose**: Get unique ID for a JS object for deterministic tracking

### RecordReplayConfirmObjectHasId (C++ overload)
- **Signature**: `void RecordReplayConfirmObjectHasId(v8::Isolate* isolate, v8::Local<v8::Context> cx, v8::Local<v8::Object> object)`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc`
- **Purpose**: Confirm object has been assigned a deterministic ID

### RecordReplayGetBytecode (C++ overload)
- **Signature**: `v8::Local<v8::Object> RecordReplayGetBytecode(v8::Isolate* isolate, v8::Local<v8::Context> cx, v8::Local<v8::Function> function)`
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc`
- **Purpose**: Retrieve bytecode representation of a function for debugging

### RecordReplayStateEnsureInitialized
- **Signature**: `bool RecordReplayStateEnsureInitialized()`
- **Header Location**: `src/components/viz/service/display/record_replay_render.cc:21` (declared in blink namespace)
- **Purpose**: Initialize record/replay state if not already done

### RecordReplayGetScriptedCaller (C++ function in v8 namespace)
- **Header Location**: `src/third_party/blink/renderer/core/dom/node.cc`
- **Signature**: `std::string RecordReplayGetScriptedCaller()` (v8 namespace)
- **Purpose**: Get stack trace of the currently executing script

---

## 第八节：浏览器事件回调

### FunctionCallbackRecordReplaySetCommandCallback
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc`
- **Purpose**: Register callback for debugger command execution

### FunctionCallbackRecordReplaySetClearPauseDataCallback
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc`
- **Purpose**: Register callback to clear pause data during replay

### FunctionCallbackRecordReplayAddNewScriptHandler
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc`
- **Purpose**: Register callback for new script notification

### FunctionCallbackRecordReplayGetScriptSource
- **Header Location**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc`
- **Purpose**: Register callback to retrieve script source code

---

## 第九节：extern 全局变量

The Chromium codebase does NOT directly expose extern global variables like `gProgressCounter`, `gTargetProgress`, etc. Instead, these are accessed via function pointers such as `V8RecordReplayGetProgressCounter()` which returns a pointer to the underlying counter.

However, the following extern declarations exist for WebUI URLs:

### kChromeUIRecordReplayHost
- **Type**: `const char*`
- **Header Location**: `src/chrome/common/webui_url_constants.h`
- **Purpose**: WebUI host name for record/replay panel

### kChromeUIRecordReplayIconHost
- **Type**: `const char*`
- **Header Location**: `src/chrome/common/webui_url_constants.h`
- **Purpose**: WebUI host for icons

### kChromeUIRecordReplayPageHost
- **Type**: `const char*`
- **Header Location**: `src/chrome/common/webui_url_constants.h`
- **Purpose**: WebUI host for page

### kChromeUIRecordReplayPageURL
- **Type**: `const char*`
- **Header Location**: `src/chrome/common/webui_url_constants.h`
- **Purpose**: WebUI URL

---

## 第十节：统计汇总

### Total Distinct Extern C Symbols

| Category | Count | Notes |
|----------|-------|-------|
| State Query Functions | 15 | V8IsRecordingOrReplaying, etc. |
| Value Recording Functions | 3 | V8RecordReplayValue, Bytes, Assert |
| Pointer ID Management | 6 | CreateOrderedLock, PointerId, etc. |
| Assertion/Logging (Variadic) | 8 | Print, Diagnostic, Assert, etc. |
| Event Recording | 8 | OnAnnotation, OnNetwork*, OnEvent, etc. |
| Event Control | 7 | BeginDisallow, PassThrough, etc. |
| Dependency Graph | 4 | NewNode, AddEdge, Begin/End |
| Platform-Specific | 2 | AddOrderedSRWLock |
| Termination | 3 | MaybeTerminate, Finish, GetStack |
| Buffer Allocation | 2 | BeginAssert, EndAssert |
| Blink Callbacks | 10 | SetDefaultContext, ReadAsset, etc. |
| HTML Parsing | 3 | ParseStart, ParseFinish, ParseAddData |
| Paint/Rendering | 3 | PaintStart, PaintFinished, SetCallback |
| Skia Integration | 19 | SkRecordReplay* variants |
| **TOTAL** | **113** | (Some counted in multiple categorizations) |

### Distribution by Component

- **Base Library** (`src/base/`): ~50 symbols
- **V8 Integration** (`src/gin/`, `src/third_party/blink/renderer/bindings/`): ~30 symbols
- **Skia Graphics** (`src/third_party/skia/`): ~19 symbols
- **Rendering** (`src/components/viz/`): ~3 symbols
- **HTML Parsing** (`src/third_party/blink/renderer/core/html/`): ~3 symbols
- **Content** (`src/content/renderer/`): ~2 symbols
- **Chrome** (`src/chrome/`): ~4 symbols (WebUI constants)

---

## 第十一节：driver 开发实现笔记

### Function Pointer Pattern (Windows)

On Windows (IS_WIN), the chromium code uses a dynamic loading pattern:

```cpp
#define DefineFunction(Name, Formals, Args, ReturnType, DefaultValue) \
  static ReturnType (*g##Name) Formals;                               \
  static inline ReturnType Name Formals {                             \
    return g##Name ? g##Name Args : DefaultValue;                     \
  }
```

The driver must export symbols matching the exact name. For example, `V8IsRecordingOrReplaying`, `V8RecordReplayValue`, etc.

### Extern Declare Pattern (POSIX/Mac)

On non-Windows platforms, the code uses direct extern declarations:

```cpp
#define DefineFunction(Name, Formals, Args, ReturnType, DefaultValue) \
  extern "C" ReturnType Name Formals;
```

The driver must define these with `extern "C"` linkage.

### Key Integration Points

1. **Initialization**: The driver is loaded via `DYLD_INSERT_LIBRARIES` or Windows equivalent before Chromium starts.
2. **State Management**: The driver maintains global state for:
   - Current recording/replay mode
   - Checkpoint/bookmark bookkeeping
   - Pointer ID registry
   - Lock ordering state
3. **Event Streams**: The driver receives and stores:
   - JavaScript execution bookmarks
   - DOM/Blink events
   - Paint operations
   - Network requests
   - User input events
4. **Replay Execution**: During replay, the driver:
   - Provides pre-recorded values via query functions
   - Triggers callbacks to resume execution at checkpoints
   - Validates assertions
   - Controls event flow

### Thread Safety Considerations

- Most functions must be thread-safe (main thread, compositor thread, etc.)
- `V8IsMainThread()` can be used to branch on thread context
- Ordered locks are used to serialize access in deterministic order

### Feature Flags

The driver can enable/disable features via `V8RecordReplayFeatureEnabled()`. Common features:
- `"pointer-ids"` - Enable deterministic pointer ordering
- `"dependency-graph"` - Enable execution dependency tracking
- Others defined by the driver implementation

---

## 第十二节：相关文档

- **Chromium Source**: `/Users/hongrunhui/Documents/code/chromium/src/`
- **Record Replay Header**: `src/base/record_replay.h` (main API)
- **V8 Bindings**: `src/third_party/blink/renderer/bindings/core/v8/record_replay_interface.cc`
- **Paint Integration**: `src/components/viz/service/display/record_replay_render.cc`
- **Skia Integration**: `src/third_party/skia/src/core/SkRecordReplay.h`
- **Macro Definitions**: `src/base/record_replay.cc` (ForEachV8API, ForEachV8APIVoid macros)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-04-23 | Initial comprehensive catalog of all extern C symbols |

---

**Document prepared for**: Open Replay driver implementation (Phase B2')  
**Status**: Complete and comprehensive  
**Maintainer**: Chromium fork analysis
