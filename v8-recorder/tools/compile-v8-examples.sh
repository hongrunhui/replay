#!/bin/bash
# Compile examples — new platform-level recording architecture

set -e

echo "Compiling examples..."

V8_DIR="v8-workspace/v8"
OUT_DIR="$V8_DIR/out.gn/x64.release"
SRC_FILES="src/recording/event_log.cc src/platform/recording_platform.cc src/platform/replay_platform.cc"

# Common flags
CXX_FLAGS="-std=c++17 -I$V8_DIR -I$V8_DIR/include -I."
LD_FLAGS="-L$OUT_DIR/obj -lv8_monolith -pthread -ldl"

# Compile record example
echo "Compiling record.cc..."
g++ $CXX_FLAGS \
  examples/record.cc $SRC_FILES \
  -o record \
  $LD_FLAGS

# Compile replay example
echo "Compiling replay.cc..."
g++ $CXX_FLAGS \
  examples/replay.cc $SRC_FILES \
  -o replay \
  $LD_FLAGS

# Compile time_travel example
echo "Compiling time_travel.cc..."
g++ $CXX_FLAGS \
  examples/time_travel.cc $SRC_FILES \
  -o time_travel \
  $LD_FLAGS

echo "========================================="
echo "Examples compiled successfully!"
echo "========================================="
echo ""
echo "Run examples:"
echo "  ./record [output.v8rec]     - Record a session"
echo "  ./replay <file.v8rec>       - Replay a recording"
echo "  ./time_travel <file.v8rec>  - Time-travel determinism demo"
echo ""
echo "Workflow:"
echo "  1. ./record output.v8rec"
echo "  2. ./replay output.v8rec"
echo "  3. ./time_travel output.v8rec"
echo ""
echo "Analyze recordings:"
echo "  python3 analyze.py output.v8rec"
echo ""
