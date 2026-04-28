// state.cc —— 全局 driver 状态实现

#include "state.h"

#include <crt_externs.h>  // _NSGetArgc, _NSGetArgv
#include <dirent.h>
#include <pthread.h>
#include <sys/stat.h>
#include <unistd.h>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace openreplay {

const char* RoleName(ProcessRole r) {
  switch (r) {
    case ProcessRole::kBrowser:  return "browser";
    case ProcessRole::kRenderer: return "renderer";
    case ProcessRole::kGpu:      return "gpu";
    case ProcessRole::kUtility:  return "utility";
    case ProcessRole::kNetwork:  return "network";
    case ProcessRole::kZygote:   return "zygote";
    default:                     return "unknown";
  }
}

namespace {

// 全局指针 + pthread_once 懒初始化（避免静态构造器顺序坑——见 Node.js 经验）
DriverState* g_state = nullptr;
pthread_once_t g_state_once = PTHREAD_ONCE_INIT;

void InitState() { g_state = new DriverState(); }

bool ParseArgvForType(std::string& out_type) {
  // macOS: _NSGetArgc/Argv
  int* argcp = _NSGetArgc();
  char*** argvp = _NSGetArgv();
  if (!argcp || !argvp) return false;
  int argc = *argcp;
  char** argv = *argvp;
  for (int i = 1; i < argc; ++i) {
    if (argv[i] && std::strncmp(argv[i], "--type=", 7) == 0) {
      out_type = argv[i] + 7;
      return true;
    }
  }
  return false;
}

bool ParseArgvForUtilitySubtype(std::string& out_subtype) {
  int* argcp = _NSGetArgc();
  char*** argvp = _NSGetArgv();
  if (!argcp || !argvp) return false;
  int argc = *argcp;
  char** argv = *argvp;
  for (int i = 1; i < argc; ++i) {
    if (argv[i] && std::strncmp(argv[i], "--utility-sub-type=", 19) == 0) {
      out_subtype = argv[i] + 19;
      return true;
    }
  }
  return false;
}

void EnsureDir(const std::string& path) {
  // 递归 mkdir -p，简陋实现
  size_t pos = 0;
  while ((pos = path.find('/', pos + 1)) != std::string::npos) {
    std::string sub = path.substr(0, pos);
    mkdir(sub.c_str(), 0755);
  }
  mkdir(path.c_str(), 0755);
}

std::string GetHomeDir() {
  const char* h = std::getenv("HOME");
  if (h && *h) return std::string(h);
  return "/tmp";
}

}  // anonymous namespace

DriverState* DriverState::Get() {
  pthread_once(&g_state_once, &InitState);
  return g_state;
}

DriverState::DriverState() {
  pid_ = getpid();
  DetectProcessRole();

  // 模式
  const char* mode_env = std::getenv("OPENREPLAY_MODE");
  if (mode_env) {
    if (std::strcmp(mode_env, "record") == 0) mode_ = Mode::kRecord;
    else if (std::strcmp(mode_env, "replay") == 0) mode_ = Mode::kReplay;
    else mode_ = Mode::kOff;
  }

  // 日志：OPENREPLAY_DEBUG_LOG 指定路径，否则 stderr
  const char* log_path = std::getenv("OPENREPLAY_DEBUG_LOG");
  if (log_path && *log_path) {
    char path_with_role[1024];
    std::snprintf(path_with_role, sizeof(path_with_role),
                  "%s.%s-%d", log_path, RoleName(role_), (int)pid_);
    log_fp_ = std::fopen(path_with_role, "w");
  }
  if (!log_fp_) log_fp_ = stderr;

  // 启动横幅
  std::fprintf(log_fp_,
               "[openreplay] driver loaded: role=%s pid=%d mode=%s\n",
               RoleName(role_), (int)pid_,
               mode_ == Mode::kRecord  ? "record" :
               mode_ == Mode::kReplay  ? "replay" : "off");
  std::fflush(log_fp_);

  if (mode_ != Mode::kOff) {
    ResolveSessionAndOpen();
  }

  // 注册 atexit 让 .orec 文件能在进程退出时正常关（写 tail + sentinel）。
  // chromium 的 renderer/gpu 子进程退出走 _exit() 不调静态析构，仅靠 ~DriverState
  // 在 main thread C++ 退出阶段触发，但 _exit() 跳过这阶段。atexit 注册的回调
  // 只在 exit() 时跑，_exit 也跳过——但绝大多数 chromium 进程走的是 normal exit。
  std::atexit(+[]() {
    auto* s = DriverState::Get();
    if (s->writer_) s->writer_->Close();
  });
}

DriverState::~DriverState() {
  if (writer_) writer_->Close();
  if (log_fp_ && log_fp_ != stderr) std::fclose(log_fp_);
}

void DriverState::DetectProcessRole() {
  std::string type;
  if (!ParseArgvForType(type)) {
    role_ = ProcessRole::kBrowser;
    return;
  }
  if (type == "renderer") role_ = ProcessRole::kRenderer;
  else if (type == "gpu-process") role_ = ProcessRole::kGpu;
  else if (type == "zygote") role_ = ProcessRole::kZygote;
  else if (type == "utility") {
    std::string sub;
    if (ParseArgvForUtilitySubtype(sub) && sub.find("network") != std::string::npos) {
      role_ = ProcessRole::kNetwork;
    } else {
      role_ = ProcessRole::kUtility;
    }
  } else {
    role_ = ProcessRole::kUnknown;
  }
}

void DriverState::ResolveSessionAndOpen() {
  const char* sess = std::getenv("OPENREPLAY_SESSION");
  if (sess && *sess) {
    session_id_ = sess;
  } else {
    // 主进程没传 session 就生成一个；子进程理应继承
    char buf[64];
    std::snprintf(buf, sizeof(buf), "session-%ld-%d",
                  (long)::time(nullptr), (int)pid_);
    session_id_ = buf;
    // 子进程运行时无法回写父进程的环境，所以仅在 browser 进程做这件事；
    // 用户应当通过 launch 脚本预先 export OPENREPLAY_SESSION 给所有子进程
    if (role_ == ProcessRole::kBrowser) {
      ::setenv("OPENREPLAY_SESSION", buf, 1);
    }
  }

  std::string base = GetHomeDir() + "/.openreplay/recordings/" + session_id_;
  EnsureDir(base);

  char file[1024];
  if (mode_ == Mode::kRecord) {
    // 录制时按 <role>-<pid>.orec 命名，避免同 role 的多进程冲突
    std::snprintf(file, sizeof(file), "%s/%s-%d.orec",
                  base.c_str(), RoleName(role_), (int)pid_);
  } else {
    // 回放时 pid 跟录制时不一样，按 role 找匹配的 .orec
    // 一个 session 同 role 可能有多份（重启/重连）—— MVP 取字典序最早一份
    DIR* d = opendir(base.c_str());
    std::string match;
    if (d) {
      std::string prefix = std::string(RoleName(role_)) + "-";
      struct dirent* ent;
      while ((ent = readdir(d)) != nullptr) {
        std::string name(ent->d_name);
        if (name.size() > prefix.size() + 5 &&
            name.compare(0, prefix.size(), prefix) == 0 &&
            name.substr(name.size() - 5) == ".orec") {
          if (match.empty() || name < match) match = name;
        }
      }
      closedir(d);
    }
    if (match.empty()) {
      std::snprintf(file, sizeof(file), "%s/%s-MISSING.orec",
                    base.c_str(), RoleName(role_));
    } else {
      std::snprintf(file, sizeof(file), "%s/%s", base.c_str(), match.c_str());
    }
  }
  orec_path_ = file;

  if (mode_ == Mode::kRecord) {
    writer_ = std::make_unique<RecordingWriter>();
    char build_id[33] = "chromium-replay-108";
    if (!writer_->Open(orec_path_.c_str(), build_id)) {
      std::fprintf(log_fp_, "[openreplay] FAILED to open writer at %s\n",
                   orec_path_.c_str());
      writer_.reset();
      mode_ = Mode::kOff;
    } else {
      std::fprintf(log_fp_, "[openreplay] recording → %s\n", orec_path_.c_str());
    }
  } else if (mode_ == Mode::kReplay) {
    reader_ = std::make_unique<RecordingReader>();
    if (!reader_->Open(orec_path_.c_str())) {
      std::fprintf(log_fp_, "[openreplay] FAILED to open reader at %s\n",
                   orec_path_.c_str());
      reader_.reset();
      mode_ = Mode::kOff;
    } else {
      std::fprintf(log_fp_, "[openreplay] replaying ← %s (%zu events)\n",
                   orec_path_.c_str(), reader_->total_events());
    }
  }
  std::fflush(log_fp_);
}

void DriverState::WriteValue(const char* why, uintptr_t value) {
  if (!writer_) return;
  writer_->WriteEvent(EventType::VALUE, why, &value, sizeof(value));
}

void DriverState::WriteBytes(const char* why, const void* buf, size_t size) {
  if (!writer_) return;
  writer_->WriteEvent(EventType::BYTES, why, buf, size);
}

void DriverState::WriteMetadata(const std::string& json) {
  if (!writer_) return;
  writer_->WriteMetadata(json);
}

uintptr_t DriverState::ReadValue(const char* why, uintptr_t default_value) {
  if (!reader_) return default_value;
  const auto* ev = reader_->NextEvent(why);
  if (!ev || ev->type != EventType::VALUE || ev->data.size() != sizeof(uintptr_t)) {
    return default_value;
  }
  uintptr_t v;
  std::memcpy(&v, ev->data.data(), sizeof(v));
  return v;
}

bool DriverState::ReadBytes(const char* why, void* buf, size_t size) {
  if (!reader_) return false;
  const auto* ev = reader_->NextEvent(why);
  if (!ev || ev->type != EventType::BYTES || ev->data.size() != size) {
    return false;
  }
  std::memcpy(buf, ev->data.data(), size);
  return true;
}

bool DriverState::IsMainThread() {
  pthread_t self = pthread_self();
  bool expected = false;
  if (main_thread_set_.compare_exchange_strong(expected, true)) {
    main_thread_ = self;
    return true;
  }
  return pthread_equal(self, main_thread_) != 0;
}

void DriverState::Log(const char* format, va_list args) {
  pthread_mutex_lock(&log_lock_);
  std::vfprintf(log_fp_, format, args);
  std::fputc('\n', log_fp_);
  std::fflush(log_fp_);
  pthread_mutex_unlock(&log_lock_);
}

// ---------- 进程启动构造器 ----------
// 用 __attribute__((constructor)) 在 main() 前触发懒初始化，让横幅信息尽早出现。
__attribute__((constructor))
static void DriverAutoInit() {
  DriverState::Get();
}

}  // namespace openreplay
