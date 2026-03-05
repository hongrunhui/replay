// Copyright 2024 V8 Recorder Project
// Replayer implementation for V8 JavaScript engine

#ifndef V8_RECORDER_REPLAYER_H_
#define V8_RECORDER_REPLAYER_H_

#include <fstream>
#include <vector>
#include <string>
#include <unordered_map>
#include <memory>

namespace v8 {
namespace internal {

// 前向声明
struct ExecutionPoint;
struct NonDeterministicData;
enum class NonDeterministicType : uint8_t;

// 重放器主类
class Replayer {
 public:
  Replayer();
  ~Replayer();

  // 加载录制文件
  bool Load(const char* input_file);

  // 开始重放
  bool StartReplay();

  // 停止重放
  void StopReplay();

  // 检查是否正在重放
  bool IsReplaying() const { return is_replaying_; }

  // 获取下一个执行点
  const ExecutionPoint* GetNextExecutionPoint();

  // 获取非确定性数据
  bool GetRandomValue(uint64_t execution_point_id, double* value);
  bool GetTimeValue(uint64_t execution_point_id, double* value);
  bool GetIOData(uint64_t execution_point_id, std::vector<uint8_t>* data);

  // 断点功能
  void SetBreakpoint(uint64_t execution_point_id);
  void RemoveBreakpoint(uint64_t execution_point_id);
  bool HasBreakpoint(uint64_t execution_point_id) const;

  // 跳转到指定执行点
  bool JumpTo(uint64_t execution_point_id);

  // 单步执行
  void Step();

  // 继续执行
  void Continue();

  // 获取统计信息
  size_t GetTotalExecutionPoints() const { return execution_points_.size(); }
  size_t GetCurrentPosition() const { return current_position_; }

 private:
  // 读取文件头
  bool ReadHeader();

  // 读取执行点
  bool ReadExecutionPoints();

  // 读取非确定性数据
  bool ReadNonDeterministicData();

  // 构建索引
  void BuildIndices();

  // 成员变量
  bool is_replaying_;
  size_t current_position_;
  std::ifstream input_file_;
  std::vector<ExecutionPoint> execution_points_;
  std::vector<NonDeterministicData> non_deterministic_data_;

  // 索引：execution_point_id -> 非确定性数据
  std::unordered_multimap<uint64_t, size_t> random_index_;
  std::unordered_multimap<uint64_t, size_t> time_index_;
  std::unordered_multimap<uint64_t, size_t> io_index_;

  // 断点集合
  std::unordered_set<uint64_t> breakpoints_;

  // 文件格式常量
  static constexpr const char* kMagic = "V8REC001";
  static constexpr uint32_t kVersion = 1;
};

} // namespace internal
} // namespace v8

#endif  // V8_RECORDER_REPLAYER_H_
