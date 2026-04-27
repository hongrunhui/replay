// 一个最小 host 程序，没有 hardened runtime，所以接受 DYLD_INSERT_LIBRARIES
// 我们用它来验证 driver 能 init、能开 .orec、能写入

#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <unistd.h>

// 调几个 driver 的 V8 API，看会不会真的写入事件
extern "C" {
  bool V8IsRecording();
  uintptr_t V8RecordReplayValue(const char* why, uintptr_t value);
  void V8RecordReplayBytes(const char* why, void* buf, size_t size);
  void V8RecordReplayAddMetadata(const char* json);
  char* V8GetRecordingId();
}

int main() {
  std::printf("[test_host] pid=%d, asking driver about state...\n", getpid());

  bool rec = V8IsRecording();
  std::printf("[test_host] V8IsRecording() = %s\n", rec ? "true" : "false");

  char* sess = V8GetRecordingId();
  std::printf("[test_host] V8GetRecordingId() = %s\n", sess ? sess : "(null)");
  if (sess) std::free(sess);

  // 写几个事件
  V8RecordReplayAddMetadata("{\"test_host\":\"hello\",\"version\":1}");

  uintptr_t v = V8RecordReplayValue("smoke.value", 42);
  std::printf("[test_host] RecordReplayValue(smoke.value, 42) returned %zu\n", (size_t)v);

  uint8_t buf[16];
  for (int i = 0; i < 16; ++i) buf[i] = (uint8_t)(0xAA + i);
  V8RecordReplayBytes("smoke.bytes", buf, 16);
  std::printf("[test_host] RecordReplayBytes called\n");

  return 0;
}
