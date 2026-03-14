# Replay.io DevTools 前端架构分析

> 基于 devtools 仓库源码分析，这是 Replay.io 的调试器前端，部署在 app.replay.io。

## 1. 技术栈

| 技术 | 版本/说明 |
|---|---|
| React | 0.0.0-experimental（Concurrent Mode） |
| Redux | @reduxjs/toolkit ^1.8.4 |
| Next.js | ^13.5 |
| Tailwind CSS | 样式方案 |
| CodeMirror | 源码编辑器 |
| react-resizable-panels | 面板布局 |
| react-json-tree | JSON 树展示 |
| react-error-boundary | 错误边界 |

注意：使用 React 实验版本，启用了 Suspense for Data Fetching。

## 2. 项目结构

```
devtools/
├── src/
│   ├── devtools/          # 旧版 DevTools 代码
│   │   ├── client/        # 客户端逻辑
│   │   ├── server/        # 服务端逻辑
│   │   └── shared/        # 共享代码
│   ├── ui/                # UI 层
│   │   ├── actions/       # Redux actions
│   │   ├── components/    # React 组件
│   │   ├── reducers/      # Redux reducers
│   │   ├── hooks/         # 自定义 hooks
│   │   ├── state/         # 状态管理
│   │   ├── suspense/      # Suspense 缓存
│   │   └── utils/         # 工具函数
│   ├── image/             # 图片资源
│   └── stories/           # Storybook 故事
├── packages/
│   ├── replay-next/       # 核心包（新架构）
│   ├── protocol/          # 协议通信层
│   ├── shared/            # 共享工具
│   ├── design/            # 设计系统
│   ├── accordion/         # 手风琴组件
│   ├── third-party/       # 第三方依赖
│   ├── node-protocol/     # Node 协议
│   ├── e2e-tests/         # E2E 测试
│   └── playwright-recorder/ # Playwright 录制器
└── pages/                 # Next.js 页面
```

## 3. 核心包

### 3.1 replay-next（核心 UI 包）

这是新架构的核心，包含：

```
packages/replay-next/
├── components/            # UI 组件
│   ├── console/           # Console 面板
│   ├── elements/          # Elements 面板
│   ├── errors/            # 错误展示
│   ├── SyntaxHighlighter/ # 语法高亮
│   ├── Expandable.tsx     # 可展开组件
│   ├── Loader.tsx         # 加载器
│   ├── Popup.tsx          # 弹出层
│   └── ...
├── src/
│   ├── suspense/          # Suspense 缓存（核心数据层）
│   ├── contexts/          # React Context
│   ├── hooks/             # 自定义 Hooks
│   └── utils/             # 工具函数
└── pages/                 # 独立页面
```

### 3.2 protocol（协议通信层）

```
packages/protocol/
├── socket.ts              # WebSocket 连接管理
├── utils.ts               # 协议工具函数
├── evaluation-utils.ts    # 表达式求值工具
├── execution-point-utils.ts # 执行点工具
├── PaintsCache.ts         # 绘制缓存
├── RecordedEventsCache.ts # 录制事件缓存
└── RepaintGraphicsCache.ts # 重绘图形缓存
```

### 3.3 shared（共享工具）

```
packages/shared/
├── client/                # 客户端工具
├── graphql/               # GraphQL 相关
├── theme/                 # 主题系统
├── user-data/             # 用户数据
├── utils/                 # 通用工具
├── constants.ts           # 常量定义
└── EventEmitter.ts        # 事件发射器
```

## 4. Suspense Cache 数据获取模式

Replay DevTools 大量使用 React Suspense 进行数据获取，共有 37 个 Suspense Cache：

### 4.1 源码相关

| Cache | 用途 |
|---|---|
| `SourcesCache` | 获取录制中的所有源文件列表 |
| `SourceOutlineCache` | 获取源文件大纲（函数、类定义） |
| `SourceHitCountsCache` | 获取源码行执行次数 |
| `OutlineHitCountsCache` | 获取大纲项的执行次数 |
| `SyntaxParsingCache` | 语法解析结果缓存 |
| `SearchCache` | 源码搜索结果缓存 |

### 4.2 断点与执行

| Cache | 用途 |
|---|---|
| `BreakpointPositionsCache` | 可设置断点的位置 |
| `PointsCache` | 断点/日志点数据 |
| `HitPointsCache` | 断点命中点列表 |
| `ExecutionPointsCache` | 执行点数据 |
| `FrameStepsCache` | 单步执行的帧步骤 |
| `ResumeTargetCache` | 恢复执行的目标点 |

### 4.3 暂停状态

| Cache | 用途 |
|---|---|
| `PauseCache` | 暂停状态数据 |
| `FrameCache` | 调用栈帧数据 |
| `ScopeCache` | 作用域数据 |
| `ScopeMapCache` | 作用域映射 |
| `ObjectPreviews` | 对象预览数据 |
| `PointStackCache` | 执行点调用栈 |

### 4.4 分析与日志

| Cache | 用途 |
|---|---|
| `AnalysisCache` | 分析结果缓存 |
| `LogPointAnalysisCache` | 日志点分析结果 |
| `MessagesCache` | Console 消息缓存 |
| `MappedExpressionCache` | 映射表达式缓存 |
| `MappedLocationCache` | 映射位置缓存 |

### 4.5 其他

| Cache | 用途 |
|---|---|
| `EventsCache` | 录制事件缓存 |
| `ExceptionsCache` | 异常缓存 |
| `NetworkRequestsCache` | 网络请求缓存 |
| `CommentsCache` | 评论缓存 |
| `ScreenshotCache` | 截图缓存 |
| `PaintHashCache` | 绘制哈希缓存 |
| `FocusIntervalCache` | 焦点区间缓存 |
| `BuildIdCache` | 构建 ID 缓存 |
| `TimeoutCache` | 超时缓存 |

### 4.6 数据获取模式

```typescript
// 典型的 Suspense Cache 模式
const cache = createCache<[replayClient, sourceId], SourceOutline>({
  getKey: ([client, sourceId]) => sourceId,
  load: async ([client, sourceId]) => {
    return await client.getSourceOutline(sourceId);
  },
});

// 在组件中使用
function SourceOutlinePanel({ sourceId }) {
  const outline = cache.read(replayClient, sourceId); // 会 suspend
  return <OutlineTree data={outline} />;
}
```

## 5. 源码编辑器

### 5.1 CodeMirror 集成

源码编辑器基于 CodeMirror 构建，位于 `packages/replay-next/` 和 `src/ui/components/` 中。

核心功能：
- **语法高亮** — `SyntaxHighlighter/` 组件
- **行装饰器** — 显示执行次数 badge、断点标记
- **Hover 信息** — 变量悬浮展示值
- **断点 Gutter** — 左侧断点标记区域
- **行高亮** — 当前执行行高亮

### 5.2 行执行次数

通过 `SourceHitCountsCache` 获取每行执行次数，以蓝色 badge 形式显示在行号旁。

### 5.3 变量 Hover

1. 鼠标悬浮在变量上
2. 解析光标位置的表达式
3. 通过 `MappedExpressionCache` 映射到原始表达式
4. 调用 `Pause.evaluateInFrame` 在当前暂停帧中求值
5. 使用 `ObjectPreviews` 渲染预览

## 6. 断点系统

### 6.1 断点类型

- **普通断点** — 暂停执行
- **条件断点** — 满足条件时暂停
- **日志点（Logpoint）** — 不暂停，记录表达式值

### 6.2 实现流程

```
用户点击行号 Gutter
    ↓
BreakpointPositionsCache 检查该行是否可设断点
    ↓
调用 protocol Debugger.setBreakpoint
    ↓
PointsCache 更新断点列表
    ↓
HitPointsCache 获取该断点的所有命中点
    ↓
用户可在命中点间导航（1/12 样式）
```

### 6.3 命中点导航

每个断点显示命中次数，用户可以在命中点间前后导航，实现"这行代码第 N 次执行时的状态"查看。

## 7. 变量检查器

### 7.1 Scopes 面板

通过 `ScopeCache` 获取当前暂停点的作用域链：

```
Global Scope
  └── Module Scope
       └── Function Scope (当前函数)
            ├── Local Variables
            ├── Closure Variables
            └── Block Scope Variables
```

### 7.2 对象展开

使用 `ObjectPreviews` 缓存，支持：
- 基本类型直接显示
- 对象/数组懒加载展开
- Map/Set/WeakMap 等集合类型
- Promise 状态展示
- 原型链浏览

## 8. Console 面板

### 8.1 实现位置

`packages/replay-next/components/console/`

### 8.2 功能

- 显示录制期间的所有 console 输出
- 每条消息关联执行点，可点击跳转
- 支持过滤（log/warn/error/info）
- 支持表达式求值（在当前暂停点）
- 消息时间轴与 Timeline 联动

### 8.3 数据来源

通过 `MessagesCache` 获取，底层调用 `Console.findMessages` 协议方法。

## 9. Timeline 组件

### 9.1 功能

- 显示录制的时间线
- 标记关键事件（console 输出、异常、网络请求）
- 支持拖拽跳转到任意时间点
- Focus Region 选择（缩小分析范围）
- 截图预览（悬浮显示该时间点的页面截图）

### 9.2 数据来源

- `EventsCache` — 录制事件
- `ScreenshotCache` — 截图数据
- `PaintHashCache` — 绘制哈希（用于判断画面是否变化）

## 10. Protocol 通信层

### 10.1 连接方式

```typescript
// packages/protocol/socket.ts
const socket = new WebSocket("wss://dispatch.replay.io");
```

通过 WebSocket 连接到 Replay 云端调度服务器。

### 10.2 协议结构

基于 Chrome DevTools Protocol (CDP) 扩展：

**标准 CDP 域：**
- `Debugger` — 断点、单步、暂停
- `Runtime` — 表达式求值
- `Console` — Console 消息
- `DOM` — DOM 检查
- `CSS` — 样式检查
- `Network` — 网络请求

**Replay 扩展域：**
- `Recording` — 录制管理（上传、元数据）
- `Session` — 会话管理
- `Pause` — 暂停状态（evaluateInFrame、getAllFrames）
- `Analysis` — 分析（MapReduce 风格的批量分析）
- `Graphics` — 图形/截图

### 10.3 关键 API

| API | 用途 |
|---|---|
| `Session.createSession` | 创建回放会话 |
| `Debugger.setBreakpoint` | 设置断点 |
| `Debugger.findStepTarget` | 查找单步目标 |
| `Pause.evaluateInFrame` | 在帧中求值表达式 |
| `Pause.getAllFrames` | 获取所有调用栈帧 |
| `Pause.getScope` | 获取作用域 |
| `Pause.getObjectPreview` | 获取对象预览 |
| `Analysis.createAnalysis` | 创建分析任务 |
| `Analysis.addLocation` | 添加分析位置 |
| `Analysis.runAnalysis` | 运行分析 |
| `Graphics.findPaints` | 查找绘制事件 |
| `Graphics.getPaintContents` | 获取绘制内容（截图） |
| `Recording.getSourceContents` | 获取源码内容 |
| `Console.findMessages` | 查找 Console 消息 |

### 10.4 通信流程

```
DevTools UI (浏览器)
    ↓ WebSocket
dispatch.replay.io (调度服务器)
    ↓ 路由到对应 Pod
Replay Chromium 实例 (Kubernetes Pod)
    ↓ 确定性重放
返回状态数据
```

## 11. 整体数据流

```
用户操作（点击断点/hover 变量/拖拽时间线）
    ↓
React 组件触发 Suspense Cache 读取
    ↓
Cache miss → 通过 protocol 层发送 WebSocket 请求
    ↓
dispatch.replay.io 路由到回放 Pod
    ↓
Replay Chromium 执行到目标执行点
    ↓
通过 CDP 协议返回数据
    ↓
Suspense Cache 填充 → React 重新渲染
    ↓
UI 更新（显示变量值/执行次数/截图等）
```

## 12. 对 replay-viewer 的启示

### 12.1 可复用的架构模式

1. **Suspense Cache 模式** — 数据获取与 UI 解耦，适合异步数据密集型应用
2. **Protocol 抽象层** — 将通信协议封装为独立包，便于替换后端
3. **面板化布局** — react-resizable-panels 实现灵活的面板布局

### 12.2 可参考的组件

- 源码编辑器（CodeMirror + 行装饰器）
- 变量检查器（树形展开 + 懒加载）
- Console 面板（消息过滤 + 执行点关联）
- Timeline（时间线 + 截图预览）

### 12.3 关键差异

Replay.io DevTools 依赖云端回放引擎，我们的 replay-viewer 需要：
- 本地数据源替代 WebSocket 协议
- 从 .v8rec 文件读取数据替代 CDP 协议
- 可能需要简化的 Suspense Cache（数据量更小）