// Copyright 2024 V8 Recorder Project
// Recording stream — thread-safe, typed event recording with optional compression
// Inspired by Replay.io's RecordedCall/ByteStream architecture

#ifndef V8_RECORDER_RECORDING_STREAM_H_
#define V8_RECORDER_RECORDING_STREAM_H_

#include <atomic>
#include <cstdint>
#include <fstream>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace v8_recorder {

// Call types — each intercepted libc function gets a type ID
enum class CallType : uint16_t {
  // Time
  GETTIMEOFDAY       = 0x0001,
  CLOCK_GETTIME      = 0x0002,
  MACH_ABSOLUTE_TIME = 0x0003,
  TIME               = 0x0004,

  // Random
  ARC4RANDOM         = 0x0010,
  ARC4RANDOM_BUF     = 0x0011,
  GETENTROPY         = 0x0012,

  // File I/O
  OPEN               = 0x0100,
  CLOSE              = 0x0101,
  READ               = 0x0102,
  WRITE              = 0x0103,
  PREAD              = 0x0104,
  PWRITE             = 0x0105,
  STAT               = 0x0106,
  FSTAT              = 0x0107,
  LSTAT              = 0x0108,
  ACCESS             = 0x0109,
  READLINK           = 0x010A,
  GETCWD             = 0x010B,

  // Network I/O
  SOCKET             = 0x0200,
  CONNECT            = 0x0201,
  ACCEPT             = 0x0202,
  RECV               = 0x0203,
  SEND               = 0x0204,
  RECVFROM           = 0x0205,
  SENDTO             = 0x0206,
  POLL               = 0x0207,
  SELECT             = 0x0208,

  // DNS
  GETADDRINFO        = 0x0300,

  // Misc
  DLOPEN             = 0x0400,
  DLSYM              = 0x0401,

  // Meta
  RANDOM_SEED        = 0xFF00,
  THREAD_ID          = 0xFF01,
};

// A single recorded call — variable-length
struct RecordedCall {
  uint64_t sequence;       // Global monotonic sequence number
  CallType type;           // Which function was called
  int32_t  return_value;   // Scalar return value (or errno for errors)
  uint32_t data_len;       // Length of additional data
  // Followed by `data_len` bytes of payload (output buffers, strings, etc.)
};

// File format: V8RE0003
// Header (32 bytes) + RecordedCall stream + Footer (8 bytes)
struct FileHeaderV3 {
  char     magic[8];       // "V8RE0003"
  uint32_t version;        // 3
  uint64_t timestamp;      // Recording start time (ms since epoch)
  uint32_t call_count;     // Total calls recorded
  uint32_t flags;          // Bit 0: compressed
  uint32_t reserved;
};

class RecordingStream {
 public:
  RecordingStream();
  ~RecordingStream();

  // --- Recording mode ---
  bool Open(const char* path);
  void Record(CallType type, int32_t rval,
              const void* data = nullptr, size_t data_len = 0);
  void Flush();
  void Close();

  // --- Replay mode ---
  bool Load(const char* path);
  // Get next recorded call of a specific type
  const RecordedCall* Next(CallType type);
  // Get next recorded call of any type
  const RecordedCall* NextAny();
  // Get the data payload of a call (pointer into loaded buffer)
  const uint8_t* GetData(const RecordedCall* call) const;
  void Reset();

  // --- Stats ---
  size_t total_calls() const { return calls_.size(); }
  bool is_recording() const { return output_fd_ >= 0; }
  bool is_loaded() const { return !calls_.empty(); }

  static constexpr const char* kMagic = "V8RE0003";
  static constexpr uint32_t kVersion = 3;

 private:
  void WriteHeader();
  void WriteFooter();

  // Recording state — uses raw POSIX fd to avoid interception loops
  int output_fd_ = -1;
  std::atomic<uint64_t> next_sequence_{0};
  uint32_t written_count_ = 0;
  uint64_t start_timestamp_ = 0;
  std::mutex write_mutex_;

  // Replay state — calls stored with inline data
  struct StoredCall {
    RecordedCall header;
    std::vector<uint8_t> data;
  };
  std::vector<StoredCall> calls_;
  std::unordered_map<uint16_t, size_t> read_cursors_;
  size_t any_cursor_ = 0;
};

// --- Global recording/replay state ---
enum class Mode { IDLE, RECORDING, REPLAYING };

Mode GetMode();
void SetMode(Mode mode);
RecordingStream* GetStream();

}  // namespace v8_recorder

#endif  // V8_RECORDER_RECORDING_STREAM_H_
