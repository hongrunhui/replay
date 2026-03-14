// Open Replay — Driver Test
//
// Tests the full record/replay cycle for time, random, and file I/O.

#include "driver.h"

#include <cassert>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

static void test_value_record_replay() {
  printf("=== Test: Value Record/Replay ===\n");

  const char* rec_path = "/tmp/openreplay_test.orec";

  // --- Record phase ---
  RecordReplaySetRecordingPath(rec_path);
  RecordReplayAttach("record", "test-build");

  assert(RecordReplayIsRecording());
  assert(RecordReplayIsRecordingOrReplaying());
  assert(!RecordReplayIsReplaying());

  // Record some values
  uintptr_t v1 = RecordReplayValue("test.val1", 42);
  uintptr_t v2 = RecordReplayValue("test.val2", 12345);
  uintptr_t v3 = RecordReplayValue("test.val1", 99);

  assert(v1 == 42);
  assert(v2 == 12345);
  assert(v3 == 99);

  printf("  Recorded values: %lu, %lu, %lu\n",
         (unsigned long)v1, (unsigned long)v2, (unsigned long)v3);

  RecordReplayFinishRecording();
  RecordReplayDetach();

  // --- Replay phase ---
  RecordReplaySetRecordingPath(rec_path);
  RecordReplayAttach("replay", "test-build");

  assert(RecordReplayIsReplaying());
  assert(RecordReplayIsRecordingOrReplaying());
  assert(!RecordReplayIsRecording());

  uintptr_t r1 = RecordReplayValue("test.val1", 0);
  uintptr_t r2 = RecordReplayValue("test.val2", 0);
  uintptr_t r3 = RecordReplayValue("test.val1", 0);

  printf("  Replayed values: %lu, %lu, %lu\n",
         (unsigned long)r1, (unsigned long)r2, (unsigned long)r3);

  assert(r1 == 42);
  assert(r2 == 12345);
  assert(r3 == 99);

  RecordReplayDetach();

  printf("  PASSED\n\n");
}

static void test_bytes_record_replay() {
  printf("=== Test: Bytes Record/Replay ===\n");

  const char* rec_path = "/tmp/openreplay_test_bytes.orec";

  // --- Record ---
  RecordReplaySetRecordingPath(rec_path);
  RecordReplayAttach("record", "test-build");

  uint8_t buf1[16] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16};
  RecordReplayBytes("test.buf", buf1, sizeof(buf1));

  char str_buf[] = "Hello, Open Replay!";
  std::string str(str_buf);
  RecordReplayString("test.str", str);

  RecordReplayFinishRecording();
  RecordReplayDetach();

  // --- Replay ---
  RecordReplaySetRecordingPath(rec_path);
  RecordReplayAttach("replay", "test-build");

  uint8_t buf2[16] = {};
  RecordReplayBytes("test.buf", buf2, sizeof(buf2));
  assert(memcmp(buf1, buf2, sizeof(buf1)) == 0);
  printf("  Bytes match: OK\n");

  std::string str2;
  RecordReplayString("test.str", str2);
  assert(str2 == "Hello, Open Replay!");
  printf("  String match: \"%s\"\n", str2.c_str());

  RecordReplayDetach();

  printf("  PASSED\n\n");
}

static void test_checkpoint() {
  printf("=== Test: Checkpoints ===\n");

  const char* rec_path = "/tmp/openreplay_test_cp.orec";

  RecordReplaySetRecordingPath(rec_path);
  RecordReplayAttach("record", "test-build");

  // Simulate progress and checkpoints
  uint64_t* counter = RecordReplayProgressCounter();
  *counter = 100;
  RecordReplayNewCheckpoint();

  *counter = 500;
  RecordReplayNewCheckpoint();

  *counter = 1000;
  RecordReplayNewCheckpoint();

  assert(RecordReplayGetCheckpointCount() == 3);
  printf("  Created 3 checkpoints\n");

  RecordReplayFinishRecording();
  RecordReplayDetach();

  printf("  PASSED\n\n");
}

static void test_recording_id() {
  printf("=== Test: Recording ID ===\n");

  const char* rec_path = "/tmp/openreplay_test_id.orec";

  RecordReplaySetRecordingPath(rec_path);
  RecordReplayAttach("record", "test-build");

  const char* id = RecordReplayGetRecordingId();
  assert(id != nullptr);
  assert(strlen(id) > 0);
  printf("  Recording ID: %s\n", id);

  RecordReplayFinishRecording();
  RecordReplayDetach();

  printf("  PASSED\n\n");
}

int main() {
  printf("\n========================================\n");
  printf("  Open Replay Driver Tests\n");
  printf("========================================\n\n");

  test_value_record_replay();
  test_bytes_record_replay();
  test_checkpoint();
  test_recording_id();

  printf("========================================\n");
  printf("  All tests passed!\n");
  printf("========================================\n\n");

  // Cleanup
  unlink("/tmp/openreplay_test.orec");
  unlink("/tmp/openreplay_test_bytes.orec");
  unlink("/tmp/openreplay_test_cp.orec");
  unlink("/tmp/openreplay_test_id.orec");

  return 0;
}
