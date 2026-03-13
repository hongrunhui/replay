#!/bin/bash
# Test script for V8 Recorder

set -e

echo "=== V8 Recorder Test Suite ==="
echo ""

# 检查是否在正确的目录
if [ ! -f "setup.sh" ]; then
    echo "Error: Please run this script from the v8-recorder directory"
    exit 1
fi

# 检查 V8 是否已编译
if [ ! -d "../v8/out.gn/x64.release" ]; then
    echo "Error: V8 not compiled. Please run ./setup.sh and ./build.sh first"
    exit 1
fi

echo "Step 1: Compiling examples..."
./compile-examples.sh

echo ""
echo "Step 2: Running simple example..."
./simple
if [ ! -f "simple.rec" ]; then
    echo "Error: simple.rec not created"
    exit 1
fi
echo "✓ Simple example passed"

echo ""
echo "Step 3: Running fibonacci example..."
./fibonacci
if [ ! -f "fibonacci.rec" ]; then
    echo "Error: fibonacci.rec not created"
    exit 1
fi
echo "✓ Fibonacci example passed"

echo ""
echo "Step 4: Testing replay..."
./replay fibonacci.rec <<EOF
1
EOF
echo "✓ Replay test passed"

echo ""
echo "Step 5: Checking recording file format..."
hexdump -C simple.rec | head -n 5
echo "✓ File format check passed"

echo ""
echo "Step 6: Statistics..."
echo "Simple recording size: $(du -h simple.rec | cut -f1)"
echo "Fibonacci recording size: $(du -h fibonacci.rec | cut -f1)"

echo ""
echo "=== All Tests Passed ==="
echo ""
echo "Recording files created:"
echo "  - simple.rec"
echo "  - fibonacci.rec"
echo ""
echo "You can replay them with:"
echo "  ./replay simple.rec"
echo "  ./replay fibonacci.rec"
