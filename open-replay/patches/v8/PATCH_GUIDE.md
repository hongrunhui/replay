# Open Replay — V8 Patch Guide
#
# This file describes all changes needed to Node.js v20's V8 engine.
# Apply these changes to deps/v8/ after cloning Node.js.
#
# Based on Replay.io's chromium-v8 implementation, adapted for our driver API.

## File 1: deps/v8/src/interpreter/bytecodes.h
## Add 4 bytecodes to BYTECODE_LIST_WITH_UNIQUE_HANDLERS

# Find the line containing "IncBlockCounter" in the macro, and add AFTER it:

```cpp
  /* Record Replay */                                                          \
  V(RecordReplayIncExecutionProgressCounter, ImplicitRegisterUse::kNone)       \
  V(RecordReplayInstrumentation, ImplicitRegisterUse::kNone,                   \
      OperandType::kIdx)                                                       \
  V(RecordReplayInstrumentationGenerator, ImplicitRegisterUse::kNone,          \
      OperandType::kIdx, OperandType::kReg)                                    \
  V(RecordReplayAssertValue, ImplicitRegisterUse::kReadWriteAccumulator,       \
      OperandType::kIdx)                                                       \
```

---

## File 2: deps/v8/src/runtime/runtime.h
## Add 5 runtime functions to FOR_EACH_INTRINSIC_INTERNAL

# Find FOR_EACH_INTRINSIC_INTERNAL macro, add before the closing:

```cpp
  F(RecordReplayAssertExecutionProgress, 1, 1)                                \
  F(RecordReplayTargetProgressReached, 0, 1)                                  \
  F(RecordReplayAssertValue, 3, 1)                                            \
  F(RecordReplayInstrumentation, 2, 1)                                        \
  F(RecordReplayInstrumentationGenerator, 3, 1)                               \
```

---

## File 3: deps/v8/src/codegen/external-reference.h
## Add 2 external references

# Find EXTERNAL_REFERENCE_LIST macro, add:

```cpp
  V(record_replay_progress_counter, "record_replay_progress_counter")          \
  V(record_replay_target_progress, "record_replay_target_progress")            \
```

---

## File 4: deps/v8/src/codegen/external-reference.cc
## Implement external references

# Add at top of file (after includes):

```cpp
#include "include/replayio.h"
```

# Add implementations:

```cpp
ExternalReference ExternalReference::record_replay_progress_counter() {
  return ExternalReference(
      reinterpret_cast<Address>(v8::internal::gProgressCounter));
}

ExternalReference ExternalReference::record_replay_target_progress() {
  return ExternalReference(
      reinterpret_cast<Address>(&v8::internal::gTargetProgress));
}
```

---

## File 5: deps/v8/src/interpreter/interpreter-generator.cc
## Add IGNITION_HANDLERs for new bytecodes

# Add after the last IGNITION_HANDLER (before the closing of the file):

```cpp
// --- Record Replay bytecode handlers ---

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
```

---

## File 6: deps/v8/src/baseline/baseline-compiler.cc
## Add Visit methods for new bytecodes

```cpp
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
```

---

## File 7: deps/v8/src/compiler/bytecode-graph-builder.cc
## Add Visit methods for TurboFan

```cpp
void BytecodeGraphBuilder::VisitRecordReplayIncExecutionProgressCounter() {
  // For simplicity, always use runtime call (can optimize later with
  // IncrementAndCheckProgressCounter simplified operator)
  Environment* env = environment();
  Node* closure = env->LookupRegister(interpreter::Register::function_closure());
  NewNode(javascript()->CallRuntime(
      Runtime::kRecordReplayAssertExecutionProgress, 1), closure);
}

void BytecodeGraphBuilder::VisitRecordReplayInstrumentation() {
  if (!v8::internal::gRecordReplayInstrumentationEnabled) return;
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
```

---

## File 8: deps/v8/src/interpreter/bytecode-generator.cc
## Add instrumentation emission

# Add include at top:
```cpp
#include "include/replayio.h"
```

# Add member to BytecodeGenerator class (in bytecode-generator.h):
```cpp
bool emit_record_replay_opcodes_ = false;
```

# In GenerateBytecodeBody(), after parameter setup, add:
```cpp
// Initialize record/replay instrumentation
emit_record_replay_opcodes_ =
    v8::recordreplay::IsRecordingOrReplaying() &&
    v8::recordreplay::IsMainThread();

if (emit_record_replay_opcodes_) {
  builder()->RecordReplayIncExecutionProgressCounter();
  // Emit entry instrumentation
  builder()->RecordReplayInstrumentation("main");
}
```

# In BuildReturn(), before the Return() call:
```cpp
if (emit_record_replay_opcodes_) {
  builder()->RecordReplayInstrumentation("exit");
}
```

# In VisitStatements or SetStatementPosition:
```cpp
if (emit_record_replay_opcodes_) {
  builder()->RecordReplayIncExecutionProgressCounter();
}
```

---

## New Files to Add:

1. `deps/v8/include/replayio.h` — see patches/v8/replayio.h
2. `deps/v8/src/runtime/runtime-recordreplay.cc` — see patches/v8/runtime-recordreplay.cc

## Build System:

Add to `deps/v8/BUILD.gn` (or the gyp equivalent in Node.js):
- `src/runtime/runtime-recordreplay.cc` to the v8_base sources

Add to `deps/v8/src/runtime/BUILD.gn`:
- `runtime-recordreplay.cc` to the sources list
