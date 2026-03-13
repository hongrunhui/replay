// Copyright 2024 V8 Recorder Project
// Recording platform wrapper — intercepts non-deterministic v8::Platform calls

#ifndef V8_RECORDER_RECORDING_PLATFORM_H_
#define V8_RECORDER_RECORDING_PLATFORM_H_

#include <memory>
#include "include/v8-platform.h"
#include "src/recording/event_log.h"

namespace v8_recorder {

class RecordingPlatform : public v8::Platform {
 public:
  RecordingPlatform(std::unique_ptr<v8::Platform> actual,
                    const char* output_file);
  ~RecordingPlatform() override;

  // --- Non-deterministic methods: call real platform, record return value ---

  double MonotonicallyIncreasingTime() override {
    double val = actual_->MonotonicallyIncreasingTime();
    log_.Append(EventType::MONOTONIC_TIME, &val, sizeof(val));
    return val;
  }

  double CurrentClockTimeMillis() override {
    double val = actual_->CurrentClockTimeMillis();
    log_.Append(EventType::WALL_CLOCK_TIME, &val, sizeof(val));
    return val;
  }

  // --- Pass-through methods ---

  v8::PageAllocator* GetPageAllocator() override {
    return actual_->GetPageAllocator();
  }

  int NumberOfWorkerThreads() override {
    return actual_->NumberOfWorkerThreads();
  }

  std::shared_ptr<v8::TaskRunner> GetForegroundTaskRunner(
      v8::Isolate* isolate) override {
    return actual_->GetForegroundTaskRunner(isolate);
  }
  void CallOnWorkerThread(std::unique_ptr<v8::Task> task) override {
    actual_->CallOnWorkerThread(std::move(task));
  }

  void CallBlockingTaskOnWorkerThread(
      std::unique_ptr<v8::Task> task) override {
    actual_->CallBlockingTaskOnWorkerThread(std::move(task));
  }

  void CallLowPriorityTaskOnWorkerThread(
      std::unique_ptr<v8::Task> task) override {
    actual_->CallLowPriorityTaskOnWorkerThread(std::move(task));
  }

  void CallDelayedOnWorkerThread(std::unique_ptr<v8::Task> task,
                                 double delay_in_seconds) override {
    actual_->CallDelayedOnWorkerThread(std::move(task), delay_in_seconds);
  }

  bool IdleTasksEnabled(v8::Isolate* isolate) override {
    return actual_->IdleTasksEnabled(isolate);
  }

  std::unique_ptr<v8::JobHandle> CreateJob(
      v8::TaskPriority priority,
      std::unique_ptr<v8::JobTask> job_task) override {
    return actual_->CreateJob(priority, std::move(job_task));
  }

  v8::TracingController* GetTracingController() override {
    return actual_->GetTracingController();
  }

  // --- Accessors ---
  EventLog& log() { return log_; }
  v8::Platform* actual() { return actual_.get(); }

 private:
  std::unique_ptr<v8::Platform> actual_;
  EventLog log_;
};

}  // namespace v8_recorder

#endif  // V8_RECORDER_RECORDING_PLATFORM_H_
