// Open Replay — Recording File Format Implementation

/*
 * 【录制文件格式 (.orec)】
 *
 * 文件结构：
 *   [FileHeader: 64 字节] — magic "OREC0001" + 版本 + 时间戳 + build_id
 *   [Event Stream]        — 连续的事件记录
 *   [Checkpoint Index]    — checkpoint 数量 + CheckpointEntry 数组
 *   [FileTail: 32 字节]   — 总事件数 + checkpoint_offset + sentinel 0xDEADBEEF
 *
 * 每个事件：[type:u8][why_hash:u32][data_len:u32][data:bytes]
 *   - type: VALUE(标量值) / BYTES(二进制数据) / STRING / CHECKPOINT / METADATA
 *   - why_hash: 调用点语义标识的 FNV 哈希（如 "open" → 0x1234abcd）
 *   - data: 具体录制的数据（返回值、缓冲区内容等）
 *
 * 设计要点：
 * 1. Writer 使用 raw::write/open 直接系统调用写文件，避免被 DYLD_INTERPOSE 拦截。
 * 2. Reader 一次性将整个文件读入内存再解析，简化随机访问逻辑。
 * 3. 回放时 METADATA 事件不加入事件流（events_），因为它不是可回放的系统调用，
 *    只是附加信息（如脚本路径）。如果加入事件流会导致 why_hash 匹配错位。
 */

#include "format/recording.h"
#include "raw_syscall.h"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>

namespace openreplay {

// ============================================================
// RecordingWriter
// ============================================================

RecordingWriter::RecordingWriter() = default;

RecordingWriter::~RecordingWriter() {
  if (fd_ >= 0) Close();
}

/*
 * 【RawWrite】使用 raw::write（直接 syscall）写入文件。
 * 不能用 libc 的 write()，因为它会被 DYLD_INTERPOSE 拦截，
 * 导致在录制模式下写录制文件本身又触发录制——无限递归。
 */
void RecordingWriter::RawWrite(const void* buf, size_t len) {
  const char* p = static_cast<const char*>(buf);
  while (len > 0) {
    ssize_t n = raw::write(fd_, p, len);
    if (n <= 0) break;
    p += n;
    len -= n;
  }
}

bool RecordingWriter::Open(const char* path, const char* build_id) {
  pthread_mutex_lock(&mutex_);
  fd_ = raw::open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd_ < 0) {
    fprintf(stderr, "[openreplay] Failed to open recording: %s\n", path);
    pthread_mutex_unlock(&mutex_);
    return false;
  }

  // Write header
  FileHeader hdr{};
  memcpy(hdr.magic, kMagic, 8);
  hdr.version = kFormatVersion;
  hdr.flags = 0;
  auto now = std::chrono::system_clock::now();
  hdr.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
      now.time_since_epoch()).count();
  if (build_id) {
    strncpy(hdr.build_id, build_id, sizeof(hdr.build_id) - 1);
  }
  hdr.reserved = 0;
  RawWrite(&hdr, sizeof(hdr));

  event_count_ = 0;
  stream_offset_ = sizeof(FileHeader);
  checkpoints_.clear();

  fprintf(stderr, "[openreplay] Recording started: %s\n", path);
  pthread_mutex_unlock(&mutex_);
  return true;
}

void RecordingWriter::WriteEvent(EventType type, const char* why,
                                 const void* data, size_t data_len) {
  pthread_mutex_lock(&mutex_);
  if (fd_ < 0) { pthread_mutex_unlock(&mutex_); return; }

  EventHeader eh;
  eh.type = type;
  eh.why_hash = why ? FnvHash(why) : 0;
  eh.data_len = static_cast<uint32_t>(data_len);

  RawWrite(&eh.type, 1);
  RawWrite(&eh.why_hash, 4);
  RawWrite(&eh.data_len, 4);
  if (data_len > 0 && data) {
    RawWrite(data, data_len);
  }

  stream_offset_ += 9 + data_len;
  event_count_++;
  pthread_mutex_unlock(&mutex_);
}

void RecordingWriter::WriteCheckpoint(uint64_t progress) {
  pthread_mutex_lock(&mutex_);
  if (fd_ < 0) { pthread_mutex_unlock(&mutex_); return; }

  CheckpointEntry cp;
  cp.id = static_cast<uint32_t>(checkpoints_.size());
  cp.file_offset = stream_offset_;
  cp.progress = progress;
  cp.event_index = event_count_;
  checkpoints_.push_back(cp);

  EventHeader eh;
  eh.type = EventType::CHECKPOINT;
  eh.why_hash = 0;
  eh.data_len = sizeof(uint64_t);

  RawWrite(&eh.type, 1);
  RawWrite(&eh.why_hash, 4);
  RawWrite(&eh.data_len, 4);
  RawWrite(&progress, sizeof(uint64_t));

  stream_offset_ += 9 + sizeof(uint64_t);
  event_count_++;
  pthread_mutex_unlock(&mutex_);
}

void RecordingWriter::WriteMetadata(const std::string& json) {
  pthread_mutex_lock(&mutex_);
  if (fd_ < 0) { pthread_mutex_unlock(&mutex_); return; }

  EventHeader eh;
  eh.type = EventType::METADATA;
  eh.why_hash = 0;
  eh.data_len = static_cast<uint32_t>(json.size());

  RawWrite(&eh.type, 1);
  RawWrite(&eh.why_hash, 4);
  RawWrite(&eh.data_len, 4);
  RawWrite(json.data(), json.size());

  stream_offset_ += 9 + json.size();
  event_count_++;
  pthread_mutex_unlock(&mutex_);
}

void RecordingWriter::Close() {
  pthread_mutex_lock(&mutex_);
  if (fd_ < 0) { pthread_mutex_unlock(&mutex_); return; }

  // Write checkpoint index
  uint64_t checkpoint_offset = sizeof(FileHeader) + stream_offset_;
  uint32_t cp_count = static_cast<uint32_t>(checkpoints_.size());
  RawWrite(&cp_count, 4);
  for (const auto& cp : checkpoints_) {
    RawWrite(&cp, sizeof(CheckpointEntry));
  }

  // Write tail
  uint64_t metadata_offset = 0;
  FileTail tail{};
  tail.total_events = event_count_;
  tail.checkpoint_offset = checkpoint_offset;
  tail.metadata_offset = metadata_offset;
  tail.sentinel = 0xDEADBEEF;
  tail.reserved = 0;
  RawWrite(&tail, sizeof(FileTail));

  raw::fsync(fd_);
  raw::close(fd_);
  fd_ = -1;

  fprintf(stderr, "[openreplay] Recording finished. Events: %llu, Checkpoints: %u\n",
          event_count_, cp_count);
  pthread_mutex_unlock(&mutex_);
}

// ============================================================
// RecordingReader
// ============================================================

RecordingReader::RecordingReader() = default;
RecordingReader::~RecordingReader() { Close(); }

bool RecordingReader::Open(const char* path) {
  events_.clear();
  cursors_.clear();
  global_cursor_ = 0;
  checkpoints_.clear();
  metadata_.clear();

  // Read entire file into memory
  int fd = raw::open(path, O_RDONLY);
  if (fd < 0) {
    fprintf(stderr, "[openreplay] Failed to open recording: %s\n", path);
    return false;
  }

  /*
   * 使用 libc fstat 而非 raw::fstat。
   * 原因：macOS arm64 上 SYS_fstat 直接 syscall 返回的 size 为 0（内核 ABI 问题），
   * 但此时 mode 还是 IDLE（Reader 在 Attach 设置模式之前打开），
   * 所以 libc fstat 不会被 DYLD_INTERPOSE 拦截，可以安全使用。
   */
  struct stat st;
  if (::fstat(fd, &st) < 0 || st.st_size < static_cast<off_t>(sizeof(FileHeader) + sizeof(FileTail))) {
    fprintf(stderr, "[openreplay] Recording file too small: %s\n", path);
    raw::close(fd);
    return false;
  }

  std::vector<uint8_t> buf(st.st_size);
  ssize_t total = 0;
  while (total < st.st_size) {
    ssize_t n = raw::read(fd, buf.data() + total, st.st_size - total);
    if (n <= 0) break;
    total += n;
  }
  raw::close(fd);

  if (total < st.st_size) {
    fprintf(stderr, "[openreplay] Short read on recording file\n");
    return false;
  }

  // Parse header
  memcpy(&header_, buf.data(), sizeof(FileHeader));
  if (memcmp(header_.magic, kMagic, 8) != 0) {
    fprintf(stderr, "[openreplay] Invalid magic in recording file\n");
    return false;
  }
  if (header_.version != kFormatVersion) {
    fprintf(stderr, "[openreplay] Unsupported format version: %u\n", header_.version);
    return false;
  }

  // Parse tail
  if (!ParseTail(buf.data(), buf.size())) {
    fprintf(stderr, "[openreplay] Invalid file tail\n");
    return false;
  }

  // Parse event stream (between header and checkpoint index)
  size_t events_start = sizeof(FileHeader);
  size_t events_end = static_cast<size_t>(
      buf.size() - sizeof(FileTail));

  // Parse checkpoint index (before tail)
  // The checkpoint index starts at checkpoint_offset from tail
  FileTail tail;
  memcpy(&tail, buf.data() + buf.size() - sizeof(FileTail), sizeof(FileTail));

  size_t cp_start = static_cast<size_t>(tail.checkpoint_offset);
  if (cp_start >= sizeof(FileHeader) && cp_start < buf.size() - sizeof(FileTail)) {
    const uint8_t* cp_ptr = buf.data() + cp_start;
    uint32_t cp_count;
    memcpy(&cp_count, cp_ptr, 4);
    cp_ptr += 4;
    for (uint32_t i = 0; i < cp_count && cp_ptr + sizeof(CheckpointEntry) <= buf.data() + events_end; i++) {
      CheckpointEntry cp;
      memcpy(&cp, cp_ptr, sizeof(CheckpointEntry));
      checkpoints_.push_back(cp);
      cp_ptr += sizeof(CheckpointEntry);
    }
    events_end = cp_start;
  }

  // Parse events
  if (!ParseEvents(buf.data() + events_start, events_end - events_start)) {
    fprintf(stderr, "[openreplay] Failed to parse events\n");
    return false;
  }

  fprintf(stderr, "[openreplay] Loaded recording: %zu events, %zu checkpoints\n",
          events_.size(), checkpoints_.size());
  return true;
}

bool RecordingReader::ParseEvents(const uint8_t* data, size_t len) {
  size_t offset = 0;
  uint64_t index = 0;
  while (offset + 9 <= len) {
    Event ev;
    ev.type = static_cast<EventType>(data[offset]);
    memcpy(&ev.why_hash, data + offset + 1, 4);
    uint32_t data_len;
    memcpy(&data_len, data + offset + 5, 4);
    offset += 9;

    if (offset + data_len > len) break;

    if (data_len > 0) {
      ev.data.assign(data + offset, data + offset + data_len);
    }
    ev.index = index++;
    offset += data_len;

    /*
     * METADATA 事件不加入 events_，因为它是"带外信息"（脚本路径等），
     * 不对应任何系统调用。如果混入事件流，会占据一个位置，
     * 导致后续 NextEvent() 的游标偏移，引发回放数据错位。
     */
    if (ev.type == EventType::METADATA && !ev.data.empty()) {
      metadata_.assign(reinterpret_cast<const char*>(ev.data.data()), ev.data.size());
      continue;
    }

    events_.push_back(std::move(ev));
  }
  return true;
}

bool RecordingReader::ParseTail(const uint8_t* data, size_t total_len) {
  if (total_len < sizeof(FileTail)) return false;
  FileTail tail;
  memcpy(&tail, data + total_len - sizeof(FileTail), sizeof(FileTail));
  return tail.sentinel == 0xDEADBEEF;
}

void RecordingReader::Close() {
  events_.clear();
  cursors_.clear();
  checkpoints_.clear();
  metadata_.clear();
  global_cursor_ = 0;
}

/*
 * 【按 why_hash 的游标系统】
 * 每个不同的 why 字符串（经 FNV 哈希后）维护独立的游标 (cursors_[hash])。
 *
 * 为什么不用全局顺序游标？
 * ──────────────────────
 * 录制时事件是交错的：open, gettimeofday, read, gettimeofday, close ...
 * 回放时，每种系统调用按自己的节奏消费事件。如果用全局游标，
 * 第二次 gettimeofday 调用可能会读到中间的 read 事件——类型不匹配。
 *
 * 按 why_hash 分流后，gettimeofday 只看 why_hash 匹配的事件，
 * 自动跳过 open/read 等无关事件，实现"语义对齐"。
 *
 * 局限性：如果同一个 why 的事件顺序在录制和回放之间不同，仍会错位。
 * 这在 time/random 拦截中不是问题（调用次数和顺序由代码路径决定，
 * 而代码路径由更早的拦截保证一致），但文件 I/O 中是问题（见 fs.cc 注释）。
 */
const RecordingReader::Event* RecordingReader::NextEvent(const char* why) {
  uint32_t hash = FnvHash(why);
  size_t& cursor = cursors_[hash];
  while (cursor < events_.size()) {
    if (events_[cursor].why_hash == hash) {
      return &events_[cursor++];
    }
    cursor++;
  }
  return nullptr;
}

const RecordingReader::Event* RecordingReader::NextAny() {
  if (global_cursor_ < events_.size()) {
    return &events_[global_cursor_++];
  }
  return nullptr;
}

void RecordingReader::Reset() {
  cursors_.clear();
  global_cursor_ = 0;
}

void RecordingReader::SeekToCheckpoint(uint32_t checkpoint_id) {
  for (const auto& cp : checkpoints_) {
    if (cp.id == checkpoint_id) {
      // Reset all cursors and advance to the checkpoint's event index
      cursors_.clear();
      global_cursor_ = static_cast<size_t>(cp.event_index);
      // Also reset per-why cursors to the checkpoint position
      // (they'll naturally skip past events before the cursor)
      return;
    }
  }
}

}  // namespace openreplay
