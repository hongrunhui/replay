// Copyright 2024 V8 Recorder Project
// Event log for platform-level recording/replay

#ifndef V8_RECORDER_EVENT_LOG_H_
#define V8_RECORDER_EVENT_LOG_H_

#include <cstdint>
#include <fstream>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace v8_recorder {

// Event types — only non-deterministic platform API return values
enum class EventType : uint8_t {
  WALL_CLOCK_TIME = 0,  // CurrentClockTimeMillis() return value
  MONOTONIC_TIME  = 1,  // MonotonicallyIncreasingTime() return value
  RANDOM_SEED     = 2,  // Random number seed
  THREAD_ID       = 3,  // Thread identifier (for multi-thread ordering)
};

// A single recorded event
struct Event {
  uint64_t sequence;              // Global monotonic sequence number
  EventType type;
  uint64_t timestamp_us;          // Real wall-clock time at recording (for UI)
  std::vector<uint8_t> data;      // Payload (double/int64/bytes)
};

// File header layout (32 bytes, written field-by-field to avoid padding):
//   magic[8]      "V8RE0002"
//   version       uint32 = 2
//   timestamp     uint64 (ms since epoch)
//   event_count   uint32
//   flags         uint32
//   reserved      uint32

class EventLog {
 public:
  EventLog();
  ~EventLog();

  // --- Writing (recording mode) ---
  bool OpenForWriting(const char* path);
  void Append(EventType type, const void* data, size_t len);
  void Flush();
  void Close();

  // --- Reading (replay mode) ---
  bool Load(const char* path);
  const Event* Next(EventType type);
  void Reset();

  // --- Stats ---
  size_t total_events() const { return events_.size(); }
  size_t events_by_type(EventType type) const;

  // --- File format constants ---
  static constexpr const char* kMagic = "V8RE0002";
  static constexpr uint32_t kVersion = 2;

 private:
  void WriteHeader();
  void WriteEvent(const Event& event);
  void WriteFooter();
  static uint32_t ComputeCRC32(const uint8_t* data, size_t len);
  uint64_t NowMicros() const;

  // Writing state
  std::ofstream output_;
  uint64_t next_sequence_ = 0;
  uint32_t written_count_ = 0;
  uint64_t start_timestamp_ = 0;

  // Reading state
  std::vector<Event> events_;
  std::unordered_map<uint8_t, size_t> read_cursors_;

  std::mutex mutex_;
};

}  // namespace v8_recorder

#endif  // V8_RECORDER_EVENT_LOG_H_
