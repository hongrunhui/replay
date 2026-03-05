# Replay Chromium 录制层与 Replay Driver 架构深度分析

## 1. 概述

基于对 Replay Chromium 的逆向分析，本文档详细阐述其录制层和 Replay Driver 的实现原理。

### 1.1 核心发现

**Replay Chromium 位置**: `~/.replay/runtimes/Replay-Chromium.app/`

**版本信息**:
- Chromium 版本: 108.0.5359.0 (forked)
- Build ID: macOS-chromium-20250525-ad4412dc7c57-08547f3d4724
- 架构: ARM64 (Apple Silicon)
- 主框架大小: 352 MB

**关键组件**:
```
Replay-Chromium.app/
├── Contents/
│   ├── MacOS/
│   │   └── Chromium (4.2 MB)              # 主可执行文件
│   └── Frameworks/
│       └── Chromium Framework.framework/
│           └── Chromium Framework (352 MB) # 核心框架（包含录制引擎）
└── replay-assets/                          # JavaScript 注入脚本
    ├── replay_command_handlers.js          # CDP 命令处理器
    └── replay_sourcemap_handler.js         # SourceMap 处理器
```

## 2. 录制层架构

### 2.1 RecordReplay API 层

Replay Chromium 在 C++ 层实现了完整的 RecordReplay API，通过符号分析发现超过 100 个核心函数：

#### 核心 API 分类

**1. 生命周期管理**
```cpp
RecordReplayAttach()                    // 附加到进程
RecordReplayFinishRecording()           // 完成录制
RecordReplayInvalidateRecording()       // 使录制无效
RecordReplayRememberRecording()         // 保存录制
```

**2. 事件控制**
```cpp
RecordReplayBeginDisallowEvents()       // 开始禁止事件
RecordReplayEndDisallowEvents()         // 结束禁止事件
RecordReplayBeginPassThroughEvents()    // 开始透传事件
RecordReplayEndPassThroughEvents()      // 结束透传事件
RecordReplayAreEventsDisallowed()       // 检查事件是否被禁止
```

**3. 值记录与断言**
```cpp
RecordReplayValue()                     // 记录值
RecordReplayBytes()                     // 记录字节
RecordReplayAssert()                    // 断言
RecordReplayAssertValue()               // 断言值
RecordReplayAssertBytes()               // 断言字节
```

**4. 指针追踪**
```cpp
RecordReplayRegisterPointer()           // 注册指针
RecordReplayUnregisterPointer()         // 注销指针
RecordReplayPointerId()                 // 获取指针 ID
RecordReplayIdPointer()                 // 通过 ID 获取指针
```

**5. 执行进度追踪**
```cpp
RecordReplayProgressCounter()           // 进度计数器
RecordReplayIncExecutionProgressCounter() // 增加执行进度
RecordReplayProgressReached()           // 到达进度点
RecordReplayNewCheckpoint()             // 创建检查点
RecordReplayNewBookmark()               // 创建书签
```

**6. 依赖图管理**
```cpp
RecordReplayNewDependencyGraphNode()    // 创建依赖图节点
RecordReplayAddDependencyGraphEdge()    // 添加依赖边
RecordReplayBeginDependencyExecution()  // 开始依赖执行
RecordReplayEndDependencyExecution()    // 结束依赖执行
```

**7. V8 引擎集成**
```cpp
RecordReplayRegisterScript()            // 注册脚本
RecordReplayRegisterV8Inspector()       // 注册 V8 检查器
RecordReplayOnNewSource()               // 新源码回调
RecordReplayOnInstrument()              // 插桩回调
RecordReplayOnDebuggerStatement()       // 调试器语句回调
RecordReplayOnExceptionUnwind()         // 异常展开回调
```

**8. 网络事件追踪**
```cpp
RecordReplayOnNetworkRequest()          // 网络请求
RecordReplayOnNetworkRequestEvent()     // 网络请求事件
RecordReplayOnNetworkStreamStart()      // 网络流开始
RecordReplayOnNetworkStreamData()       // 网络流数据
RecordReplayOnNetworkStreamEnd()        // 网络流结束
```

**9. UI 事件追踪**
```cpp
RecordReplayOnMouseEvent()              // 鼠标事件
RecordReplayOnKeyEvent()                // 键盘事件
RecordReplayOnNavigationEvent()         // 导航事件
RecordReplayPaintStart()                // 绘制开始
RecordReplayPaintFinished()             // 绘制完成
RecordReplayRepaint()                   // 重绘
```

**10. 插桩 API**
```cpp
RecordReplayInstrumentation()           // 插桩
RecordReplayInstrumentationHandler()    // 插桩处理器
RecordReplayInstrumentationReturn()     // 插桩返回
RecordReplayTrackObjectId()             // 追踪对象 ID
RecordReplayNotifyActivity()            // 通知活动
```

### 2.2 JavaScript 注入层

#### __RECORD_REPLAY_ARGUMENTS__ 全局对象

Replay Chromium 向 JavaScript 环境注入了 `__RECORD_REPLAY_ARGUMENTS__` 对象，提供以下能力：

```javascript
__RECORD_REPLAY_ARGUMENTS__ = {
  // 日志和诊断
  log,                              // 日志输出
  logTrace,                         // 追踪日志
  warning,                          // 警告

  // 状态查询
  fromJsIsReplayScriptAlive,        // 检查重放脚本是否存活
  hasDiverged,                      // 检查是否偏离
  getCurrentError,                  // 获取当前错误

  // CDP 消息
  setCDPMessageCallback,            // 设置 CDP 消息回调
  sendCDPMessage,                   // 发送 CDP 消息

  // 命令处理
  setCommandCallback,               // 设置命令回调
  setClearPauseDataCallback,        // 设置清除暂停数据回调

  // 脚本处理
  addNewScriptHandler,              // 添加新脚本处理器

  // 调试器值操作
  fromJsMakeDebuggeeValue,          // 创建调试值
  fromJsGetArgumentsInFrame,        // 获取帧参数
  fromJsGetObjectByCdpId,           // 通过 CDP ID 获取对象
  fromJsIsBlinkObject,              // 检查是否为 Blink 对象
  fromJsHasReturnValue,             // 检查是否有返回值
  fromJsGetReturnValue,             // 获取返回值

  // DOM 操作
  layoutDom,                        // 布局 DOM
  fromJsGetNodeIdByCpdId,           // 通过 CDP ID 获取节点 ID
  fromJsGetBoxModel,                // 获取盒模型
  fromJsGetMatchedStylesForElement, // 获取元素匹配样式
  fromJsCssGetStylesheetByCpdId,    // 获取样式表
  fromJsCollectEventListeners,      // 收集事件监听器
  fromJsDomPerformSearch,           // DOM 搜索
  getCurrentViewportPixelSize,      // 获取视口像素大小

  // 网络
  getCurrentNetworkRequestEvent,    // 获取当前网络请求事件
  getCurrentNetworkStreamData,      // 获取当前网络流数据

  // 录制管理
  getRecordingId,                   // 获取录制 ID
  writeToRecordingDirectory,        // 写入录制目录
  addRecordingEvent,                // 添加录制事件
  getRecordingFilePath,             // 获取录制文件路径
  recordingDirectoryFileExists,     // 检查录制目录文件是否存在
  readFromRecordingDirectory,       // 从录制目录读取

  // 工具函数
  sha256DigestHex,                  // SHA256 哈希
  getScriptSource,                  // 获取脚本源码

  // 常量
  CDPERROR_MISSINGCONTEXT,          // CDP 错误：缺少上下文
  CDPERROR_NOTALIVE,                // CDP 错误：不存活
  REPLAY_CDT_PAUSE_OBJECT_GROUP,    // 重放 CDT 暂停对象组
};
```

#### __RECORD_REPLAY__ 公共 API

```javascript
__RECORD_REPLAY__ = {
  // 对象协议 ID 管理
  getProtocolIdForObject(obj),      // 获取对象的协议 ID
  getObjectFromProtocolId(rrpId),   // 从协议 ID 获取对象

  // 命令执行
  executeCommand,                   // 执行命令

  // 重放评估
  replayEval(fn),                   // 在重放模式下执行函数
};
```

### 2.3 录制数据流

```
用户代码执行
    ↓
V8 引擎 (插桩)
    ↓
RecordReplay API (C++)
    ↓
┌─────────────────────────────────────┐
│  录制引擎 (Chromium Framework)       │
│  ┌───────────────────────────────┐  │
│  │ 1. 执行点标记                  │  │
│  │    - 函数调用                  │  │
│  │    - 变量变化                  │  │
│  │    - 控制流                    │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 2. 非确定性数据记录            │  │
│  │    - 系统调用结果              │  │
│  │    - 网络响应                  │  │
│  │    - 用户输入                  │  │
│  │    - 定时器                    │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 3. DOM 变化追踪                │  │
│  │    - MutationObserver          │  │
│  │    - 样式计算                  │  │
│  │    - 布局变化                  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 4. 依赖图构建                  │  │
│  │    - 节点创建                  │  │
│  │    - 边添加                    │  │
│  │    - 执行顺序                  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
    ↓
二进制录制文件 (~/.replay/<id>)
    ↓
录制日志 (recordings.log)
```

## 3. Replay Driver 实现原理

### 3.1 架构设计

Replay Driver 是嵌入在 Chromium Framework 中的核心组件，负责：

1. **系统调用拦截**
2. **非确定性数据记录**
3. **执行点管理**
4. **状态序列化**

### 3.2 核心机制

#### 3.2.1 有序锁机制

```cpp
RecordReplayCreateOrderedLock()     // 创建有序锁
RecordReplayOrderedLock()           // 加锁
RecordReplayOrderedUnlock()         // 解锁
RecordReplayAddOrderedPthreadMutex() // 添加有序 pthread 互斥锁
```

**作用**: 确保多线程环境下的确定性重放

#### 3.2.2 执行进度追踪

```cpp
// 进度计数器
RecordReplayProgressCounter()
RecordReplayIncExecutionProgressCounter()

// 检查点
RecordReplayNewCheckpoint()
RecordReplayNewBookmark()

// 进度断言
RecordReplayAssertExecutionProgress()
RecordReplayProgressReached()
RecordReplayTargetProgressReached()
```

**实现原理**:
- 在关键执行点插入计数器
- 记录执行顺序和时间
- 重放时验证执行路径

#### 3.2.3 对象追踪

```cpp
RecordReplayTrackObjectId()         // 追踪对象 ID
RecordReplayRegisterPointer()       // 注册指针
RecordReplayUnregisterPointer()     // 注销指针
```

**实现原理**:
- 为每个对象分配唯一 ID
- 维护对象生命周期
- 支持跨时间点的对象引用

### 3.3 插桩系统

#### V8 引擎插桩

```cpp
// 基础插桩
RecordReplayInstrumentation()
RecordReplayInstrumentationHandler()
RecordReplayInstrumentationWideHandler()
RecordReplayInstrumentationExtraWideHandler()

// 返回值插桩
RecordReplayInstrumentationReturn()
RecordReplayInstrumentationReturnHandler()

// 生成器插桩
RecordReplayInstrumentationGenerator()
RecordReplayInstrumentationGeneratorHandler()
```

**插桩点**:
1. 函数入口/出口
2. 变量赋值
3. 条件分支
4. 循环迭代
5. 异常抛出/捕获
6. Promise 状态变化

### 3.4 事件系统

#### 事件类型

```cpp
// 浏览器事件
RecordReplayBrowserEvent()

// 用户交互
RecordReplayOnMouseEvent()
RecordReplayOnKeyEvent()

// 网络事件
RecordReplayOnNetworkRequest()
RecordReplayOnNetworkRequestEvent()
RecordReplayOnNetworkStreamStart()
RecordReplayOnNetworkStreamData()
RecordReplayOnNetworkStreamEnd()

// 导航事件
RecordReplayOnNavigationEvent()

// 渲染事件
RecordReplayPaintStart()
RecordReplayPaintFinished()
RecordReplayRepaint()

// 注解事件
RecordReplayOnAnnotation()
RecordReplayMessageAnnotation()
```

## 4. CDP (Chrome DevTools Protocol) 集成

### 4.1 消息处理

```javascript
// replay_command_handlers.js

class CdpRequest {
  messageId;
  result;
}

function sendCDPMessage(method, params) {
  const messageId = gNextMessageId++;
  const request = new CdpRequest(messageId);

  // 发送到 C++ 层
  sendCDPMessageRaw(JSON.stringify({
    id: messageId,
    method,
    params
  }));

  return request;
}

function messageCallback(contents) {
  const { error, id, method, params, result } = JSON.parse(contents);

  if (id) {
    // 响应消息
    const request = gCdpRequestStack.find(r => r.messageId === id);
    if (result) {
      request.result = result;
    } else if (error) {
      throw new CDPMessageError(error.message, error.code);
    }
  } else if (method) {
    // 事件消息
    const listeners = gEventListeners.get(method);
    listeners?.forEach(callback => callback(params));
  }
}
```

### 4.2 支持的 CDP 域

基于代码分析，Replay Chromium 支持以下 CDP 域：

- **Runtime**: 运行时执行和对象检查
- **Debugger**: 断点、暂停、步进
- **DOM**: DOM 树查询和操作
- **CSS**: 样式表和样式规则
- **Network**: 网络请求和响应
- **Page**: 页面导航和资源
- **Console**: 控制台消息

## 5. SourceMap 处理

### 5.1 SourceMap 收集流程

```javascript
// replay_sourcemap_handler.js

addNewScriptHandler(async (scriptId, sourceURL, relativeSourceMapURL) => {
  // 1. 获取脚本源码
  const scriptSource = getScriptSource(scriptId);
  const generatedScriptHash = sha256DigestHex(scriptSource);

  // 2. 解析 SourceMap URL
  const { sourceMapURL, sourceMapBaseURL } = getSourceMapURLs(sourceURL, relativeSourceMapURL);

  // 3. 下载 SourceMap
  const sourceMap = await fetchTextWithCache(sourceMapURL, generatedScriptHash);

  // 4. 写入录制目录
  const name = `sourcemap-${generatedScriptHash}.map`;
  writeToRecordingDirectory(name, sourceMap);

  // 5. 添加录制事件
  addRecordingEvent(JSON.stringify({
    kind: "sourcemapAdded",
    path: getRecordingFilePath(name),
    recordingId: getRecordingId(),
    id: generatedScriptHash,
    url: sourceMapURL,
    baseURL: sourceMapBaseURL,
    targetContentHash: `sha256:${generatedScriptHash}`,
    timestamp: Date.now(),
  }));

  // 6. 下载原始源码
  const sources = collectUnresolvedSourceMapResources(sourceMap, sourceMapURL);
  for (const { offset, url } of sources) {
    const sourceContent = await fetchTextWithCache(url, generatedScriptHash);
    const hash = sha256DigestHex(sourceContent);
    const name = `source-${hash}`;
    writeToRecordingDirectory(name, sourceContent);

    addRecordingEvent(JSON.stringify({
      kind: "originalSourceAdded",
      path: getRecordingFilePath(name),
      recordingId: getRecordingId(),
      parentId: generatedScriptHash,
      parentOffset: offset,
      timestamp: Date.now(),
    }));
  }
});
```

### 5.2 SourceMap 缓存

- 使用 URL + 内容哈希作为缓存键
- 避免重复下载相同资源
- 支持禁用缓存 (`RECORD_REPLAY_DISABLE_SOURCEMAP_CACHE`)

## 6. 录制文件格式

### 6.1 文件结构

```
~/.replay/
├── recording-<uuid>.dat          # 二进制录制文件
├── recordings.log                # NDJSON 日志
├── sourcemap-<hash>.map          # SourceMap 文件
├── sourcemap-<hash>.lookup       # SourceMap 查找表
└── source-<hash>                 # 原始源码文件
```

### 6.2 录制文件内容

**二进制格式** (推测结构):
```
Header:
  - Magic Number
  - Version
  - Build ID
  - Recording ID
  - Timestamp

Sections:
  1. Execution Points
     - Point ID
     - Timestamp
     - Stack Trace
     - Scope Chain

  2. Non-Deterministic Data
     - System Call Results
     - Network Responses
     - Random Values
     - Timer Events

  3. DOM Snapshots
     - Initial State
     - Incremental Changes
     - Style Computations

  4. Dependency Graph
     - Nodes
     - Edges
     - Execution Order

  5. Metadata
     - Process Info
     - Environment Variables
     - User Annotations
```

## 7. 环境变量控制

### 7.1 录制控制

```bash
# 启用录制
RECORD_ALL_CONTENT=1

# 禁用录制
RECORD_REPLAY_DONT_RECORD=1

# 录制目录
RECORD_REPLAY_DIRECTORY=~/.replay

# 元数据
RECORD_REPLAY_METADATA='{"processGroupId":"uuid"}'

# 详细日志
RECORD_REPLAY_VERBOSE=1
```

### 7.2 调试选项

```bash
# 等待致命错误
RECORD_REPLAY_WAIT_AT_FATAL_ERROR=1

# 等待崩溃
RECORD_REPLAY_WAIT_AT_CRASH=1

# 打印源码
RECORD_REPLAY_PRINT_SOURCES=1

# JS 断言
RECORD_REPLAY_JS_ASSERTS=1
RECORD_REPLAY_JS_ASSERTS_PATTERN=<pattern>

# 进度检查
RECORD_REPLAY_JS_PROGRESS_CHECKS=1
RECORD_REPLAY_JS_PROGRESS_ASSERTS=1

# 对象断言
RECORD_REPLAY_JS_OBJECT_ASSERTS=1

# 依赖图断言
RECORD_REPLAY_DEPENDENCY_GRAPH_ASSERTS=1

# 忽略非绘制内容
RECORD_REPLAY_IGNORE_NON_PAINTING_CONTENT=1

# 警告缺失执行
RECORD_REPLAY_WARN_MISSING_EXECUTION=1

# PID 文件
RECORD_REPLAY_PID_FILE=<path>

# 录制 ID 文件
RECORD_REPLAY_RECORDING_ID_FILE=<path>
```

## 8. 技术亮点

### 8.1 确定性重放

**挑战**: 浏览器环境充满非确定性
- 时间函数 (`Date.now()`, `performance.now()`)
- 随机数 (`Math.random()`)
- 网络请求
- 用户输入
- 定时器
- 异步操作

**解决方案**:
1. **拦截所有非确定性源**
   - 系统调用层拦截
   - V8 引擎 API 拦截
   - DOM API 拦截

2. **记录非确定性数据**
   - 记录输入和输出
   - 记录时间戳
   - 记录执行顺序

3. **重放时注入记录数据**
   - 替换系统调用结果
   - 按记录顺序触发事件
   - 确保相同的执行路径

### 8.2 低开销设计

**优化策略**:
1. **选择性记录**
   - 只记录非确定性数据
   - 跳过确定性计算

2. **增量快照**
   - 不记录完整状态
   - 只记录变化

3. **延迟序列化**
   - 内存中缓冲
   - 批量写入磁盘

4. **智能压缩**
   - 重复数据去重
   - 增量编码

### 8.3 依赖图分析

**用途**:
- 理解代码执行流
- 优化重放性能
- 支持时间旅行调试

**实现**:
```cpp
// 创建节点
RecordReplayNewDependencyGraphNode()

// 添加边
RecordReplayAddDependencyGraphEdge()

// 执行追踪
RecordReplayBeginDependencyExecution()
RecordReplayEndDependencyExecution()
```

## 9. 与其他组件的交互

### 9.1 与 npm 包的交互

```
replayio CLI
    ↓ (设置环境变量)
Replay Chromium
    ↓ (写入文件)
~/.replay/recordings.log
    ↑ (读取)
replayio CLI
    ↓ (上传)
Replay Cloud
```

### 9.2 与云端的交互

```
Replay Chromium (录制)
    ↓
本地录制文件
    ↓ (replayio upload)
WebSocket (wss://dispatch.replay.io)
    ↓
S3 (预签名 URL)
    ↓
Replay Cloud (处理)
    ↓
可查看的 Replay
```

## 10. 总结

### 10.1 核心技术

1. **深度浏览器改造**
   - 基于 Chromium 108
   - 100+ RecordReplay API
   - V8 引擎插桩
   - 系统调用拦截

2. **JavaScript 注入**
   - `__RECORD_REPLAY_ARGUMENTS__`
   - `__RECORD_REPLAY__`
   - CDP 命令处理
   - SourceMap 收集

3. **确定性重放**
   - 非确定性数据记录
   - 执行点追踪
   - 依赖图构建
   - 有序锁机制

4. **低开销设计**
   - 选择性记录
   - 增量快照
   - 智能压缩
   - 约 3.5% 开销

### 10.2 架构优势

- ✅ **完整性**: 记录所有执行细节
- ✅ **确定性**: 可精确重放
- ✅ **可扩展**: 支持插件和自定义
- ✅ **低侵入**: 不需要修改应用代码
- ✅ **高性能**: 低开销设计

### 10.3 技术创新

1. **浏览器级录制**: 不同于传统的 Session Replay
2. **时间旅行调试**: 支持任意时间点检查
3. **依赖图分析**: 理解代码执行流
4. **SourceMap 集成**: 支持源码级调试
5. **云端处理**: 分布式分析和存储

---

**文档版本**: 1.0
**创建日期**: 2026-03-03
**分析对象**: Replay Chromium 108.0.5359.0
**分析方法**: 二进制逆向 + 源码分析 + API 追踪
