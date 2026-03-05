// Copyright 2024 V8 Recorder Project
// Replayer implementation

#include "src/recorder/replayer.h"
#include "src/recorder/recorder.h"
#include <iostream>
#include <cstring>
#include <unordered_set>

namespace v8 {
namespace internal {

Replayer::Replayer()
    : is_replaying_(false),
      current_position_(0) {
}

Replayer::~Replayer() {
  if (input_file_.is_open()) {
    input_file_.close();
  }
}

bool Replayer::Load(const char* input_file) {
  // 打开文件
  input_file_.open(input_file, std::ios::binary);
  if (!input_file_.is_open()) {
    std::cerr << "[Replayer] Failed to open file: " << input_file << std::endl;
    return false;
  }

  // 读取文件头
  if (!ReadHeader()) {
    std::cerr << "[Replayer] Invalid file header" << std::endl;
    return false;
  }

  // 读取执行点
  if (!ReadExecutionPoints()) {
    std::cerr << "[Replayer] Failed to read execution points" << std::endl;
    return false;
  }

  // 读取非确定性数据
  if (!ReadNonDeterministicData()) {
    std::cerr << "[Replayer] Failed to read non-deterministic data" << std::endl;
    return false;
  }

  // 构建索引
  BuildIndices();

  std::cout << "[Replayer] Loaded recording from: " << input_file << std::endl;
  std::cout << "[Replayer] Total execution points: " << execution_points_.size() << std::endl;
  std::cout << "[Replayer] Non-deterministic data: " << non_deterministic_data_.size() << std::endl;

  return true;
}

bool Replayer::StartReplay() {
  if (execution_points_.empty()) {
    std::cerr << "[Replayer] No execution points loaded" << std::endl;
    return false;
  }

  is_replaying_ = true;
  current_position_ = 0;

  std::cout << "[Replayer] Started replay" << std::endl;
  return true;
}

void Replayer::StopReplay() {
  is_replaying_ = false;
  std::cout << "[Replayer] Stopped replay at position: " << current_position_ << std::endl;
}

const ExecutionPoint* Replayer::GetNextExecutionPoint() {
  if (!is_replaying_ || current_position_ >= execution_points_.size()) {
    return nullptr;
  }

  const ExecutionPoint* point = &execution_points_[current_position_];
  current_position_++;

  // 检查断点
  if (HasBreakpoint(point->id)) {
    std::cout << "[Replayer] Breakpoint hit at execution point: " << point->id << std::endl;
    is_replaying_ = false;  // 暂停重放
  }

  return point;
}

bool Replayer::GetRandomValue(uint64_t execution_point_id, double* value) {
  auto range = random_index_.equal_range(execution_point_id);
  if (range.first == range.second) {
    return false;  // 未找到
  }

  // 获取第一个匹配的数据
  size_t index = range.first->second;
  const auto& data = non_deterministic_data_[index];

  if (data.data.size() != sizeof(double)) {
    return false;
  }

  std::memcpy(value, data.data.data(), sizeof(double));
  return true;
}

bool Replayer::GetTimeValue(uint64_t execution_point_id, double* value) {
  auto range = time_index_.equal_range(execution_point_id);
  if (range.first == range.second) {
    return false;
  }

  size_t index = range.first->second;
  const auto& data = non_deterministic_data_[index];

  if (data.data.size() != sizeof(double)) {
    return false;
  }

  std::memcpy(value, data.data.data(), sizeof(double));
  return true;
}

bool Replayer::GetIOData(uint64_t execution_point_id, std::vector<uint8_t>* data) {
  auto range = io_index_.equal_range(execution_point_id);
  if (range.first == range.second) {
    return false;
  }

  size_t index = range.first->second;
  *data = non_deterministic_data_[index].data;
  return true;
}

void Replayer::SetBreakpoint(uint64_t execution_point_id) {
  breakpoints_.insert(execution_point_id);
  std::cout << "[Replayer] Breakpoint set at: " << execution_point_id << std::endl;
}

void Replayer::RemoveBreakpoint(uint64_t execution_point_id) {
  breakpoints_.erase(execution_point_id);
  std::cout << "[Replayer] Breakpoint removed at: " << execution_point_id << std::endl;
}

bool Replayer::HasBreakpoint(uint64_t execution_point_id) const {
  return breakpoints_.find(execution_point_id) != breakpoints_.end();
}

bool Replayer::JumpTo(uint64_t execution_point_id) {
  // 查找执行点
  for (size_t i = 0; i < execution_points_.size(); i++) {
    if (execution_points_[i].id == execution_point_id) {
      current_position_ = i;
      std::cout << "[Replayer] Jumped to execution point: " << execution_point_id << std::endl;
      return true;
    }
  }

  std::cerr << "[Replayer] Execution point not found: " << execution_point_id << std::endl;
  return false;
}

void Replayer::Step() {
  if (!is_replaying_) {
    is_replaying_ = true;
  }

  const ExecutionPoint* point = GetNextExecutionPoint();
  if (point) {
    std::cout << "[Replayer] Step: " << point->function_name
              << " at " << point->line_number << ":" << point->column_number << std::endl;
  } else {
    std::cout << "[Replayer] End of recording" << std::endl;
  }

  is_replaying_ = false;  // 单步后暂停
}

void Replayer::Continue() {
  if (!is_replaying_) {
    is_replaying_ = true;
  }

  std::cout << "[Replayer] Continuing from position: " << current_position_ << std::endl;
}

bool Replayer::ReadHeader() {
  // 读取 Magic (8 bytes)
  char magic[9] = {0};
  input_file_.read(magic, 8);
  if (std::strncmp(magic, kMagic, 8) != 0) {
    std::cerr << "[Replayer] Invalid magic: " << magic << std::endl;
    return false;
  }

  // 读取 Version (4 bytes)
  uint32_t version;
  input_file_.read(reinterpret_cast<char*>(&version), sizeof(version));
  if (version != kVersion) {
    std::cerr << "[Replayer] Unsupported version: " << version << std::endl;
    return false;
  }

  // 读取 Timestamp (8 bytes)
  uint64_t timestamp;
  input_file_.read(reinterpret_cast<char*>(&timestamp), sizeof(timestamp));

  // 读取 Flags (4 bytes)
  uint32_t flags;
  input_file_.read(reinterpret_cast<char*>(&flags), sizeof(flags));

  // 读取 Reserved (8 bytes)
  uint64_t reserved;
  input_file_.read(reinterpret_cast<char*>(&reserved), sizeof(reserved));

  return true;
}

bool Replayer::ReadExecutionPoints() {
  while (true) {
    // 读取执行点数量
    uint32_t count;
    input_file_.read(reinterpret_cast<char*>(&count), sizeof(count));

    if (input_file_.eof() || count == 0) {
      break;
    }

    // 读取每个执行点
    for (uint32_t i = 0; i < count; i++) {
      ExecutionPoint point;

      // ID
      input_file_.read(reinterpret_cast<char*>(&point.id), sizeof(point.id));

      // Timestamp
      input_file_.read(reinterpret_cast<char*>(&point.timestamp), sizeof(point.timestamp));

      // Bytecode offset
      input_file_.read(reinterpret_cast<char*>(&point.bytecode_offset),
                      sizeof(point.bytecode_offset));

      // Function name
      uint32_t name_len;
      input_file_.read(reinterpret_cast<char*>(&name_len), sizeof(name_len));
      point.function_name.resize(name_len);
      input_file_.read(&point.function_name[0], name_len);

      // Line number
      input_file_.read(reinterpret_cast<char*>(&point.line_number),
                      sizeof(point.line_number));

      // Column number
      input_file_.read(reinterpret_cast<char*>(&point.column_number),
                      sizeof(point.column_number));

      // Stack depth
      input_file_.read(reinterpret_cast<char*>(&point.stack_depth),
                      sizeof(point.stack_depth));

      execution_points_.push_back(std::move(point));
    }

    // 读取非确定性数据（紧跟在执行点后面）
    uint32_t nd_count;
    input_file_.read(reinterpret_cast<char*>(&nd_count), sizeof(nd_count));

    for (uint32_t i = 0; i < nd_count; i++) {
      NonDeterministicData data;

      // Type
      uint8_t type;
      input_file_.read(reinterpret_cast<char*>(&type), sizeof(type));
      data.type = static_cast<NonDeterministicType>(type);

      // Execution point ID
      input_file_.read(reinterpret_cast<char*>(&data.execution_point_id),
                      sizeof(data.execution_point_id));

      // Data length
      uint32_t data_len;
      input_file_.read(reinterpret_cast<char*>(&data_len), sizeof(data_len));

      // Data
      data.data.resize(data_len);
      input_file_.read(reinterpret_cast<char*>(data.data.data()), data_len);

      non_deterministic_data_.push_back(std::move(data));
    }
  }

  return !execution_points_.empty();
}

bool Replayer::ReadNonDeterministicData() {
  // 非确定性数据已经在 ReadExecutionPoints 中读取
  return true;
}

void Replayer::BuildIndices() {
  // 构建非确定性数据索引
  for (size_t i = 0; i < non_deterministic_data_.size(); i++) {
    const auto& data = non_deterministic_data_[i];

    switch (data.type) {
      case NonDeterministicType::RANDOM:
        random_index_.emplace(data.execution_point_id, i);
        break;
      case NonDeterministicType::TIME:
        time_index_.emplace(data.execution_point_id, i);
        break;
      case NonDeterministicType::IO:
      case NonDeterministicType::EXTERNAL:
        io_index_.emplace(data.execution_point_id, i);
        break;
    }
  }

  std::cout << "[Replayer] Built indices:" << std::endl;
  std::cout << "  Random: " << random_index_.size() << std::endl;
  std::cout << "  Time: " << time_index_.size() << std::endl;
  std::cout << "  IO: " << io_index_.size() << std::endl;
}

} // namespace internal
} // namespace v8
