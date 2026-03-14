#!/bin/bash
# v8-recorder: build & record JS execution
# Usage:
#   ./record.sh <script.js> [output.v8rec]   Record a JS file
#   ./record.sh --build                       Only build the library
#   ./record.sh --test                        Build and run standalone test

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

SRC_DIR="src"
BUILD_DIR="build"
OUT_DIR="tests/output"
CXX="${CXX:-clang++}"
CXXFLAGS="-std=c++17 -O2 -Wall -I."
OS=$(uname -s)

if [ "$OS" = "Darwin" ]; then
  LIB_NAME="libv8recorder.dylib"
else
  LIB_NAME="libv8recorder.so"
fi
LIB="$BUILD_DIR/$LIB_NAME"

# ============================================================
# Build the interception shared library (if needed)
# ============================================================
build_lib() {
  mkdir -p "$BUILD_DIR"

  local SRCS="$SRC_DIR/recording/recording_stream.cc $SRC_DIR/intercept/intercept.cc"

  if [ "$OS" = "Darwin" ]; then
    $CXX $CXXFLAGS -shared -fPIC \
      -dynamiclib -install_name @rpath/$LIB_NAME \
      $SRCS -ldl -o "$LIB"
  else
    $CXX $CXXFLAGS -shared -fPIC \
      $SRCS -ldl -o "$LIB"
  fi
  echo "Built: $LIB"
}

# ============================================================
# Build standalone test program
# ============================================================
build_test() {
  build_lib

  cat > "$BUILD_DIR/test_intercept.cc" << 'TESTEOF'
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <sys/time.h>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>

int main() {
  printf("=== v8-recorder interception test ===\n\n");

  struct timeval tv;
  gettimeofday(&tv, nullptr);
  printf("gettimeofday: %ld.%06d\n", (long)tv.tv_sec, (int)tv.tv_usec);

  time_t t = time(nullptr);
  printf("time(): %ld\n", (long)t);

  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  printf("clock_gettime: %ld.%09ld\n", (long)ts.tv_sec, ts.tv_nsec);

  uint32_t r1 = arc4random();
  uint32_t r2 = arc4random();
  printf("arc4random: %u, %u\n", r1, r2);

  char buf[16];
  int fd = open("/dev/null", O_RDONLY);
  if (fd >= 0) {
    ssize_t n = read(fd, buf, sizeof(buf));
    printf("read(/dev/null): %zd bytes\n", n);
    close(fd);
  }

  struct stat st;
  if (stat("/tmp", &st) == 0) {
    printf("stat(/tmp): size=%lld mode=%o\n", (long long)st.st_size, st.st_mode & 0777);
  }

  printf("\n=== Done ===\n");
  return 0;
}
TESTEOF

  $CXX -std=c++17 -O2 "$BUILD_DIR/test_intercept.cc" -o "$BUILD_DIR/test_intercept"
  echo "Built: $BUILD_DIR/test_intercept"
}

# ============================================================
# Main
# ============================================================
case "${1:-}" in
  --build)
    build_lib
    exit 0
    ;;
  --test)
    build_test
    echo ""
    echo "Run standalone test:"
    if [ "$OS" = "Darwin" ]; then
      echo "  V8_RECORDER_MODE=record V8_RECORDER_FILE=test.v8rec DYLD_INSERT_LIBRARIES=$LIB ./$BUILD_DIR/test_intercept"
    else
      echo "  V8_RECORDER_MODE=record V8_RECORDER_FILE=test.v8rec LD_PRELOAD=$LIB ./$BUILD_DIR/test_intercept"
    fi
    exit 0
    ;;
  -h|--help|"")
    echo "Usage:"
    echo "  ./record.sh <script.js> [output.v8rec]   Record a JS file"
    echo "  ./record.sh --build                       Only build the library"
    echo "  ./record.sh --test                        Build standalone test"
    echo ""
    echo "Examples:"
    echo "  ./record.sh tests/demo4.js"
    echo "  ./record.sh tests/demo4.js my_output.v8rec"
    exit 0
    ;;
esac

JS_FILE="$1"
if [ ! -f "$JS_FILE" ]; then
  echo "Error: $JS_FILE not found"
  exit 1
fi

# Auto-build if library doesn't exist
if [ ! -f "$LIB" ]; then
  echo "Library not found, building..."
  build_lib
  echo ""
fi

mkdir -p "$OUT_DIR"

# Default output: tests/output/<basename>.v8rec
if [ -n "$2" ]; then
  OUTPUT="$2"
else
  BASENAME="$(basename "$JS_FILE" .js)"
  OUTPUT="$OUT_DIR/$BASENAME.v8rec"
fi

if [ "$OS" = "Darwin" ]; then
  INJECT="DYLD_INSERT_LIBRARIES=$LIB"
else
  INJECT="LD_PRELOAD=$LIB"
fi

env V8_RECORDER_MODE=record V8_RECORDER_FILE="$OUTPUT" \
  $INJECT \
  node "$JS_FILE"

echo ""
echo "Recording saved: $OUTPUT"
echo "Analyze: python3 tools/analyze.py $OUTPUT"
