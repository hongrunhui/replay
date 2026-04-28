// state.h —— 浏览器版 driver 全局状态
//
// 进程启动时（auto_init via __attribute__((constructor))）做：
//   1. 从 argv 嗅 --type= 决定进程角色（browser / renderer / gpu / utility / network）
//   2. 读环境变量 OPENREPLAY_MODE（record / replay / off）
//   3. 读环境变量 OPENREPLAY_SESSION 决定 session uuid
//   4. 按 ~/.openreplay/recordings/<uuid>/<role>-<pid>.orec 路径开 RecordingWriter/Reader
//
// 所有 V8RecordReplay* / RecordReplay* 真实实现都通过 GetState() 拿到这个全局对象。

#ifndef OPENREPLAY_BROWSER_STATE_H_
#define OPENREPLAY_BROWSER_STATE_H_

#include <pthread.h>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>

#include "recording.h"

namespace openreplay {

enum class Mode {
  kOff,
  kRecord,
  kReplay,
};

enum class ProcessRole {
  kUnknown,
  kBrowser,    // 主进程（无 --type=）
  kRenderer,   // --type=renderer
  kGpu,        // --type=gpu-process
  kUtility,    // --type=utility
  kNetwork,    // --type=utility --utility-sub-type=network.mojom.NetworkService
  kZygote,     // --type=zygote (Linux)
};

const char* RoleName(ProcessRole r);

class DriverState {
 public:
  // 全局单例 —— 进程内只有一份，懒初始化（非 static 局部变量，避免静态构造器
  // 顺序问题；用 pthread_once）
  static DriverState* Get();

  Mode mode() const { return mode_; }
  bool is_recording() const { return mode_ == Mode::kRecord; }
  bool is_replaying() const { return mode_ == Mode::kReplay; }
  ProcessRole role() const { return role_; }
  pid_t pid() const { return pid_; }
  const std::string& session_id() const { return session_id_; }

  // 录制接口（线程安全；内部已加锁）
  void WriteValue(const char* why, uintptr_t value);
  void WriteBytes(const char* why, const void* buf, size_t size);
  void WriteMetadata(const std::string& json);

  // 回放接口
  // 取回放出的下一个 why 标签的 VALUE 事件；找不到时返回 default_value
  uintptr_t ReadValue(const char* why, uintptr_t default_value);
  // 取下一个 why 标签的 BYTES 事件，把内容拷进 buf；找不到时不动 buf 并返回 false
  bool ReadBytes(const char* why, void* buf, size_t size);
  // 仅消费下一个 why 标签的事件（不关心内容大小，纯进度对齐）
  // 用于纯遥测类的 V8RecordReplayOn* 回调，回放时只需推进游标
  void ReplayConsumeEvent(const char* why);

  // 暴露事件计数（含遥测）
  uint64_t recorded_events() const;

  // 主线程识别：第一个调进 driver 的线程被标记为"主线程"
  bool IsMainThread();

  // 日志（OPENREPLAY_DEBUG_LOG 指向的文件，没设就 stderr）
  void Log(const char* format, va_list args);

  DriverState();
  ~DriverState();
  DriverState(const DriverState&) = delete;
  DriverState& operator=(const DriverState&) = delete;

 private:

  void DetectProcessRole();
  void ResolveSessionAndOpen();

  Mode mode_ = Mode::kOff;
  ProcessRole role_ = ProcessRole::kUnknown;
  pid_t pid_ = 0;
  std::string session_id_;
  std::string orec_path_;

  std::unique_ptr<RecordingWriter> writer_;
  std::unique_ptr<RecordingReader> reader_;

  // 主线程识别
  pthread_t main_thread_ = 0;
  std::atomic<bool> main_thread_set_{false};

  // 日志
  FILE* log_fp_ = nullptr;
  pthread_mutex_t log_lock_ = PTHREAD_MUTEX_INITIALIZER;
};

}  // namespace openreplay

#endif  // OPENREPLAY_BROWSER_STATE_H_
