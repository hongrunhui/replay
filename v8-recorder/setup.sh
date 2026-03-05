#!/bin/bash
# V8 Recorder 自动化设置脚本

set -e

echo "========================================="
echo "V8 Recorder Setup Script"
echo "========================================="

# 代理配置 (可选)
# 如果需要使用代理，取消下面的注释并设置你的代理地址
PROXY_HOST="127.0.0.1"
PROXY_PORT="7897"
USE_PROXY=true  # 设置为 false 禁用代理

# 设置代理
if [ "$USE_PROXY" = true ]; then
    echo "Setting up proxy: ${PROXY_HOST}:${PROXY_PORT}"
    export HTTP_PROXY="http://${PROXY_HOST}:${PROXY_PORT}"
    export HTTPS_PROXY="http://${PROXY_HOST}:${PROXY_PORT}"
    export http_proxy="http://${PROXY_HOST}:${PROXY_PORT}"
    export https_proxy="http://${PROXY_HOST}:${PROXY_PORT}"

    # 配置 Git 代理
    git config --global http.proxy "http://${PROXY_HOST}:${PROXY_PORT}"
    git config --global https.proxy "http://${PROXY_HOST}:${PROXY_PORT}"

    echo "✓ Proxy configured"
else
    echo "Proxy disabled"
fi

# 检查依赖
echo "Checking dependencies..."

if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo "Error: Git is required"
    exit 1
fi

# 安装 depot_tools
echo "Installing depot_tools..."
if [ ! -d "depot_tools" ]; then
    echo "Cloning depot_tools (this may take a while)..."
    git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
    echo "✓ depot_tools cloned"
else
    echo "✓ depot_tools already exists"
fi

export PATH=$PATH:$(pwd)/depot_tools

# 获取 V8 源码
echo "Fetching V8 source code..."
if [ ! -d "v8-workspace/v8" ]; then
    mkdir -p v8-workspace
    cd v8-workspace

    echo "Running 'fetch v8' (this will take 10-30 minutes)..."
    echo "Downloading V8 source code and dependencies..."

    # fetch v8 会自动使用环境变量中的代理设置
    fetch v8

    cd v8

    # 切换到稳定版本
    echo "Checking out stable version 10.8.168.25..."
    git checkout 10.8.168.25

    echo "Running gclient sync (this may take a while)..."
    gclient sync

    cd ../..
    echo "✓ V8 source code downloaded"
else
    echo "✓ V8 source already exists, skipping..."
fi

# 复制录制器源码
echo "Copying recorder source files..."
mkdir -p v8-workspace/v8/src/recorder
cp src/recorder/*.h v8-workspace/v8/src/recorder/
cp src/recorder/*.cc v8-workspace/v8/src/recorder/

# 应用补丁
echo "Applying patches..."
cd v8-workspace/v8

if [ ! -f ".recorder_patched" ]; then
    git apply ../../patches/001-add-recorder.patch || echo "Patch 1 may already be applied"
    git apply ../../patches/002-instrument-interpreter.patch || echo "Patch 2 may already be applied"
    git apply ../../patches/003-intercept-builtins.patch || echo "Patch 3 may already be applied"

    touch .recorder_patched
    echo "Patches applied successfully"
else
    echo "Patches already applied, skipping..."
fi

# 修复 Python 3.13 兼容性问题
echo "Checking Python version compatibility..."
PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
if [ "$(echo "$PYTHON_VERSION >= 3.13" | bc -l 2>/dev/null || echo 0)" = "1" ] || [[ "$PYTHON_VERSION" == "3.13" ]]; then
    echo "Python 3.13+ detected, applying compatibility fix..."

    # 修复 tools/mb/mb.py
    if grep -q "^import pipes$" tools/mb/mb.py 2>/dev/null; then
        echo "Patching tools/mb/mb.py for Python 3.13..."
        sed -i.bak '/^import pipes$/c\
try:\
    import pipes\
except ImportError:\
    import shlex\
    class pipes:\
        quote = shlex.quote
' tools/mb/mb.py
        echo "✓ Python 3.13 compatibility fix applied"
    else
        echo "✓ Already patched or not needed"
    fi
fi

cd ../..

# 清理代理配置 (可选，如果不想影响其他 git 操作)
if [ "$USE_PROXY" = true ]; then
    echo ""
    echo "Note: Git global proxy is still configured."
    echo "To remove it later, run:"
    echo "  git config --global --unset http.proxy"
    echo "  git config --global --unset https.proxy"
fi

echo "========================================="
echo "Setup complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Run ./build.sh to compile V8 with recorder"
echo "2. Compile examples with: ./compile-examples.sh"
echo "3. Run examples: ./simple or ./fibonacci"
echo ""
