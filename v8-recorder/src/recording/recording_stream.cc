// Copyright 2024 V8 Recorder Project
// Recording stream implementation
// Uses raw POSIX I/O for writing to avoid interception loops

#include "src/recording/recording_stream.h"
#include <chrono>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>
#include <cstdio>

namespace v8_recorder {

// --- Global state ---
static Mode g_mode = Mode::IDLE;
static RecordingStream g_stream;

Mode GetMode() { return g_mode; }
void SetMode(Mode mode) { g_mode = mode; }
RecordingStream* GetStream() { return &g_stream; }

// Raw write helper — bypasses any interception
static void raw_write_all(int fd, const void* buf, size_t len) {
  const char* p = static_cast<const char*>(buf);
  while (len > 0) {
    ssize_t n = ::write(fd, p, len);
    if (n <= 0) break;
    p += n;
    len -= n;
  }
}

static void log_msg(const char* msg) {
  ::write(STDERR_FILENO, msg, strlen(msg));
  ::write(STDERR_FILENO, "\n", 1);
}

// --- RecordingStream ---

RecordingStream::RecordingStream() = default;
RecordingStream::~RecordingStream() { Close(); }

bool RecordingStream::Open(const char* path) {
  std::lock_guard<std::mutex> lock(write_mutex_);
  output_fd_ = ::open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (output_fd_ < 0) {
    log_msg("[RecordingStream] Failed to open output file");
    return false;
  }
  next_sequence_ = 0;
  written_count_ = 0;
  auto now = std::chrono::system_clock::now();
  start_timestamp_ = std::chrono::duration_cast<std::chrono::milliseconds>(
                          now.time_since_epoch()).count();
  WriteHeader();
  log_msg("[RecordingStream] Recording started");
  return true;
}

void RecordingStream::Record(CallType type, int32_t rval,
                             const void* data, size_t data_len) {
  std::lock_guard<std::mutex> lock(write_mutex_);
  if (output_fd_ < 0) return;

  uint64_t seq = next_sequence_++;
  uint16_t t = static_cast<uint16_t>(type);
  uint32_t dlen = static_cast<uint32_t>(data_len);

  raw_write_all(output_fd_, &seq, 8);
  raw_write_all(output_fd_, &t, 2);
  raw_write_all(output_fd_, &rval, 4);
  raw_write_all(output_fd_, &dlen, 4);
  if (dlen > 0 && data) {
    raw_write_all(output_fd_, data, dlen);
  }
  written_count_++;
}

void RecordingStream::Flush() {
  std::lock_guard<std::mutex> lock(write_mutex_);
  if (output_fd_ >= 0) ::fsync(output_fd_);
}

void RecordingStream::Close() {
  std::lock_guard<std::mutex> lock(write_mutex_);
  if (output_fd_ < 0) return;

  WriteFooter();
  // Seek back to update call count in header (offset 20)
  ::lseek(output_fd_, 20, SEEK_SET);
  raw_write_all(output_fd_, &written_count_, 4);
  ::close(output_fd_);
  output_fd_ = -1;

  char msg[64];
  snprintf(msg, sizeof(msg), "[RecordingStream] Closed. Total calls: %u", written_count_);
  log_msg(msg);
}

void RecordingStream::WriteHeader() {
  raw_write_all(output_fd_, kMagic, 8);
  raw_write_all(output_fd_, &kVersion, 4);
  raw_write_all(output_fd_, &start_timestamp_, 8);
  uint32_t zero = 0;
  raw_write_all(output_fd_, &zero, 4);  // call_count
  raw_write_all(output_fd_, &zero, 4);  // flags
  raw_write_all(output_fd_, &zero, 4);  // reserved
}

void RecordingStream::WriteFooter() {
  raw_write_all(output_fd_, &written_count_, 4);
  uint32_t sentinel = 0xDEADBEEF;
  raw_write_all(output_fd_, &sentinel, 4);
}

// --- Replay mode (uses std::ifstream — safe since replay doesn't interpose) ---

bool RecordingStream::Load(const char* path) {
  calls_.clear();
  read_cursors_.clear();
  any_cursor_ = 0;

  std::ifstream input(path, std::ios::binary);
  if (!input.is_open()) {
    fprintf(stderr, "[RecordingStream] Failed to open: %s\n", path);
    return false;
  }

  char magic[8];
  input.read(magic, 8);
  if (std::memcmp(magic, kMagic, 8) != 0) {
    fprintf(stderr, "[RecordingStream] Invalid magic\n");
    return false;
  }
  uint32_t version;
  input.read(reinterpret_cast<char*>(&version), 4);
  if (version != kVersion) {
    fprintf(stderr, "[RecordingStream] Unsupported version: %u\n", version);
    return false;
  }
  uint64_t timestamp;
  input.read(reinterpret_cast<char*>(&timestamp), 8);
  uint32_t call_count, flags, reserved;
  input.read(reinterpret_cast<char*>(&call_count), 4);
  input.read(reinterpret_cast<char*>(&flags), 4);
  input.read(reinterpret_cast<char*>(&reserved), 4);

  fprintf(stderr, "[RecordingStream] Loading: %s (%u calls)\n", path, call_count);

  while (input.good()) {
    StoredCall sc;
    input.read(reinterpret_cast<char*>(&sc.header.sequence), 8);
    if (!input.good()) break;
    uint16_t t;
    input.read(reinterpret_cast<char*>(&t), 2);
    if (!input.good()) break;
    sc.header.type = static_cast<CallType>(t);
    input.read(reinterpret_cast<char*>(&sc.header.return_value), 4);
    if (!input.good()) break;
    input.read(reinterpret_cast<char*>(&sc.header.data_len), 4);
    if (!input.good()) break;
    if (sc.header.data_len > 0) {
      sc.data.resize(sc.header.data_len);
      input.read(reinterpret_cast<char*>(sc.data.data()), sc.header.data_len);
      if (!input.good()) break;
    }
    calls_.push_back(std::move(sc));
  }

  fprintf(stderr, "[RecordingStream] Loaded %zu calls\n", calls_.size());
  return true;
}

const RecordedCall* RecordingStream::Next(CallType type) {
  uint16_t key = static_cast<uint16_t>(type);
  size_t& cursor = read_cursors_[key];
  while (cursor < calls_.size()) {
    if (calls_[cursor].header.type == type) {
      return &calls_[cursor++].header;
    }
    cursor++;
  }
  return nullptr;
}

const RecordedCall* RecordingStream::NextAny() {
  if (any_cursor_ < calls_.size()) {
    return &calls_[any_cursor_++].header;
  }
  return nullptr;
}

const uint8_t* RecordingStream::GetData(const RecordedCall* call) const {
  for (const auto& sc : calls_) {
    if (&sc.header == call) {
      return sc.data.empty() ? nullptr : sc.data.data();
    }
  }
  return nullptr;
}

void RecordingStream::Reset() {
  read_cursors_.clear();
  any_cursor_ = 0;
}

}  // namespace v8_recorder
