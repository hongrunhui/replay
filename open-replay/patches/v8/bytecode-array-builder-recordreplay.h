// Open Replay — V8 Bytecode Array Builder Extensions
// This file is added to deps/v8/src/interpreter/
//
// Adds builder methods for the new record/replay bytecodes.
// These are called by bytecode-generator.cc to emit instrumentation.

#ifndef V8_INTERPRETER_BYTECODE_ARRAY_BUILDER_RECORDREPLAY_H_
#define V8_INTERPRETER_BYTECODE_ARRAY_BUILDER_RECORDREPLAY_H_

// Add these methods to the BytecodeArrayBuilder class in
// deps/v8/src/interpreter/bytecode-array-builder.h:
//
// BytecodeArrayBuilder& RecordReplayIncExecutionProgressCounter();
// BytecodeArrayBuilder& RecordReplayInstrumentation(const char* kind);
// BytecodeArrayBuilder& RecordReplayInstrumentationGenerator(
//     const char* kind, Register generator);
// BytecodeArrayBuilder& RecordReplayAssertValue(const char* site);

// Implementation (add to bytecode-array-builder.cc):

/*

BytecodeArrayBuilder& BytecodeArrayBuilder::RecordReplayIncExecutionProgressCounter() {
  OutputRecordReplayIncExecutionProgressCounter();
  return *this;
}

BytecodeArrayBuilder& BytecodeArrayBuilder::RecordReplayInstrumentation(
    const char* kind) {
  // Store kind string in constant pool, get index
  size_t entry = GetConstantPoolEntry(kind);
  OutputRecordReplayInstrumentation(
      static_cast<uint32_t>(entry + recordreplay::kBytecodeSiteOffset));
  return *this;
}

BytecodeArrayBuilder& BytecodeArrayBuilder::RecordReplayInstrumentationGenerator(
    const char* kind, Register generator) {
  size_t entry = GetConstantPoolEntry(kind);
  OutputRecordReplayInstrumentationGenerator(
      static_cast<uint32_t>(entry + recordreplay::kBytecodeSiteOffset),
      generator);
  return *this;
}

BytecodeArrayBuilder& BytecodeArrayBuilder::RecordReplayAssertValue(
    const char* site) {
  size_t entry = GetConstantPoolEntry(site);
  OutputRecordReplayAssertValue(
      static_cast<uint32_t>(entry + recordreplay::kBytecodeSiteOffset));
  return *this;
}

*/

#endif  // V8_INTERPRETER_BYTECODE_ARRAY_BUILDER_RECORDREPLAY_H_
