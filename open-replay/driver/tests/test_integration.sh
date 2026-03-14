#!/bin/bash
# Integration test: Record a Node.js script and verify the recording
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DRIVER_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$DRIVER_DIR/build"
DRIVER="$BUILD_DIR/libopenreplay.dylib"
TEST_SCRIPT="$SCRIPT_DIR/test_node_record.js"
REC_DIR="/tmp/openreplay_integration_test"

# Clean up
rm -rf "$REC_DIR"
mkdir -p "$REC_DIR"

echo "=== Open Replay Integration Test ==="
echo "Driver: $DRIVER"
echo "Script: $TEST_SCRIPT"
echo ""

# Check driver exists
if [ ! -f "$DRIVER" ]; then
  echo "ERROR: Driver not found. Run: cd driver && bash build.sh"
  exit 1
fi

# Record
echo "--- Recording ---"
OPENREPLAY_MODE=record \
  DYLD_INSERT_LIBRARIES="$DRIVER" \
  node "$TEST_SCRIPT" 2>"$REC_DIR/record_stderr.log"

echo ""
echo "--- Recording stderr ---"
cat "$REC_DIR/record_stderr.log"

# Find the recording file
REC_FILE=$(find ~/.openreplay/recordings -name "*.orec" -newer "$REC_DIR/record_stderr.log" 2>/dev/null | head -1)

if [ -z "$REC_FILE" ]; then
  echo ""
  echo "ERROR: No recording file found!"
  exit 1
fi

echo ""
echo "--- Recording file ---"
echo "Path: $REC_FILE"
echo "Size: $(du -h "$REC_FILE" | cut -f1)"

# Verify file header
MAGIC=$(head -c 8 "$REC_FILE")
if [ "$MAGIC" = "OREC0001" ]; then
  echo "Magic: OK (OREC0001)"
else
  echo "Magic: FAIL (got: $MAGIC)"
  exit 1
fi

echo ""
echo "=== Integration Test PASSED ==="

# Cleanup
rm -rf "$REC_DIR"
