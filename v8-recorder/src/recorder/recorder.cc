// Copyright 2024 V8 Recorder Project
// Recorder implementation

#include "src/recorder/recorder.h"
#include <chrono>
#include <cstring>
#include <iostream>

namespace v8 {
namespace internal {

// 单例实现
Recorder* Recorder::GetInstance() {
  static Recorder instance;
  return &instance;
}

Recorder::Recorder()
    : is_recording_(false),
      next_point_id_(0),
      current_stack_depth_(0) {
}

Recorder::~Recorder() {
  if (is_recording_) {
    StopRecording();
  }
}

bool Recorder::StartRecording(const char* output_file) {
  std::lock_guard<std::mutex> lock(mutex_);

  if (is_recording_) {
    std::cerr << "[Recorder] Already recording" << std::endl;
    return false;
  }

  // 打开输出文件
  output_file_.open(output_file, std::ios::binary | std::ios::trunc);
  if (!output_file_.is_open()) {
    std::cerr << "[Recorder] Failed to open file: " << output_file << std::endl;
    return false;
  }

  // 重置状态
  is_recording_ = true;
  next_point_id_ = 0;
  current_stack_depth_ = 0;
  execution_points_.clear();
  non_deterministic_data_.clear();

  // 写入文件头
  WriteHeader();

  std::cout << "[Recorder] Started recording to: " << output_file << std::endl;
  return true;
}

void Recorder::StopRecording() {
  std::lock_guard<std::mutex> lock(mutex_);

  if (!is_recording_) {
    return;
  }

  // 刷新剩余数据
  Flush();

  // 关闭文件
  output_file_.close();
  is_recording_ = false;

  std::cout << "[Recorder] Stopped recording" << std::endl;
  std::cout << "[Recorder] Total execution points: " << next_point_id_ << std::endl;
  std::cout << "[Recorder] Non-deterministic data: "
            << non_deterministic_data_.size() << std::endl;
}

void Recorder::RecordExecutionPoint(
    int bytecode_offset,
    const char* function_name,
    int line_number,
    int column_number,
    uint32_t stack_depth) {

  if (!is_recording_) return;

  std::lock_guard<std::mutex> lock(mutex_);

  // 获取当前时间戳（微秒）
  auto now = std::chrono::steady_clock::now();
  auto micros = std::chrono::duration_cast<std::chrono::microseconds>(
      now.time_since_epoch()).count();

  // 创建执行点
  ExecutionPoint point;
  point.id = next_point_id_++;
  point.timestamp = static_cast<uint64_t>(micros);
  point.bytecode_offset = bytecode_offset;
  point.function_name = function_name ? function_name : "<anonymous>";
  point.line_number = line_number;
  point.column_number = column_number;
  point.stack_depth = stack_depth;

  execution_points_.push_back(std::move(point));

  // 达到阈值时刷新
  if (execution_points_.size() >= kFlushThreshold) {
    Flush();
  }
}

void Recorder::RecordRandom(double value) {
  if (!is_recording_) return;

  std::lock_guard<std::mutex> lock(mutex_);

  NonDeterministicData data;
  data.type = NonDeterministicType::RANDOM;
  data.execution_point_id = next_point_id_ > 0 ? next_point_id_ - 1 : 0;
  data.data.resize(sizeof(double));
  std::memcpy(data.data.data(), &value, sizeof(double));

  non_deterministic_data_.push_back(std::move(data));
}

void Recorder::RecordTime(double value) {
  if (!is_recording_) return;

  std::lock_guard<std::mutex> lock(mutex_);

  NonDeterministicData data;
  data.type = NonDeterministicType::TIME;
  data.execution_point_id = next_point_id_ > 0 ? next_point_id_ - 1 : 0;
  data.data.resize(sizeof(double));
  std::memcpy(data.data.data(), &value, sizeof(double));

  non_deterministic_data_.push_back(std::move(data));
}

void Recorder::RecordIO(const char* operation, const void* data, size_t len) {
  if (!is_recording_) return;

  std::lock_guard<std::mutex> lock(mutex_);

  NonDeterministicData nd_data;
  nd_data.type = NonDeterministicType::IO;
  nd_data.execution_point_id = next_point_id_ > 0 ? next_point_id_ - 1 : 0;

  // 格式: [operation_len][operation][data_len][data]
  size_t op_len = std::strlen(operation);
  nd_data.data.resize(sizeof(uint32_t) + op_len + sizeof(uint32_t) + len);

  uint8_t* ptr = nd_data.data.data();

  // 写入操作名长度
  *reinterpret_cast<uint32_t*>(ptr) = static_cast<uint32_t>(op_len);
  ptr += sizeof(uint32_t);

  // 写入操作名
  std::memcpy(ptr, operation, op_len);
  ptr += op_len;

  // 写入数据长度
  *reinterpret_cast<uint32_t*>(ptr) = static_cast<uint32_t>(len);
  ptr += sizeof(uint32_t);

  // 写入数据
  std::memcpy(ptr, data, len);

  non_deterministic_data_.push_back(std::move(nd_data));
}

void Recorder::RecordExternal(const char* name, const void* data, size_t len) {
  if (!is_recording_) return;

  std::lock_guard<std::mutex> lock(mutex_);

  NonDeterministicData nd_data;
  nd_data.type = NonDeterministicType::EXTERNAL;
  nd_data.execution_point_id = next_point_id_ > 0 ? next_point_id_ - 1 : 0;

  // 格式同 RecordIO
  size_t name_len = std::strlen(name);
  nd_data.data.resize(sizeof(uint32_t) + name_len + sizeof(uint32_t) + len);

  uint8_t* ptr = nd_data.data.data();
  *reinterpret_cast<uint32_t*>(ptr) = static_cast<uint32_t>(name_len);
  ptr += sizeof(uint32_t);
  std::memcpy(ptr, name, name_len);
  ptr += name_len;
  *reinterpret_cast<uint32_t*>(ptr) = static_cast<uint32_t>(len);
  ptr += sizeof(uint32_t);
  std::memcpy(ptr, data, len);

  non_deterministic_data_.push_back(std::move(nd_data));
}

void Recorder::WriteHeader() {
  // Magic (8 bytes)
  output_file_.write(kMagic, 8);

  // Version (4 bytes)
  output_file_.write(reinterpret_cast<const char*>(&kVersion), sizeof(kVersion));

  // Timestamp (8 bytes)
  auto now = std::chrono::system_clock::now();
  auto timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
      now.time_since_epoch()).count();
  uint64_t ts = static_cast<uint64_t>(timestamp);
  output_file_.write(reinterpret_cast<const char*>(&ts), sizeof(ts));

  // Flags (4 bytes) - 保留
  uint32_t flags = 0;
  output_file_.write(reinterpret_cast<const char*>(&flags), sizeof(flags));

  // Reserved (8 bytes)
  uint64_t reserved = 0;
  output_file_.write(reinterpret_cast<const char*>(&reserved), sizeof(reserved));
}

void Recorder::WriteExecutionPoints() {
  // 写入执行点数量
  uint32_t count = static_cast<uint32_t>(execution_points_.size());
  output_file_.write(reinterpret_cast<const char*>(&count), sizeof(count));

  // 写入每个执行点
  for (const auto& point : execution_points_) {
    // ID
    output_file_.write(reinterpret_cast<const char*>(&point.id), sizeof(point.id));

    // Timestamp
    output_file_.write(reinterpret_cast<const char*>(&point.timestamp),
                      sizeof(point.timestamp));

    // Bytecode offset
    output_file_.write(reinterpret_cast<const char*>(&point.bytecode_offset),
                      sizeof(point.bytecode_offset));

    // Function name
    uint32_t name_len = static_cast<uint32_t>(point.function_name.length());
    output_file_.write(reinterpret_cast<const char*>(&name_len), sizeof(name_len));
    output_file_.write(point.function_name.c_str(), name_len);

    // Line number
    output_file_.write(reinterpret_cast<const char*>(&point.line_number),
                      sizeof(point.line_number));

    // Column number
    output_file_.write(reinterpret_cast<const char*>(&point.column_number),
                      sizeof(point.column_number));

    // Stack depth
    output_file_.write(reinterpret_cast<const char*>(&point.stack_depth),
                      sizeof(point.stack_depth));
  }

  execution_points_.clear();
}

void Recorder::WriteNonDeterministicData() {
  // 写入非确定性数据数量
  uint32_t count = static_cast<uint32_t>(non_deterministic_data_.size());
  output_file_.write(reinterpret_cast<const char*>(&count), sizeof(count));

  // 写入每个数据
  for (const auto& data : non_deterministic_data_) {
    // Type
    uint8_t type = static_cast<uint8_t>(data.type);
    output_file_.write(reinterpret_cast<const char*>(&type), sizeof(type));

    // Execution point ID
    output_file_.write(reinterpret_cast<const char*>(&data.execution_point_id),
                      sizeof(data.execution_point_id));

    // Data length
    uint32_t data_len = static_cast<uint32_t>(data.data.size());
    output_file_.write(reinterpret_cast<const char*>(&data_len), sizeof(data_len));

    // Data
    output_file_.write(reinterpret_cast<const char*>(data.data.data()), data_len);
  }

  non_deterministic_data_.clear();
}

void Recorder::Flush() {
  if (!output_file_.is_open()) return;

  WriteExecutionPoints();
  WriteNonDeterministicData();
  output_file_.flush();
}

} // namespace internal
} // namespace v8
