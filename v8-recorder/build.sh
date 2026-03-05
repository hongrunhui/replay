#!/bin/bash
# V8 Recorder 编译脚本

set -e

echo "========================================="
echo "Building V8 with Recorder"
echo "========================================="

cd v8-workspace/v8

# 生成构建文件
echo "Generating build files..."
tools/dev/v8gen.py x64.release

# 编译（这会花费 30-60 分钟）
echo "Compiling V8 (this will take 30-60 minutes)..."
echo "You can monitor progress in another terminal with:"
echo "  watch -n 5 'ls -lh out.gn/x64.release/obj/*.a | wc -l'"

ninja -C out.gn/x64.release -j $(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

echo "========================================="
echo "Build complete!"
echo "========================================="
echo ""
echo "V8 library location:"
echo "  v8-workspace/v8/out.gn/x64.release/obj/libv8_monolith.a"
echo ""
echo "Next: Compile examples with ./compile-examples.sh"
echo ""
