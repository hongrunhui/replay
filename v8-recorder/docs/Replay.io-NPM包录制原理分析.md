# Replay.io NPM 包录制原理逆向分析

## 1. 包结构概览

### 1.1 核心包信息
- **包名**: `replayio`
- **版本**: 1.8.2
- **描述**: CLI tool for uploading and managing recordings
- **仓库**: https://github.com/replayio/replay-cli
- **依赖的核心包**:
  - `@replayio/protocol`: 协议定义
  - `@replayio/sourcemap-upload`: SourceMap 上传
  - `ws`: WebSocket 客户端

### 1.2 目录结构
```
replayio/
├── bin.js                    # CLI 入口
├── dist/
│   ├── bin.js               # 编译后的主入口
│   ├── commands/            # 命令实现
│   │   ├── record.js        # 录制命令 ⭐
│   │   ├── upload.js        # 上传命令
│   │   ├── list.js          # 列表命令
│   │   └── ...
│   ├── utils/
│   │   ├── browser/         # 浏览器相关工具
│   │   │   └── launchBrowser.js  # 启动浏览器 ⭐
│   │   ├── recordings/      # 录制管理
│   │   └── installation/    # 运行时安装
│   └── _bundled/@replay-cli/shared/
│       ├── protocol/        # 协议客户端 ⭐
│       │   ├── ProtocolClient.js
│       │   └── api/         # API 调用
│       ├── recording/       # 录制管理 ⭐
│       │   ├── getRecordings.js
│       │   ├── upload/
│       │   └── metadata/
│       └── ...
```

## 2. 录制流程分析

### 2.1 录制命令入口 (`commands/record.js`)

```javascript
// 命令注册
registerCommand("record", {
  checkForRuntimeUpdate: true,  // 检查运行时更新
  requireAuthentication: true   // 需要认证
})
.argument("[url]", `URL to open (default: "about:blank")`)
.option("--headless", "Run the browser in headless mode", false)
.action(record)
```

**核心流程**:
1. 生成 `processGroupId` (UUID) 用于关联同一次录制的多个进程
2. 杀死已运行的浏览器实例
3. 启动 Replay 浏览器
4. 等待录制完成
5. 收集录制结果（成功/崩溃/不可用）
6. 提示用户上传

### 2.2 浏览器启动 (`utils/browser/launchBrowser.js`)

**关键环境变量设置**:
```javascript
const processOptions = {
  env: {
    // 核心：启用录制
    RECORD_ALL_CONTENT: record ? "1" : undefined,

    // 禁用录制（与上面互斥）
    RECORD_REPLAY_DONT_RECORD: record ? undefined : "1",

    // 录制文件存储目录（默认 ~/.replay）
    RECORD_REPLAY_DIRECTORY: getReplayPath(),

    // 元数据（包含 processGroupId）
    RECORD_REPLAY_METADATA: processGroupId ? JSON.stringify({ processGroupId }) : undefined,

    // 详细日志
    RECORD_REPLAY_VERBOSE: "1"
  }
};
```

**浏览器启动参数**:
```javascript
const args = [
  url,                                    // 要打开的 URL
  "--no-first-run",                       // 跳过首次运行
  "--no-default-browser-check",           // 不检查默认浏览器
  `--user-data-dir=${profileDir}`,        // 用户数据目录
  "--headless=new"                        // 可选：无头模式
];
```

**浏览器可执行文件路径**:
- macOS: `~/.replay/runtimes/replay-chromium-<version>/Replay.app/Contents/MacOS/Replay`
- Linux: `~/.replay/runtimes/replay-chromium-<version>/replay-chromium`
- Windows: `~/.replay/runtimes/replay-chromium-<version>/replay-chromium.exe`

### 2.3 录制数据存储

**录制日志路径**: `~/.replay/recordings.log`

**日志格式**: NDJSON (Newline Delimited JSON)

**日志事件类型**:
```javascript
const RECORDING_LOG_KIND = {
  createRecording: "createRecording",        // 创建录制
  writeStarted: "writeStarted",              // 开始写入
  writeFinished: "writeFinished",            // 写入完成
  addMetadata: "addMetadata",                // 添加元数据
  crashed: "crashed",                        // 崩溃
  crashData: "crashData",                    // 崩溃数据
  recordingUnusable: "recordingUnusable",    // 录制不可用
  uploadStarted: "uploadStarted",            // 开始上传
  uploadFinished: "uploadFinished",          // 上传完成
  uploadFailed: "uploadFailed",              // 上传失败
  sourcemapAdded: "sourcemapAdded",          // 添加 SourceMap
  originalSourceAdded: "originalSourceAdded",// 添加原始源码
  processingStarted: "processingStarted",    // 开始处理
  processingFinished: "processingFinished",  // 处理完成
  processingFailed: "processingFailed"       // 处理失败
};
```

**录制文件路径**: `~/.replay/<recording-id>`

## 3. 录制原理深度分析

### 3.1 浏览器层面的录制机制

Replay.io 使用的是**改造后的 Chromium 浏览器**（Replay Chromium），通过环境变量控制录制行为：

#### 核心环境变量
1. **`RECORD_ALL_CONTENT=1`**
   - 启用完整内容录制
   - 浏览器内部会激活录制模块
   - 记录所有 JS 执行、DOM 操作、网络请求等

2. **`RECORD_REPLAY_DIRECTORY`**
   - 指定录制文件存储位置
   - 浏览器会将录制数据写入此目录

3. **`RECORD_REPLAY_METADATA`**
   - 传递元数据给浏览器
   - 包含 processGroupId、title、uri 等信息
   - 浏览器会将这些信息嵌入录制文件

### 3.2 录制数据格式

录制文件是**二进制格式**，包含：
- **执行点序列**: 每个 JS 函数调用、DOM 操作的时间戳和位置
- **非确定性数据**:
  - 系统调用结果（时间、随机数）
  - 网络请求响应
  - 用户输入事件
  - 定时器触发
- **快照数据**: 关键时刻的内存快照
- **元数据**: 录制信息、构建 ID、版本等

### 3.3 录制过程的技术实现

基于之前的研究，Replay Chromium 的录制机制：

1. **系统调用拦截**
   ```
   应用代码 → Replay Driver → 系统库
                    ↓
              记录非确定性数据
   ```

2. **JS 引擎插桩**
   - 在 V8 引擎中添加钩子
   - 记录每个函数调用的执行点
   - 追踪变量变化和作用域

3. **DOM 追踪**
   - 监听所有 DOM 操作
   - 记录 MutationObserver 事件
   - 捕获样式变化

4. **事件捕获**
   - 拦截所有浏览器事件
   - 记录事件触发时间和参数
   - 保存事件处理结果

## 4. 上传流程分析

### 4.1 Protocol Client (`protocol/ProtocolClient.js`)

**WebSocket 连接**:
```javascript
// 连接到 Replay 云服务
const socket = new WebSocket(config.replayWsServer);
// 默认: wss://dispatch.replay.io

// 认证
await setAccessToken(client, { accessToken });
```

**协议格式**: 基于 Chrome DevTools Protocol (CDP)
```javascript
// 请求
{
  id: 1,
  method: "Recording.beginRecordingUpload",
  params: { recordingId, recordingSize, buildId },
  sessionId: "..."
}

// 响应
{
  id: 1,
  result: { recordingId, uploadLink }
}

// 事件
{
  method: "Recording.sessionError",
  params: { code, message, sessionId }
}
```

### 4.2 上传策略 (`recording/upload/uploadRecording.js`)

**三种上传方式**:

1. **小文件直接上传** (< 100MB)
   ```javascript
   beginRecordingUpload() → 获取预签名 URL
   ↓
   PUT 上传到 S3
   ↓
   endRecordingUpload() → 通知完成
   ```

2. **大文件分片上传** (> 100MB)
   ```javascript
   beginRecordingMultipartUpload() → 获取分片 URLs
   ↓
   并发上传多个分片（最多 10 个并发）
   ↓
   endRecordingMultipartUpload() → 合并分片
   ```

3. **无预签名 URL 上传** (特殊情况)
   ```javascript
   直接通过 WebSocket 传输数据
   ```

**上传流程**:
```javascript
1. 验证录制元数据
2. 开始上传（获取上传 URL）
3. 设置元数据到服务器
4. 上传录制文件
5. 上传 SourceMaps（如果有）
6. 结束上传
7. 触发处理（可选）
```

### 4.3 元数据管理

**元数据结构**:
```javascript
{
  metadata: {
    title: "页面标题",
    uri: "https://example.com",
    processType: "root" | "iframe" | "devtools" | "extension",
    processGroupId: "uuid",
    sourceMaps: [
      {
        id: "uuid",
        path: "/path/to/sourcemap",
        baseURL: "https://...",
        targetContentHash: "...",
        targetURLHash: "...",
        targetMapURLHash: "...",
        originalSources: [...]
      }
    ]
  },
  recordingData: {
    id: "recording-id",
    buildId: "chromium-build-id",
    duration: 12345,
    ...
  }
}
```

## 5. 录制管理

### 5.1 录制状态机

```
recording → finished → uploading → uploaded → processing → processed
    ↓           ↓           ↓
  crashed   unusable    failed
```

**状态说明**:
- `recording`: 正在录制
- `finished`: 录制完成，等待上传
- `crashed`: 录制过程崩溃
- `unusable`: 录制不可用（如文件损坏）
- `uploading`: 正在上传
- `uploaded`: 上传完成
- `failed`: 上传失败
- `processing`: 云端处理中
- `processed`: 处理完成，可以查看

### 5.2 录制日志解析 (`recording/getRecordings.js`)

**日志读取流程**:
1. 读取 `~/.replay/recordings.log`
2. 逐行解析 NDJSON
3. 根据事件类型更新录制状态
4. 构建录制对象列表
5. 过滤和排序

**录制对象结构**:
```javascript
{
  id: "recording-id",
  buildId: "chromium-build-id",
  date: Date,
  duration: number,
  path: "/path/to/recording/file",
  recordingStatus: "finished" | "crashed" | "unusable",
  uploadStatus: "uploading" | "uploaded" | "failed",
  processingStatus: "processing" | "processed" | "failed",
  metadata: {
    host: "example.com",
    title: "页面标题",
    processType: "root",
    processGroupId: "uuid",
    sourceMaps: [...]
  },
  crashData: [...],
  unusableReason: "...",
  uploadError: Error
}
```

## 6. 关键技术点总结

### 6.1 录制触发机制

**不是通过 npm 包实现录制，而是通过改造后的浏览器**:
- npm 包只是**启动器和管理工具**
- 真正的录制由 **Replay Chromium 浏览器**完成
- 通过**环境变量**控制浏览器行为

### 6.2 数据流向

```
用户代码执行
    ↓
Replay Chromium (改造后的浏览器)
    ↓ (录制)
二进制录制文件 (~/.replay/<id>)
    ↓ (npm 包读取)
录制日志 (recordings.log)
    ↓ (上传)
WebSocket Protocol Client
    ↓
Replay Cloud Service (wss://dispatch.replay.io)
    ↓
S3 存储 (预签名 URL)
    ↓
云端处理和分析
    ↓
可查看的 Replay
```

### 6.3 核心优势

1. **低侵入性**: 不需要修改应用代码
2. **完整性**: 记录所有执行细节
3. **确定性**: 可精确重放
4. **可分享**: 上传后团队成员都能查看
5. **低开销**: 约 3.5% 的性能开销

### 6.4 技术限制

1. **需要特定浏览器**: 必须使用 Replay Chromium
2. **文件较大**: 完整录制会产生较大文件
3. **上传时间**: 大文件上传可能较慢
4. **隐私问题**: 录制包含所有执行细节

## 7. 与浏览器的交互协议

### 7.1 环境变量协议

浏览器通过读取环境变量来配置录制行为：

| 环境变量 | 作用 | 示例值 |
|---------|------|--------|
| `RECORD_ALL_CONTENT` | 启用录制 | `"1"` |
| `RECORD_REPLAY_DONT_RECORD` | 禁用录制 | `"1"` |
| `RECORD_REPLAY_DIRECTORY` | 录制目录 | `"/Users/xxx/.replay"` |
| `RECORD_REPLAY_METADATA` | 元数据 | `'{"processGroupId":"uuid"}'` |
| `RECORD_REPLAY_VERBOSE` | 详细日志 | `"1"` |

### 7.2 文件系统协议

**浏览器写入**:
- 录制文件: `~/.replay/<recording-id>`
- 日志追加: `~/.replay/recordings.log`

**npm 包读取**:
- 解析日志获取录制列表
- 读取录制文件进行上传

### 7.3 WebSocket 协议

**连接**: `wss://dispatch.replay.io`

**主要 API**:
- `Recording.beginRecordingUpload`: 开始上传
- `Recording.endRecordingUpload`: 结束上传
- `Recording.beginRecordingMultipartUpload`: 开始分片上传
- `Recording.endRecordingMultipartUpload`: 结束分片上传
- `Recording.setRecordingMetadata`: 设置元数据
- `Recording.processRecording`: 触发处理
- `Recording.addSourceMap`: 添加 SourceMap
- `Recording.addOriginalSource`: 添加原始源码

## 8. 实现细节

### 8.1 并发控制

```javascript
// 上传队列：最多 10 个并发
const uploadQueue = createPromiseQueue({ concurrency: 10 });

// 分片上传：并发上传多个分片
await Promise.all(
  partLinks.map((link, index) =>
    uploadPart(link, recordingPath, index, chunkSize)
  )
);
```

### 8.2 错误处理

```javascript
// 指数退避重试
await retryWithExponentialBackoff(
  () => uploadRecordingFile({ recordingPath, size, url }),
  (error, attemptNumber) => {
    logger.logDebug(`Attempt ${attemptNumber} to upload failed`, { error });
    if (error.code === "ENOENT") {
      throw error; // 文件不存在，不重试
    }
  }
);
```

### 8.3 进度追踪

```javascript
// 异步操作日志
const progress = logAsyncOperation("Uploading crash data...");
try {
  await uploadCrashData();
  progress.setSuccess("Crash data uploaded successfully");
} catch (error) {
  progress.setFailed("Crash data could only be partially uploaded");
}
```

## 9. 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      用户命令                                 │
│                   replayio record [url]                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    replayio CLI (npm 包)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. 检查认证和运行时                                  │   │
│  │  2. 生成 processGroupId                              │   │
│  │  3. 设置环境变量                                      │   │
│  │  4. 启动 Replay Chromium                             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Replay Chromium (改造后的浏览器)                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  环境变量读取:                                        │   │
│  │  • RECORD_ALL_CONTENT=1                             │   │
│  │  • RECORD_REPLAY_DIRECTORY=~/.replay                │   │
│  │  • RECORD_REPLAY_METADATA={...}                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  录制引擎:                                            │   │
│  │  • 系统调用拦截 (Replay Driver)                      │   │
│  │  • JS 引擎插桩 (V8 Hooks)                           │   │
│  │  • DOM 追踪 (MutationObserver++)                    │   │
│  │  • 事件捕获 (Event Listeners)                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  数据写入:                                            │   │
│  │  • 录制文件: ~/.replay/<id>                          │   │
│  │  • 日志追加: ~/.replay/recordings.log               │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  用户关闭浏览器/按键停止                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    replayio CLI (npm 包)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. 读取 recordings.log                              │   │
│  │  2. 解析录制状态                                      │   │
│  │  3. 提示用户上传                                      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (用户确认上传)
┌─────────────────────────────────────────────────────────────┐
│                    Protocol Client                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  WebSocket: wss://dispatch.replay.io                 │   │
│  │  1. 认证 (setAccessToken)                            │   │
│  │  2. 开始上传 (beginRecordingUpload)                  │   │
│  │  3. 设置元数据 (setRecordingMetadata)                │   │
│  │  4. 上传文件到 S3 (预签名 URL)                       │   │
│  │  5. 上传 SourceMaps                                  │   │
│  │  6. 结束上传 (endRecordingUpload)                    │   │
│  │  7. 触发处理 (processRecording)                      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Replay Cloud Service                        │
│  • 接收录制文件                                              │
│  • 云端处理和分析                                            │
│  • 生成可查看的 Replay                                       │
└─────────────────────────────────────────────────────────────┘
```

## 10. 总结

### 核心发现

1. **replayio npm 包不直接实现录制**
   - 它是一个**CLI 工具和管理器**
   - 真正的录制由**改造后的 Chromium 浏览器**完成

2. **录制触发机制**
   - 通过**环境变量**控制浏览器行为
   - `RECORD_ALL_CONTENT=1` 启用录制
   - `RECORD_REPLAY_DIRECTORY` 指定存储位置

3. **录制数据格式**
   - **二进制格式**，包含执行点、非确定性数据、快照
   - 存储在 `~/.replay/<recording-id>`
   - 日志记录在 `~/.replay/recordings.log`

4. **上传机制**
   - 通过 **WebSocket** 连接到 Replay 云服务
   - 使用**预签名 URL** 上传到 S3
   - 支持**分片上传**大文件

5. **架构设计**
   - **分离关注点**: CLI 工具 + 浏览器录制 + 云端处理
   - **低侵入性**: 不需要修改应用代码
   - **可扩展性**: 支持插件和自定义元数据

### 技术亮点

- ✅ 使用环境变量作为进程间通信机制
- ✅ NDJSON 格式的日志便于追加和解析
- ✅ WebSocket + 预签名 URL 的混合上传策略
- ✅ 指数退避重试机制保证可靠性
- ✅ 并发控制避免资源耗尽
- ✅ 状态机管理录制生命周期

---

**文档版本**: 1.0
**创建日期**: 2026-03-03
**分析对象**: replayio@1.8.2
