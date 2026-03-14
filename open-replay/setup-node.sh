#!/bin/bash
# Open Replay — Setup Script
# Clones Node.js v20 LTS and applies V8 patches for record/replay instrumentation.
#
# Usage: bash setup-node.sh [--clone-only]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
NODE_DIR="$PROJECT_DIR/node"
PATCHES_DIR="$PROJECT_DIR/patches"

echo "=== Open Replay — Node.js Setup ==="
echo ""

# Step 1: Clone Node.js
if [ ! -d "$NODE_DIR" ]; then
  echo "--- Cloning Node.js v20.18.0 ---"
  echo "This will take a few minutes..."
  git clone --depth=1 --branch v20.18.0 https://github.com/nodejs/node.git "$NODE_DIR"
  echo "Clone complete."
else
  echo "Node.js already cloned at $NODE_DIR"
fi

if [ "$1" = "--clone-only" ]; then
  echo "Clone-only mode. Exiting."
  exit 0
fi

# Step 2: Apply V8 patches
echo ""
echo "--- Applying V8 patches ---"

V8_DIR="$NODE_DIR/deps/v8"

# 2.1 Bytecodes
echo "  Patching bytecodes.h..."
python3 "$PATCHES_DIR/apply_patches.py" \
  --file "$V8_DIR/src/interpreter/bytecodes.h" \
  --patch "$PATCHES_DIR/v8/bytecodes.patch"

# 2.2 Runtime functions
echo "  Patching runtime.h..."
python3 "$PATCHES_DIR/apply_patches.py" \
  --file "$V8_DIR/src/runtime/runtime.h" \
  --patch "$PATCHES_DIR/v8/runtime.patch"

# 2.3 External references
echo "  Patching external-reference.h/cc..."
python3 "$PATCHES_DIR/apply_patches.py" \
  --file "$V8_DIR/src/codegen/external-reference.h" \
  --patch "$PATCHES_DIR/v8/external-reference-h.patch"
python3 "$PATCHES_DIR/apply_patches.py" \
  --file "$V8_DIR/src/codegen/external-reference.cc" \
  --patch "$PATCHES_DIR/v8/external-reference-cc.patch"

# 2.4 Bytecode generator
echo "  Patching bytecode-generator.cc..."
python3 "$PATCHES_DIR/apply_patches.py" \
  --file "$V8_DIR/src/interpreter/bytecode-generator.cc" \
  --patch "$PATCHES_DIR/v8/bytecode-generator.patch"

# 2.5 Interpreter handlers
echo "  Patching interpreter-generator.cc..."
python3 "$PATCHES_DIR/apply_patches.py" \
  --file "$V8_DIR/src/interpreter/interpreter-generator.cc" \
  --patch "$PATCHES_DIR/v8/interpreter-generator.patch"

# 2.6 Baseline compiler
echo "  Patching baseline-compiler.cc..."
python3 "$PATCHES_DIR/apply_patches.py" \
  --file "$V8_DIR/src/baseline/baseline-compiler.cc" \
  --patch "$PATCHES_DIR/v8/baseline-compiler.patch"

# 2.7 TurboFan
echo "  Patching bytecode-graph-builder.cc..."
python3 "$PATCHES_DIR/apply_patches.py" \
  --file "$V8_DIR/src/compiler/bytecode-graph-builder.cc" \
  --patch "$PATCHES_DIR/v8/bytecode-graph-builder.patch"

# 2.8 Record/Replay API header
echo "  Adding replayio.h..."
cp "$PATCHES_DIR/v8/replayio.h" "$V8_DIR/include/replayio.h"

# 2.9 Runtime implementation
echo "  Adding runtime-recordreplay.cc..."
cp "$PATCHES_DIR/v8/runtime-recordreplay.cc" "$V8_DIR/src/runtime/runtime-recordreplay.cc"

echo ""
echo "--- Patches applied ---"
echo ""
echo "Next steps:"
echo "  cd $NODE_DIR"
echo "  ./configure"
echo "  make -j\$(nproc)"
