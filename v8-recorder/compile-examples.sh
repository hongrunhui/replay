#!/bin/bash
# 编译示例程序

set -e

echo "Compiling examples..."

V8_DIR="v8-workspace/v8"
OUT_DIR="$V8_DIR/out.gn/x64.release"

# 编译 simple 示例
echo "Compiling simple.cc..."
g++ -std=c++17 \
  -I$V8_DIR \
  -I$V8_DIR/include \
  examples/simple.cc \
  -o simple \
  -L$OUT_DIR/obj \
  -lv8_monolith \
  -pthread \
  -ldl

# 编译 fibonacci 示例
echo "Compiling fibonacci.cc..."
g++ -std=c++17 \
  -I$V8_DIR \
  -I$V8_DIR/include \
  examples/fibonacci.cc \
  -o fibonacci \
  -L$OUT_DIR/obj \
  -lv8_monolith \
  -pthread \
  -ldl

# 编译 replay 示例
echo "Compiling replay.cc..."
g++ -std=c++17 \
  -I$V8_DIR \
  -I$V8_DIR/include \
  examples/replay.cc \
  -o replay \
  -L$OUT_DIR/obj \
  -lv8_monolith \
  -pthread \
  -ldl

echo "========================================="
echo "Examples compiled successfully!"
echo "========================================="
echo ""
echo "Run examples:"
echo "  ./simple      - Simple recording example"
echo "  ./fibonacci   - Fibonacci with recording"
echo "  ./replay <file> - Replay a recording file"
echo ""
echo "Output files:"
echo "  simple.rec    - Recording from simple example"
echo "  fibonacci.rec - Recording from fibonacci example"
echo ""
echo "Analyze recordings:"
echo "  python3 analyze.py simple.rec"
echo "  python3 analyze.py fibonacci.rec --trace"
echo ""
