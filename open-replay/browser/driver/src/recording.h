// Open Replay — Recording File Format
//
// File layout:
//   [FileHeader]                    — 64 bytes
//   [Event]*                        — variable length event stream
//   [CheckpointIndex]               — array of checkpoint offsets
//   [MetadataJSON]                  — JSON blob with source info, etc.
//   [FileTail]                      — 32 bytes
//
// Event format:
//   [event_type: u8] [why_hash: u32] [data_len: u32] [data: bytes]
//
// All multi-byte values are little-endian.

#ifndef OPENREPLAY_FORMAT_RECORDING_H_
#define OPENREPLAY_FORMAT_RECORDING_H_

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>
#include <unordered_map>
#include <pthread.h>

namespace openreplay {

// --- File format constants ---

static constexpr char kMagic[8] = {'O','R','E','C','0','0','0','1'};
static constexpr uint32_t kFormatVersion = 1;

// --- Event types ---

enum class EventType : uint8_t {
  VALUE           = 0x01,  // Scalar value (uintptr_t)
  BYTES           = 0x02,  // Byte buffer
  STRING          = 0x03,  // String data
  CHECKPOINT      = 0x10,  // Checkpoint marker
  PROGRESS_MARK   = 0x11,  // Progress counter snapshot
  METADATA        = 0x20,  // Inline metadata
};

// --- File header (64 bytes) ---

struct __attribute__((packed)) FileHeader {
  char     magic[8];          // "OREC0001"
  uint32_t version;           // Format version (1)
  uint32_t flags;             // Bit 0: compressed
  uint64_t timestamp;         // Recording start (ms since epoch)
  char     build_id[32];      // Node.js build identifier
  uint64_t reserved;          // Future use
};
static_assert(sizeof(FileHeader) == 64, "FileHeader must be 64 bytes");

// --- Event header (9 bytes) ---

struct EventHeader {
  EventType type;             // 1 byte
  uint32_t  why_hash;         // 4 bytes — FNV-1a hash of the "why" string
  uint32_t  data_len;         // 4 bytes — length of payload
};

// --- Checkpoint entry ---

struct CheckpointEntry {
  uint32_t id;                // Checkpoint sequential ID
  uint64_t file_offset;       // Byte offset in the event stream
  uint64_t progress;          // Progress counter value at checkpoint
  uint64_t event_index;       // Event sequence number
};

// --- File tail (32 bytes) ---

struct __attribute__((packed)) FileTail {
  uint64_t total_events;      // Total event count
  uint64_t checkpoint_offset; // File offset of CheckpointIndex
  uint64_t metadata_offset;   // File offset of MetadataJSON
  uint32_t sentinel;          // 0xDEADBEEF
  uint32_t reserved;
};
static_assert(sizeof(FileTail) == 32, "FileTail must be 32 bytes");

// --- Hash utility ---

inline uint32_t FnvHash(const char* str) {
  uint32_t hash = 0x811c9dc5;
  while (*str) {
    hash ^= static_cast<uint8_t>(*str++);
    hash *= 0x01000193;
  }
  return hash;
}

// --- Recording file writer ---

class RecordingWriter {
 public:
  RecordingWriter();
  ~RecordingWriter();

  bool Open(const char* path, const char* build_id);
  void WriteEvent(EventType type, const char* why,
                  const void* data, size_t data_len);
  void WriteCheckpoint(uint64_t progress);
  void WriteMetadata(const std::string& json);
  void Close();

  bool is_open() const { return fd_ >= 0; }
  uint64_t event_count() const { return event_count_; }

 private:
  void RawWrite(const void* buf, size_t len);

  int fd_ = -1;
  uint64_t event_count_ = 0;
  uint64_t stream_offset_ = 0;  // Current offset past header
  std::vector<CheckpointEntry> checkpoints_;
  pthread_mutex_t mutex_ = PTHREAD_MUTEX_INITIALIZER;
};

// --- Recording file reader ---

class RecordingReader {
 public:
  RecordingReader();
  ~RecordingReader();

  bool Open(const char* path);
  void Close();

  // Sequential reading
  struct Event {
    EventType type;
    uint32_t why_hash;
    std::vector<uint8_t> data;
    uint64_t index;  // Event sequence number
  };

  // Read next event matching a specific "why" tag
  const Event* NextEvent(const char* why);

  // Read next event of any type
  const Event* NextAny();

  // Reset read position to beginning (or to a checkpoint)
  void Reset();
  void SeekToCheckpoint(uint32_t checkpoint_id);

  // Accessors
  const FileHeader& header() const { return header_; }
  const std::vector<CheckpointEntry>& checkpoints() const { return checkpoints_; }
  const std::string& metadata() const { return metadata_; }
  size_t total_events() const { return events_.size(); }

  // Divergence detection: report event consumption stats at end of replay
  void PrintReplayReport() const;

 private:
  bool ParseEvents(const uint8_t* data, size_t len);
  bool ParseTail(const uint8_t* data, size_t total_len);

  FileHeader header_;
  std::vector<Event> events_;
  std::vector<CheckpointEntry> checkpoints_;
  std::string metadata_;

  // Read cursors: per why_hash cursor + global cursor
  std::unordered_map<uint32_t, size_t> cursors_;
  size_t global_cursor_ = 0;
};

}  // namespace openreplay

#endif  // OPENREPLAY_FORMAT_RECORDING_H_
