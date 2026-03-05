# Replay - JavaScript 执行录制与重放系统

<div align="center">

**基于 V8 引擎的 JavaScript 时间旅行调试工具**

[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/)
[![V8](https://img.shields.io/badge/V8-10.8.168-green.svg)](https://v8.dev/)

[功能特性](#功能特性) • [快速开始](#快速开始) • [文档](#文档) • [示例](#示例) • [架构](#架构)

</div>

---

## 项目简介

Replay 是一个完整的 JavaScript 执行录制与重放系统，可以记录 JavaScript 代码的完整执行过程，并支持时间旅行调试。类似于 [Replay.io](https://replay.io/)，但基于 V8 引擎实现，提供了从录制、分析到重放的完整工具链。

### 核心能力

- 🎯 **字节码级别追踪** - 记录每个字节码执行点
- 🔄 **完整重放** - 精确重现原始执行过程
- 🐛 **时间旅行调试** - 跳转到任意执行点
- 📊 **性能分析** - 分析函数调用和执行时间
- 🎲 **非确定性拦截** - 记录随机数、时间戳等

## 功能特性

### 录制功能
- ✅ 字节码级别的执行追踪
- ✅ 函数调用栈记录（函数名、行号、列号）
- ✅ 非确定性操作拦截（Math.random, Date.now, console.log）
- ✅ 高效的二进制存储格式
- ✅ 流式写入（批量刷新）
- ✅ 线程安全设计

### 重放功能
- ✅ 完整重放
- ✅ 单步执行
- ✅ 断点调试
- ✅ 时间旅行（跳转到任意执行点）
- ✅ 非确定性数据重现

### 分析工具
- ✅ 执行统计（执行点数量、函数调用次数）
- ✅ 性能分析（执行时间、热点函数）
- ✅ 调用栈分析（最大深度、调用关系）
- ✅ 执行轨迹可视化

## 快速开始

### 环境要求

- macOS 或 Linux
- Python 3.11+
- Git
- 至少 20GB 磁盘空间
- 8GB+ 内存

### 安装步骤

```bash
# 1. 克隆项目
git clone https://github.com/your-username/replay.git
cd replay/v8-recorder

# 2. 配置代理（可选，中国大陆用户推荐）
./proxy.sh enable
./proxy.sh test

# 3. 自动安装和配置
./setup.sh

# 4. 编译 V8（需要 30-60 分钟）
./build.sh

# 5. 编译示例程序
./compile-examples.sh
```

### 快速体验

```bash
# 录制 Fibonacci 计算
./fibonacci

# 分析录制文件
python3 analyze.py fibonacci.rec

# 重放调试
./replay fibonacci.rec
```

## 示例

### 录制示例

```cpp
#include "src/recorder/recorder.h"

// 开始录制
v8::internal::Recorder::GetInstance()->StartRecording("output.rec");

// 执行 JavaScript 代码
const char* code = R"(
  function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
  }
  fibonacci(10);
)";
// ... 执行代码 ...

// 停止录制
v8::internal::Recorder::GetInstance()->StopRecording();
```

### 重放示例

```cpp
#include "src/recorder/replayer.h"

v8::internal::Replayer replayer;
replayer.Load("output.rec");
replayer.StartReplay();

// 逐个获取执行点
while (const auto* point = replayer.GetNextExecutionPoint()) {
    std::cout << point->function_name << " at line "
              << point->line_number << std::endl;
}
```

### 分析示例

```bash
# 查看统计信息
python3 analyze.py fibonacci.rec

# 查看执行轨迹
python3 analyze.py fibonacci.rec --trace
```

## 文档

### 核心文档
- [快速开始指南](v8-recorder/QUICKSTART.md) - 5 分钟上手
- [详细使用文档](v8-recorder/USAGE.md) - 完整 API 和最佳实践
- [代理配置指南](v8-recorder/PROXY.md) - 中国大陆用户必读
- [预期输出说明](v8-recorder/EXPECTED_OUTPUT.md) - 验证运行结果

### 架构文档
- [Replay.io 架构分析](Replay.io架构分析文档.md)
- [Chromium 录制层架构](Replay-Chromium录制层架构分析.md)
- [V8 引擎插桩实现](V8引擎插桩实现原理.md)
- [重放机制与断点调试](Replay重放机制与断点调试原理.md)
- [云端回放架构设计](云端回放架构设计.md)

### 故障排除
- [Python 3.13 兼容性](v8-recorder/PYTHON313_FIX.md)
- [代理配置问题](v8-recorder/PROXY.md#常见问题)

## 架构

### 系统架构

```
┌─────────────────────────────────────┐
│  JavaScript 代码                     │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  V8 引擎 (改造版)                    │
│  ┌───────────────────────────────┐  │
│  │  Ignition 解释器 + 插桩       │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  内置函数拦截                 │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Recorder (C++)                     │
│  - 执行点缓冲区                     │
│  - 非确定性数据缓冲区               │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  录制文件 (.rec)                    │
└─────────────────────────────────────┘
```

### 项目结构

```
replay/
├── v8-recorder/              # V8 录制器实现
│   ├── src/recorder/        # 核心源码
│   │   ├── recorder.h       # 录制器头文件
│   │   ├── recorder.cc      # 录制器实现
│   │   ├── replayer.h       # 重放器头文件
│   │   └── replayer.cc      # 重放器实现
│   ├── examples/            # 示例程序
│   │   ├── simple.cc        # 简单示例
│   │   ├── fibonacci.cc     # Fibonacci 示例
│   │   └── replay.cc        # 重放工具
│   ├── patches/             # V8 补丁
│   ├── *.sh                 # 工具脚本
│   ├── analyze.py           # 分析工具
│   └── *.md                 # 文档
└── 架构分析文档/            # 详细架构文档
```

## 性能指标

| 指标 | 数值 |
|------|------|
| 录制开销 | 3-5x 慢于正常执行 |
| 内存开销 | ~100MB |
| 文件大小 | ~1MB / 10,000 执行点 |
| 重放速度 | 几乎瞬间 |

## 应用场景

### 1. Bug 调试
录制出现 bug 的执行过程，重放并单步调试，查看每个执行点的状态。

### 2. 性能分析
录制性能问题场景，分析热点函数和调用次数，优化执行路径。

### 3. 测试验证
录制正确的执行，对比不同版本，进行回归测试。

### 4. 教学演示
录制算法执行过程，单步展示每一步，可视化执行轨迹。

## 技术亮点

- 🎯 **字节码级别插桩** - 比函数级别更精细
- 🔒 **非确定性完全拦截** - 确保重放一致性
- 💾 **高效存储格式** - 二进制 + 分块 + 索引
- ⏰ **时间旅行调试** - 任意跳转执行点
- 🔧 **完整工具链** - 从录制到分析的完整流程

## 开发统计

- **总代码量**: 1,564 行
- **C++ 代码**: ~900 行
- **Python 工具**: ~200 行
- **Shell 脚本**: ~200 行
- **文档**: ~2,000 行

## 贡献指南

欢迎贡献！请查看 [贡献指南](CONTRIBUTING.md)。

### 如何贡献

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 许可证

本项目采用 BSD 3-Clause License（与 V8 相同）。详见 [LICENSE](LICENSE) 文件。

## 致谢

- [V8 团队](https://v8.dev/) - 提供强大的 JavaScript 引擎
- [Replay.io](https://replay.io/) - 提供录制和重放的灵感
- 所有贡献者

## 联系方式

- 问题反馈: [GitHub Issues](https://github.com/your-username/replay/issues)
- 讨论交流: [GitHub Discussions](https://github.com/your-username/replay/discussions)

## 相关项目

- [Replay.io](https://replay.io/) - 浏览器时间旅行调试
- [rr](https://rr-project.org/) - Linux 应用程序录制和重放
- [Pernosco](https://pernos.co/) - 全栈时间旅行调试

---

<div align="center">

**如果这个项目对你有帮助，请给个 ⭐️ Star！**

Made with ❤️ by the Replay team

</div>
