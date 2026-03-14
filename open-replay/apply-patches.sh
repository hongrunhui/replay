#!/bin/bash
# Open Replay — Apply V8 patches to Node.js v20
# Run from open-replay/ directory after cloning node/
set -e

NODE_DIR="$(cd "$(dirname "$0")" && pwd)/node"
V8="$NODE_DIR/deps/v8"
PATCHES="$(cd "$(dirname "$0")" && pwd)/patches"

if [ ! -d "$V8" ]; then
  echo "ERROR: Node.js not found at $NODE_DIR"
  echo "Run: git clone --depth=1 --branch v20.18.0 https://github.com/nodejs/node.git node"
  exit 1
fi

echo "=== Applying V8 patches ==="

# --- 1. Copy new files ---
echo "[1/8] Adding replayio.h..."
cp "$PATCHES/v8/replayio.h" "$V8/include/replayio.h"

echo "[2/8] Adding runtime-recordreplay.cc..."
cp "$PATCHES/v8/runtime-recordreplay.cc" "$V8/src/runtime/runtime-recordreplay.cc"

echo "[3/8] Adding node-recordreplay.cc..."
cp "$PATCHES/node/node-recordreplay.cc" "$NODE_DIR/src/node_recordreplay.cc"

echo "[4/8] Adding JS runtime..."
mkdir -p "$NODE_DIR/lib/internal/recordreplay"
cp "$PATCHES/node/lib-recordreplay-main.js" "$NODE_DIR/lib/internal/recordreplay/main.js"

# --- 2. Patch bytecodes.h ---
echo "[5/8] Patching bytecodes.h..."
BYTECODES="$V8/src/interpreter/bytecodes.h"
# Find IncBlockCounter line and insert after it
python3 -c "
import re
with open('$BYTECODES') as f: s = f.read()
insert = '''\\
                                                                               \\\\
  /* Record Replay */                                                          \\\\
  V(RecordReplayIncExecutionProgressCounter, ImplicitRegisterUse::kNone)       \\\\
  V(RecordReplayInstrumentation, ImplicitRegisterUse::kNone,                   \\\\
      OperandType::kIdx)                                                       \\\\
  V(RecordReplayInstrumentationGenerator, ImplicitRegisterUse::kNone,          \\\\
      OperandType::kIdx, OperandType::kReg)                                    \\\\
  V(RecordReplayAssertValue, ImplicitRegisterUse::kReadWriteAccumulator,       \\\\
      OperandType::kIdx)                                                       \\\\'''
# Find the IncBlockCounter line
pat = r'(V\(IncBlockCounter[^\n]*\n)'
m = re.search(pat, s)
if m:
    pos = m.end()
    s = s[:pos] + insert + '\n' + s[pos:]
    with open('$BYTECODES', 'w') as f: f.write(s)
    print('  OK')
else:
    print('  WARNING: IncBlockCounter not found')
"

# --- 3. Patch runtime.h ---
echo "[6/8] Patching runtime.h..."
RUNTIME_H="$V8/src/runtime/runtime.h"
python3 -c "
with open('$RUNTIME_H') as f: s = f.read()
insert = '''  /* Record Replay */                                                        \\\\
  F(RecordReplayAssertExecutionProgress, 1, 1)                                \\\\
  F(RecordReplayTargetProgressReached, 0, 1)                                  \\\\
  F(RecordReplayAssertValue, 3, 1)                                            \\\\
  F(RecordReplayInstrumentation, 2, 1)                                        \\\\
  F(RecordReplayInstrumentationGenerator, 3, 1)                               \\\\
'''
# Insert before the closing of FOR_EACH_INTRINSIC_INTERNAL
marker = 'F(ThrowAccessedUninitializedVariable'
idx = s.find(marker)
if idx >= 0:
    # Find end of that line
    eol = s.find('\n', idx)
    s = s[:eol+1] + insert + s[eol+1:]
    with open('$RUNTIME_H', 'w') as f: f.write(s)
    print('  OK')
else:
    print('  WARNING: marker not found')
"

# --- 4. Patch interpreter-generator.cc ---
echo "[7/8] Patching interpreter-generator.cc..."
INTERP_GEN="$V8/src/interpreter/interpreter-generator.cc"
cat >> "$INTERP_GEN" << 'ENDPATCH'

// --- Open Replay: Record/Replay bytecode handlers ---

IGNITION_HANDLER(RecordReplayIncExecutionProgressCounter, InterpreterAssembler) {
  TNode<Context> context = GetContext();
  TNode<Object> closure = LoadRegister(Register::function_closure());
  CallRuntime(Runtime::kRecordReplayAssertExecutionProgress, context, closure);
  Dispatch();
}

IGNITION_HANDLER(RecordReplayInstrumentation, InterpreterAssembler) {
  TNode<Context> context = GetContext();
  TNode<Object> closure = LoadRegister(Register::function_closure());
  TNode<Smi> index = BytecodeOperandIdxSmi(0);
  CallRuntime(Runtime::kRecordReplayInstrumentation, context, closure, index);
  Dispatch();
}

IGNITION_HANDLER(RecordReplayInstrumentationGenerator, InterpreterAssembler) {
  TNode<Context> context = GetContext();
  TNode<Object> closure = LoadRegister(Register::function_closure());
  TNode<Smi> index = BytecodeOperandIdxSmi(0);
  TNode<Object> generator = LoadRegisterAtOperandIndex(1);
  CallRuntime(Runtime::kRecordReplayInstrumentationGenerator,
              context, closure, index, generator);
  Dispatch();
}

IGNITION_HANDLER(RecordReplayAssertValue, InterpreterAssembler) {
  TNode<Context> context = GetContext();
  TNode<Object> closure = LoadRegister(Register::function_closure());
  TNode<Smi> index = BytecodeOperandIdxSmi(0);
  TNode<Object> value = GetAccumulator();
  TNode<Object> result = CallRuntime(Runtime::kRecordReplayAssertValue,
                                     context, closure, index, value);
  SetAccumulator(result);
  Dispatch();
}
ENDPATCH
echo "  OK (appended)"

# --- 5. Patch baseline-compiler.cc and bytecode-graph-builder.cc ---
echo "[8/8] Patching baseline-compiler.cc and bytecode-graph-builder.cc..."

BASELINE="$V8/src/baseline/baseline-compiler.cc"
cat >> "$BASELINE" << 'ENDPATCH'

// --- Open Replay: Record/Replay Visit methods ---

void BaselineCompiler::VisitRecordReplayIncExecutionProgressCounter() {
  CallRuntime(Runtime::kRecordReplayAssertExecutionProgress,
              __ FunctionOperand());
}

void BaselineCompiler::VisitRecordReplayInstrumentation() {
  CallRuntime(Runtime::kRecordReplayInstrumentation,
              __ FunctionOperand(),
              __ BytecodeOperandIdxSmi(0));
}

void BaselineCompiler::VisitRecordReplayInstrumentationGenerator() {
  CallRuntime(Runtime::kRecordReplayInstrumentationGenerator,
              __ FunctionOperand(),
              __ BytecodeOperandIdxSmi(0),
              __ RegisterOperand(1));
}

void BaselineCompiler::VisitRecordReplayAssertValue() {
  CallRuntime(Runtime::kRecordReplayAssertValue,
              __ FunctionOperand(),
              __ BytecodeOperandIdxSmi(0),
              kInterpreterAccumulatorRegister);
}
ENDPATCH
echo "  OK (baseline appended)"

BGT="$V8/src/compiler/bytecode-graph-builder.cc"
cat >> "$BGT" << 'ENDPATCH'

// --- Open Replay: Record/Replay Visit methods ---

void BytecodeGraphBuilder::VisitRecordReplayIncExecutionProgressCounter() {
  Environment* env = environment();
  Node* closure = env->LookupRegister(interpreter::Register::function_closure());
  NewNode(javascript()->CallRuntime(
      Runtime::kRecordReplayAssertExecutionProgress, 1), closure);
}

void BytecodeGraphBuilder::VisitRecordReplayInstrumentation() {
  Environment* env = environment();
  Node* closure = env->LookupRegister(interpreter::Register::function_closure());
  Node* index = jsgraph()->SmiConstant(
      bytecode_iterator().GetIndexOperand(0));
  NewNode(javascript()->CallRuntime(
      Runtime::kRecordReplayInstrumentation, 2), closure, index);
}

void BytecodeGraphBuilder::VisitRecordReplayInstrumentationGenerator() {
  Environment* env = environment();
  Node* closure = env->LookupRegister(interpreter::Register::function_closure());
  Node* index = jsgraph()->SmiConstant(
      bytecode_iterator().GetIndexOperand(0));
  Node* generator = env->LookupRegister(
      bytecode_iterator().GetRegisterOperand(1));
  NewNode(javascript()->CallRuntime(
      Runtime::kRecordReplayInstrumentationGenerator, 3),
      closure, index, generator);
}

void BytecodeGraphBuilder::VisitRecordReplayAssertValue() {
  Environment* env = environment();
  Node* closure = env->LookupRegister(interpreter::Register::function_closure());
  Node* index = jsgraph()->SmiConstant(
      bytecode_iterator().GetIndexOperand(0));
  Node* value = environment()->LookupAccumulator();
  Node* result = NewNode(javascript()->CallRuntime(
      Runtime::kRecordReplayAssertValue, 3), closure, index, value);
  environment()->BindAccumulator(result);
}
ENDPATCH
echo "  OK (turbofan appended)"

# --- 6. Add runtime-recordreplay.cc to build ---
echo ""
echo "--- Patching build files ---"

# Add to node.gyp sources
NODE_GYP="$NODE_DIR/node.gyp"
python3 -c "
with open('$NODE_GYP') as f: s = f.read()
# Add node_recordreplay.cc to the sources list
marker = \"'src/node_realm.cc',\"
if marker in s and 'node_recordreplay.cc' not in s:
    s = s.replace(marker, marker + \"\n      'src/node_recordreplay.cc',\")
    with open('$NODE_GYP', 'w') as f: f.write(s)
    print('  node.gyp: added node_recordreplay.cc')
else:
    print('  node.gyp: already patched or marker not found')
"

# Add runtime-recordreplay.cc to v8.gyp or BUILD.gn
V8_GYP="$V8/BUILD.gn"
if [ -f "$V8_GYP" ]; then
  python3 -c "
with open('$V8_GYP') as f: s = f.read()
marker = '\"src/runtime/runtime-regexp.cc\",'
if marker in s and 'runtime-recordreplay.cc' not in s:
    s = s.replace(marker, marker + '\n    \"src/runtime/runtime-recordreplay.cc\",')
    with open('$V8_GYP', 'w') as f: f.write(s)
    print('  BUILD.gn: added runtime-recordreplay.cc')
else:
    print('  BUILD.gn: already patched or marker not found')
"
fi

# Also check tools/v8_gypfiles/v8.gyp (Node.js uses gyp, not gn)
V8_GYP2="$NODE_DIR/tools/v8_gypfiles/v8.gyp"
if [ -f "$V8_GYP2" ]; then
  python3 -c "
with open('$V8_GYP2') as f: s = f.read()
marker = 'src/runtime/runtime-regexp.cc'
if marker in s and 'runtime-recordreplay.cc' not in s:
    s = s.replace(marker, marker + \"',\n        'src/runtime/runtime-recordreplay.cc\")
    with open('$V8_GYP2', 'w') as f: f.write(s)
    print('  v8.gyp: added runtime-recordreplay.cc')
else:
    print('  v8.gyp: already patched or marker not found')
"
fi

echo ""
echo "=== All patches applied ==="
echo ""
echo "Next: cd node && ./configure && make -j\$(sysctl -n hw.ncpu)"
