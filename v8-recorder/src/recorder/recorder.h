// Copyright 2024 V8 Recorder Project
// Recorder implementation for V8 JavaScript engine

#ifndef V8_RECORDER_RECORDER_H_
#define V8_RECORDER_RECORDER_H_

#include <fstream>
#include <vector>
#include <string>
#include <mutex>
#include <memory>

namespace v8 {
namespace internal {

// 执行点记录
struct ExecutionPoint {
  uint64_t id;                    // 执行点 ID
  uint64_t timestamp;             // 时间戳（微秒）
  int32_t bytecode_offset;        // 字节码偏移
  std::string function_name;      // 函数名
  int32_t line_number;            // 行号
  int32_t column_number;          // 列号
  uint32_t stack_depth;           // 调用栈深度
};

// 非确定性数据类型
enum class NonDeterministicType : uint8_t {
  RANDOM = 0,      // Math.random()
  TIME = 1,        // Date.now()
  IO = 2,          // I/O 操作
  EXTERNAL = 3     // 外部调用
};

// 非确定性数据记录
struct NonDeterministicData {
  NonDeterministicType type;
  uint64_t execution_point_id;
  std::vector<uint8_t> data;
};

// 录制器主类
class Recorder {
 public:
  // 获取单例
  static Recorder* GetInstance();

  // 开始录制
  bool StartRecording(const char* output_file);

  // 停止录制
  void StopRecording();

  // 检查是否正在录制
  bool IsRecording() const { return is_recording_; }

  // 记录执行点
  void RecordExecutionPoint(
      int bytecode_offset,
      const char* function_name,
      int line_number,
      int column_number,
      uint32_t stack_depth);

  // 记录非确定性数据
  void RecordRandom(double value);
  void RecordTime(double value);
  void RecordIO(const char* operation, const void* data, size_t len);
  void RecordExternal(const char* name, const void* data, size_t len);

  // 获取统计信息
  uint64_t GetExecutionPointCount() const { return next_point_id_; }
  uint64_t GetNonDeterministicDataCount() const {
    return non_deterministic_data_.size();
  }

 private:
  Recorder();
  ~Recorder();

  // 禁止拷贝
  Recorder(const Recorder&) = delete;
  Recorder& operator=(const Recorder&) = delete;

  // 刷新缓冲区到文件
  void Flush();

  // 写入文件头
  void WriteHeader();

  // 写入执行点
  void WriteExecutionPoints();

  // 写入非确定性数据
  void WriteNonDeterministicData();

  // 成员变量
  bool is_recording_;
  uint64_t next_point_id_;
  uint32_t current_stack_depth_;
  std::ofstream output_file_;
  std::vector<ExecutionPoint> execution_points_;
  std::vector<NonDeterministicData> non_deterministic_data_;
  std::mutex mutex_;  // 线程安全

  // 配置
  static constexpr size_t kFlushThreshold = 1000;  // 每 1000 个点刷新一次
  static constexpr const char* kMagic = "V8REC001";
  static constexpr uint32_t kVersion = 1;
};

} // namespace internal
} // namespace v8

#endif  // V8_RECORDER_RECORDER_H_
