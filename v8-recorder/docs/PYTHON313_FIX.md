# Python 3.13 兼容性问题修复

## 问题描述

在 Python 3.13+ 中运行 `./build.sh` 时会遇到以下错误：

```
ModuleNotFoundError: No module named 'pipes'
```

这是因为 Python 3.13 移除了 `pipes` 模块（该模块在 Python 3.11 中已被标记为废弃）。

## 解决方案

### 方案 1: 自动修复（推荐）

修复已经集成到 `setup.sh` 中，会自动检测 Python 版本并应用修复。

如果你已经运行过 `setup.sh`，只需重新运行：

```bash
./setup.sh
```

### 方案 2: 手动修复

如果自动修复失败，可以手动运行修复脚本：

```bash
./fix-python313.sh
```

### 方案 3: 手动编辑文件

编辑 `v8-workspace/v8/tools/mb/mb.py`，找到：

```python
import pipes
```

替换为：

```python
try:
    import pipes
except ImportError:
    # Python 3.13+ removed pipes module, use shlex instead
    import shlex
    class pipes:
        quote = shlex.quote
```

## 验证修复

运行以下命令验证修复是否成功：

```bash
cd v8-workspace/v8
python3 tools/dev/v8gen.py --help
```

如果显示帮助信息，说明修复成功。

## 为什么会出现这个问题？

- Python 3.11: `pipes` 模块被标记为 deprecated
- Python 3.12: `pipes` 模块仍然可用，但会显示警告
- Python 3.13: `pipes` 模块被完全移除

V8 的构建工具 `mb.py` 还在使用这个已废弃的模块，导致在 Python 3.13+ 上无法运行。

## 替代方案

`pipes.quote()` 的功能可以用 `shlex.quote()` 替代，两者功能完全相同。

## 其他可能受影响的文件

如果遇到其他文件的类似问题，可以使用相同的修复方法：

```bash
# 搜索所有使用 pipes 的文件
grep -r "import pipes" v8-workspace/v8/tools/
```

## 相关链接

- [Python 3.13 Release Notes](https://docs.python.org/3.13/whatsnew/3.13.html)
- [pipes module deprecation](https://docs.python.org/3.11/library/pipes.html)
- [shlex.quote documentation](https://docs.python.org/3/library/shlex.html#shlex.quote)

## 检查你的 Python 版本

```bash
python3 --version
```

如果版本是 3.13 或更高，需要应用此修复。

## 编译状态

修复后，你应该能看到类似的编译输出：

```
=========================================
Building V8 with Recorder
=========================================
Generating build files...
Compiling V8 (this will take 30-60 minutes)...
ninja: Entering directory `out.gn/x64.release'
[1/5182] STAMP clang_arm64_v8_x64/obj/v8_tracing.stamp
[2/5182] STAMP clang_arm64_v8_x64/obj/v8_version.stamp
...
```

编译过程需要 30-60 分钟，请耐心等待。
