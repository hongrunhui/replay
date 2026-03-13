#!/bin/bash
# Build the v8-recorder interception library and examples
# New architecture: libc-level interception via DYLD_INSERT_LIBRARIES/LD_PRELOAD

set -e

echo "========================================="
echo "Building v8-recorder (libc interception)"
echo "========================================="

SRC_DIR="src"
OUT_DIR="build"
mkdir -p "$OUT_DIR"

CXX="${CXX:-clang++}"
CXXFLAGS="-std=c++17 -O2 -Wall -I."

OS=$(uname -s)

# ============================================================
# 1. Build the interception shared library
# ============================================================
echo ""
echo "--- Building interception library ---"

INTERCEPT_SRCS="$SRC_DIR/recording/recording_stream.cc $SRC_DIR/intercept/intercept.cc"

if [ "$OS" = "Darwin" ]; then
  LIB_NAME="libv8recorder.dylib"
  $CXX $CXXFLAGS -shared -fPIC \
    -dynamiclib -install_name @rpath/$LIB_NAME \
    $INTERCEPT_SRCS \
    -ldl \
    -o "$OUT_DIR/$LIB_NAME"
  echo "Built: $OUT_DIR/$LIB_NAME"
else
  LIB_NAME="libv8recorder.so"
  $CXX $CXXFLAGS -shared -fPIC \
    $INTERCEPT_SRCS \
    -ldl \
    -o "$OUT_DIR/$LIB_NAME"
  echo "Built: $OUT_DIR/$LIB_NAME"
fi

# ============================================================
# 2. Build standalone test program (no V8 dependency)
# ============================================================
echo ""
echo "--- Building standalone test ---"

cat > "$OUT_DIR/test_intercept.cc" << 'TESTEOF'
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <sys/time.h>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>

int main() {
  printf("=== v8-recorder interception test ===\n\n");

  // Test gettimeofday
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  printf("gettimeofday: %ld.%06d\n", (long)tv.tv_sec, (int)tv.tv_usec);

  // Test time()
  time_t t = time(nullptr);
  printf("time(): %ld\n", (long)t);

  // Test clock_gettime
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  printf("clock_gettime: %ld.%09ld\n", (long)ts.tv_sec, ts.tv_nsec);

  // Test arc4random
  uint32_t r1 = arc4random();
  uint32_t r2 = arc4random();
  printf("arc4random: %u, %u\n", r1, r2);

  // Test read (from /dev/null)
  char buf[16];
  int fd = open("/dev/null", O_RDONLY);
  if (fd >= 0) {
    ssize_t n = read(fd, buf, sizeof(buf));
    printf("read(/dev/null): %zd bytes\n", n);
    close(fd);
  }

  // Test stat
  struct stat st;
  if (stat("/tmp", &st) == 0) {
    printf("stat(/tmp): size=%lld mode=%o\n", (long long)st.st_size, st.st_mode & 0777);
  }

  printf("\n=== Done ===\n");
  return 0;
}
TESTEOF

$CXX -std=c++17 -O2 "$OUT_DIR/test_intercept.cc" -o "$OUT_DIR/test_intercept"
echo "Built: $OUT_DIR/test_intercept"

echo ""
echo "========================================="
echo "Build complete!"
echo "========================================="
echo ""
echo "Usage:"
echo ""
if [ "$OS" = "Darwin" ]; then
  echo "  # Record a program:"
  echo "  V8_RECORDER_MODE=record V8_RECORDER_FILE=output.v8rec \\"
  echo "    DYLD_INSERT_LIBRARIES=$OUT_DIR/$LIB_NAME \\"
  echo "    ./$OUT_DIR/test_intercept"
  echo ""
  echo "  # Replay:"
  echo "  V8_RECORDER_MODE=replay V8_RECORDER_FILE=output.v8rec \\"
  echo "    DYLD_INSERT_LIBRARIES=$OUT_DIR/$LIB_NAME \\"
  echo "    ./$OUT_DIR/test_intercept"
else
  echo "  # Record a program:"
  echo "  V8_RECORDER_MODE=record V8_RECORDER_FILE=output.v8rec \\"
  echo "    LD_PRELOAD=$OUT_DIR/$LIB_NAME \\"
  echo "    ./$OUT_DIR/test_intercept"
  echo ""
  echo "  # Replay:"
  echo "  V8_RECORDER_MODE=replay V8_RECORDER_FILE=output.v8rec \\"
  echo "    LD_PRELOAD=$OUT_DIR/$LIB_NAME \\"
  echo "    ./$OUT_DIR/test_intercept"
fi
echo ""
echo "  # Record Node.js:"
if [ "$OS" = "Darwin" ]; then
  echo "  V8_RECORDER_MODE=record V8_RECORDER_FILE=node.v8rec \\"
  echo "    DYLD_INSERT_LIBRARIES=$OUT_DIR/$LIB_NAME \\"
  echo "    node your_script.js"
else
  echo "  V8_RECORDER_MODE=record V8_RECORDER_FILE=node.v8rec \\"
  echo "    LD_PRELOAD=$OUT_DIR/$LIB_NAME \\"
  echo "    node your_script.js"
fi
echo ""
echo "  # Analyze recording:"
echo "  python3 tools/analyze.py output.v8rec"
echo ""
