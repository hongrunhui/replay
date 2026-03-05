#!/bin/bash
# Python 3.13 兼容性修复脚本

set -e

echo "========================================="
echo "Python 3.13 Compatibility Fix"
echo "========================================="

# 检查 Python 版本
PYTHON_VERSION=$(python3 --version | awk '{print $2}')
echo "Detected Python version: $PYTHON_VERSION"

# 检查是否是 Python 3.13+
MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

if [ "$MAJOR" -eq 3 ] && [ "$MINOR" -ge 13 ]; then
    echo "Python 3.13+ detected, applying fixes..."

    # 修复 tools/mb/mb.py
    MB_FILE="v8-workspace/v8/tools/mb/mb.py"

    if [ -f "$MB_FILE" ]; then
        echo "Fixing $MB_FILE..."

        # 备份原文件
        cp "$MB_FILE" "${MB_FILE}.bak"

        # 替换 import pipes
        python3 << 'EOF'
import sys

file_path = "v8-workspace/v8/tools/mb/mb.py"

with open(file_path, 'r') as f:
    content = f.read()

# 替换 import pipes
old_import = "import pipes"
new_import = """try:
    import pipes
except ImportError:
    # Python 3.13+ removed pipes module, use shlex instead
    import shlex
    class pipes:
        quote = shlex.quote"""

if old_import in content and "try:" not in content.split(old_import)[0][-50:]:
    content = content.replace(old_import, new_import)
    with open(file_path, 'w') as f:
        f.write(content)
    print("✓ Successfully patched mb.py")
else:
    print("✓ mb.py already patched or doesn't need patching")
EOF

        echo "✓ Fix applied to $MB_FILE"
    else
        echo "✗ File not found: $MB_FILE"
        echo "  Please run ./setup.sh first"
        exit 1
    fi

    # 检查其他可能需要修复的文件
    echo ""
    echo "Checking for other files that might need fixing..."

    # 搜索其他使用 pipes 的文件
    if [ -d "v8-workspace/v8" ]; then
        echo "Searching for other files using 'import pipes'..."
        grep -r "^import pipes$" v8-workspace/v8/tools/ 2>/dev/null | grep -v ".pyc" | grep -v ".bak" || echo "No other files found"
    fi

    echo ""
    echo "========================================="
    echo "Fix completed!"
    echo "========================================="
    echo ""
    echo "You can now run: ./build.sh"

elif [ "$MAJOR" -eq 3 ] && [ "$MINOR" -lt 13 ]; then
    echo "Python $PYTHON_VERSION is compatible, no fix needed."
    echo "The 'pipes' module is available in Python < 3.13"
else
    echo "Unexpected Python version: $PYTHON_VERSION"
    echo "This script is designed for Python 3.x"
fi
