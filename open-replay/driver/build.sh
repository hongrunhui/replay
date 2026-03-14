#!/bin/bash
# Open Replay Driver — Build Script
# Builds libopenreplay.dylib (macOS) or libopenreplay.so (Linux)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
BUILD_DIR="$SCRIPT_DIR/build"
CXX="${CXX:-clang++}"
CXXFLAGS="-std=c++17 -O2 -Wall -Wextra -Wno-unused-parameter -fPIC"

mkdir -p "$BUILD_DIR"

SOURCES=(
  "$SRC_DIR/driver.cc"
  "$SRC_DIR/raw_syscall.cc"
  "$SRC_DIR/format/recording.cc"
  "$SRC_DIR/checkpoint/checkpoint.cc"
  "$SRC_DIR/intercept/time.cc"
  "$SRC_DIR/intercept/random.cc"
  "$SRC_DIR/intercept/fs.cc"
  "$SRC_DIR/intercept/net.cc"
  "$SRC_DIR/intercept/thread.cc"
)

echo "=== Building Open Replay Driver ==="
echo "Compiler: $CXX"
echo "Platform: $(uname -s) $(uname -m)"

if [[ "$(uname -s)" == "Darwin" ]]; then
  # macOS: build .dylib
  OUTPUT="$BUILD_DIR/libopenreplay.dylib"
  echo "Building $OUTPUT ..."
  $CXX $CXXFLAGS \
    -shared -dynamiclib \
    -install_name @rpath/libopenreplay.dylib \
    -I"$SRC_DIR" \
    "${SOURCES[@]}" \
    -ldl \
    -o "$OUTPUT"
else
  # Linux: build .so
  OUTPUT="$BUILD_DIR/libopenreplay.so"
  echo "Building $OUTPUT ..."
  $CXX $CXXFLAGS \
    -shared \
    -I"$SRC_DIR" \
    "${SOURCES[@]}" \
    -ldl -lpthread \
    -o "$OUTPUT"
fi

echo "Built: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"

# Build test
echo ""
echo "=== Building Tests ==="
TEST_OUTPUT="$BUILD_DIR/test_driver"
$CXX $CXXFLAGS \
  -I"$SRC_DIR" \
  "$SCRIPT_DIR/tests/test_driver.cc" \
  -L"$BUILD_DIR" -lopenreplay \
  -Wl,-rpath,"$BUILD_DIR" \
  -o "$TEST_OUTPUT"

echo "Built: $TEST_OUTPUT"
echo ""
echo "=== Build Complete ==="
echo ""
echo "Usage:"
echo "  # Run tests"
echo "  $BUILD_DIR/test_driver"
echo ""
echo "  # Record a Node.js script"
echo "  OPENREPLAY_MODE=record DYLD_INSERT_LIBRARIES=$OUTPUT node script.js"
echo ""
echo "  # Replay"
echo "  OPENREPLAY_MODE=replay REPLAY_RECORDING=<path> DYLD_INSERT_LIBRARIES=$OUTPUT node script.js"
