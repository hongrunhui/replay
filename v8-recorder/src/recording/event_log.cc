// Copyright 2024 V8 Recorder Project
// Event log implementation

#include "src/recording/event_log.h"
#include <chrono>
#include <cstring>
#include <iostream>

namespace v8_recorder {

// Simple CRC32 lookup table (IEEE polynomial)
static uint32_t crc32_table[256];
static bool crc32_table_initialized = false;

static void InitCRC32Table() {
  if (crc32_table_initialized) return;
  for (uint32_t i = 0; i < 256; i++) {
    uint32_t crc = i;
    for (int j = 0; j < 8; j++) {
      crc = (crc >> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    crc32_table[i] = crc;
  }
  crc32_table_initialized = true;
}

EventLog::EventLog() { InitCRC32Table(); }

EventLog::~EventLog() { Close(); }

uint64_t EventLog::NowMicros() const {
  auto now = std::chrono::steady_clock::now();
  return std::chrono::duration_cast<std::chrono::microseconds>(
             now.time_since_epoch())
      .count();
}

uint32_t EventLog::ComputeCRC32(const uint8_t* data, size_t len) {
  uint32_t crc = 0xFFFFFFFF;
  for (size_t i = 0; i < len; i++) {
    crc = (crc >> 8) ^ crc32_table[(crc ^ data[i]) & 0xFF];
  }
  return crc ^ 0xFFFFFFFF;
}

// ============ Writing (recording mode) ============

bool EventLog::OpenForWriting(const char* path) {
  std::lock_guard<std::mutex> lock(mutex_);
  output_.open(path, std::ios::binary | std::ios::trunc);
  if (!output_.is_open()) {
    std::cerr << "[EventLog] Failed to open: " << path << std::endl;
    return false;
  }
  next_sequence_ = 0;
  written_count_ = 0;
  auto now = std::chrono::system_clock::now();
  start_timestamp_ = std::chrono::duration_cast<std::chrono::milliseconds>(
                          now.time_since_epoch())
                         .count();
  WriteHeader();
  std::cout << "[EventLog] Recording to: " << path << std::endl;
  return true;
}

void EventLog::Append(EventType type, const void* data, size_t len) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!output_.is_open()) return;

  Event event;
  event.sequence = next_sequence_++;
  event.type = type;
  event.timestamp_us = NowMicros();
  event.data.resize(len);
  std::memcpy(event.data.data(), data, len);

  WriteEvent(event);
  written_count_++;
}

void EventLog::Flush() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (output_.is_open()) output_.flush();
}

void EventLog::Close() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!output_.is_open()) return;

  WriteFooter();
  // Seek back to header to update event count
  output_.seekp(20);  // offset of event_count in header
  output_.write(reinterpret_cast<const char*>(&written_count_),
                sizeof(written_count_));
  output_.close();
  std::cout << "[EventLog] Closed. Total events: " << written_count_
            << std::endl;
}

void EventLog::WriteHeader() {
  // Write header fields individually to avoid struct padding issues
  // Total: 8 + 4 + 8 + 4 + 4 + 4 = 32 bytes
  output_.write(kMagic, 8);                                              // magic
  output_.write(reinterpret_cast<const char*>(&kVersion), 4);            // version
  output_.write(reinterpret_cast<const char*>(&start_timestamp_), 8);    // timestamp
  uint32_t zero = 0;
  output_.write(reinterpret_cast<const char*>(&zero), 4);                // event_count (updated on Close)
  output_.write(reinterpret_cast<const char*>(&zero), 4);                // flags
  output_.write(reinterpret_cast<const char*>(&zero), 4);                // reserved
}

void EventLog::WriteEvent(const Event& event) {
  // Sequence (8) + Type (1) + DataLen (2) + Data (variable)
  output_.write(reinterpret_cast<const char*>(&event.sequence), 8);
  uint8_t type = static_cast<uint8_t>(event.type);
  output_.write(reinterpret_cast<const char*>(&type), 1);
  uint16_t data_len = static_cast<uint16_t>(event.data.size());
  output_.write(reinterpret_cast<const char*>(&data_len), 2);
  if (data_len > 0) {
    output_.write(reinterpret_cast<const char*>(event.data.data()), data_len);
  }
}

void EventLog::WriteFooter() {
  output_.write(reinterpret_cast<const char*>(&written_count_),
                sizeof(written_count_));
  // CRC32 placeholder — compute over event count for basic integrity
  uint32_t crc = ComputeCRC32(
      reinterpret_cast<const uint8_t*>(&written_count_), sizeof(written_count_));
  output_.write(reinterpret_cast<const char*>(&crc), sizeof(crc));
}

// ============ Reading (replay mode) ============

bool EventLog::Load(const char* path) {
  std::lock_guard<std::mutex> lock(mutex_);
  events_.clear();
  read_cursors_.clear();

  std::ifstream input(path, std::ios::binary);
  if (!input.is_open()) {
    std::cerr << "[EventLog] Failed to open: " << path << std::endl;
    return false;
  }

  // Read header fields individually (32 bytes total)
  char magic[8];
  input.read(magic, 8);
  if (std::memcmp(magic, kMagic, 8) != 0) {
    std::cerr << "[EventLog] Invalid magic number" << std::endl;
    return false;
  }
  uint32_t version;
  input.read(reinterpret_cast<char*>(&version), 4);
  if (version != kVersion) {
    std::cerr << "[EventLog] Unsupported version: " << version << std::endl;
    return false;
  }
  uint64_t timestamp;
  input.read(reinterpret_cast<char*>(&timestamp), 8);
  uint32_t event_count;
  input.read(reinterpret_cast<char*>(&event_count), 4);
  uint32_t flags, reserved;
  input.read(reinterpret_cast<char*>(&flags), 4);
  input.read(reinterpret_cast<char*>(&reserved), 4);

  std::cout << "[EventLog] Loading recording from: " << path << std::endl;
  std::cout << "[EventLog] Recorded at: " << timestamp << " ms" << std::endl;
  std::cout << "[EventLog] Expected events: " << event_count << std::endl;

  // Read events until we hit footer or EOF
  while (input.good()) {
    Event event;
    input.read(reinterpret_cast<char*>(&event.sequence), 8);
    if (!input.good()) break;

    uint8_t type;
    input.read(reinterpret_cast<char*>(&type), 1);
    if (!input.good()) break;
    event.type = static_cast<EventType>(type);

    uint16_t data_len;
    input.read(reinterpret_cast<char*>(&data_len), 2);
    if (!input.good()) break;

    event.data.resize(data_len);
    if (data_len > 0) {
      input.read(reinterpret_cast<char*>(event.data.data()), data_len);
      if (!input.good()) break;
    }

    event.timestamp_us = 0;  // Not stored in file per-event
    events_.push_back(std::move(event));
  }

  std::cout << "[EventLog] Loaded " << events_.size() << " events"
            << std::endl;
  return true;
}

const Event* EventLog::Next(EventType type) {
  uint8_t key = static_cast<uint8_t>(type);
  size_t& cursor = read_cursors_[key];

  // Scan forward from cursor to find next event of this type
  while (cursor < events_.size()) {
    if (events_[cursor].type == type) {
      return &events_[cursor++];
    }
    cursor++;
  }
  return nullptr;
}

void EventLog::Reset() {
  std::lock_guard<std::mutex> lock(mutex_);
  read_cursors_.clear();
}

size_t EventLog::events_by_type(EventType type) const {
  size_t count = 0;
  for (const auto& e : events_) {
    if (e.type == type) count++;
  }
  return count;
}

}  // namespace v8_recorder
