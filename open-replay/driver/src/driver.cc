// Open Replay — Driver Entry Point
//
// This is the main implementation of the driver API.
// It manages the global state and delegates to recorder/replayer.

#include "driver.h"
#include "format/recording.h"
#include "checkpoint/checkpoint.h"
#include "raw_syscall.h"

#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>
#include <mutex>
#include <pthread.h>

#ifdef __APPLE__
#include <uuid/uuid.h>
#include <crt_externs.h>  // _NSGetArgc / _NSGetArgv
#else
#include <fcntl.h>
#include <unistd.h>
#endif

// Global intercept depth counter — shared across all interception TUs
int g_intercept_depth = 0;

namespace openreplay {

// --- Global state ---

static Mode g_mode = Mode::IDLE;
static std::string g_recording_id;
static std::string g_recording_path;
static std::string g_build_id;

// Use heap-allocated objects to avoid static initialization order issues.
// __attribute__((constructor)) may run before C++ static constructors,
// so we can't use static RecordingWriter/Reader objects.
static RecordingWriter* g_writer_ptr = nullptr;
static RecordingReader* g_reader_ptr = nullptr;
static CheckpointManager* g_checkpoints_ptr = nullptr;

static RecordingWriter& writer() {
  if (!g_writer_ptr) g_writer_ptr = new RecordingWriter();
  return *g_writer_ptr;
}
static RecordingReader& reader() {
  if (!g_reader_ptr) g_reader_ptr = new RecordingReader();
  return *g_reader_ptr;
}
static CheckpointManager& checkpoints() {
  if (!g_checkpoints_ptr) g_checkpoints_ptr = new CheckpointManager();
  return *g_checkpoints_ptr;
}

static uint64_t g_progress_counter = 0;
static uint64_t g_target_progress = 0;

static CDPMessageCallback g_cdp_callback = nullptr;
// Use pthread_mutex_t with static initializer — safe before C++ constructors run
static pthread_mutex_t g_mutex = PTHREAD_MUTEX_INITIALIZER;

Mode GetMode() { return g_mode; }
const char* GetRecordingPath() { return g_recording_path.c_str(); }

// Generate a UUID for the recording
static std::string GenerateRecordingId() {
#ifdef __APPLE__
  uuid_t uuid;
  uuid_generate(uuid);
  char str[37];
  uuid_unparse_lower(uuid, str);
  return std::string(str);
#else
  // Linux: read from /proc/sys/kernel/random/uuid
  int fd = ::open("/proc/sys/kernel/random/uuid", O_RDONLY);
  if (fd >= 0) {
    char buf[37] = {};
    ::read(fd, buf, 36);
    ::close(fd);
    return std::string(buf, 36);
  }
  // Fallback: timestamp-based
  return "rec-" + std::to_string(time(nullptr));
#endif
}

// Get default recordings directory
static std::string GetRecordingsDir() {
  const char* home = getenv("HOME");
  if (!home) home = "/tmp";
  std::string dir = std::string(home) + "/.openreplay/recordings";
  return dir;
}

}  // namespace openreplay

using namespace openreplay;

// ============================================================
// Exported C API
// ============================================================

extern "C" {

void RecordReplayAttach(const char* dispatch, const char* build_id) {
  pthread_mutex_lock(&g_mutex);

  if (build_id) g_build_id = build_id;

  if (strcmp(dispatch, "record") == 0) {
    g_recording_id = GenerateRecordingId();

    // Determine recording path
    if (g_recording_path.empty()) {
      std::string dir = GetRecordingsDir();
      g_recording_path = dir + "/" + g_recording_id + ".orec";
    }

    // Ensure directory exists (use raw syscall to avoid interception)
    std::string dir = g_recording_path.substr(0, g_recording_path.rfind('/'));
    raw::mkdirp(dir.c_str());

    // Open writer BEFORE setting mode, so open()/write() aren't intercepted
    writer().Open(g_recording_path.c_str(), build_id);
    g_progress_counter = 0;
    g_target_progress = 0;

    // NOW enable interception
    g_mode = Mode::RECORDING;

    fprintf(stderr, "[openreplay] Recording to: %s\n", g_recording_path.c_str());
    fprintf(stderr, "[openreplay] Recording ID: %s\n", g_recording_id.c_str());

  } else if (strcmp(dispatch, "replay") == 0) {
    if (g_recording_path.empty()) {
      const char* env_path = getenv("REPLAY_RECORDING");
      if (env_path) g_recording_path = env_path;
    }

    // Open reader BEFORE setting mode
    if (!reader().Open(g_recording_path.c_str())) {
      fprintf(stderr, "[openreplay] Failed to open recording for replay\n");
      pthread_mutex_unlock(&g_mutex);
      return;
    }

    g_progress_counter = 0;
    g_target_progress = 0;

    // NOW enable interception
    g_mode = Mode::REPLAYING;
    fprintf(stderr, "[openreplay] Replaying: %s\n", g_recording_path.c_str());
  }

  pthread_mutex_unlock(&g_mutex);
}

void RecordReplayFinishRecording() {
  pthread_mutex_lock(&g_mutex);
  if (g_mode != Mode::RECORDING) {
    pthread_mutex_unlock(&g_mutex);
    return;
  }
  // Disable interception BEFORE closing to avoid intercepting close/write
  g_mode = Mode::IDLE;
  writer().Close();
  fprintf(stderr, "[openreplay] Recording finished: %s\n", g_recording_id.c_str());
  pthread_mutex_unlock(&g_mutex);
}

void RecordReplayDetach() {
  pthread_mutex_lock(&g_mutex);
  Mode prev = g_mode;
  // Disable interception BEFORE cleanup
  g_mode = Mode::IDLE;
  if (prev == Mode::RECORDING) {
    writer().Close();
  } else if (prev == Mode::REPLAYING) {
    reader().Close();
  }
  pthread_mutex_unlock(&g_mutex);
}

const char* RecordReplayGetRecordingId() {
  return g_recording_id.c_str();
}

void RecordReplaySetRecordingPath(const char* path) {
  g_recording_path = path ? path : "";
}

int RecordReplayIsRecordingOrReplaying() {
  return g_mode != Mode::IDLE ? 1 : 0;
}

int RecordReplayIsRecording() {
  return g_mode == Mode::RECORDING ? 1 : 0;
}

int RecordReplayIsReplaying() {
  return g_mode == Mode::REPLAYING ? 1 : 0;
}

uintptr_t RecordReplayValue(const char* why, uintptr_t value) {
  if (g_mode == Mode::RECORDING) {
    writer().WriteEvent(EventType::VALUE, why, &value, sizeof(value));
    return value;
  }
  if (g_mode == Mode::REPLAYING) {
    const auto* ev = reader().NextEvent(why);
    if (ev && ev->data.size() >= sizeof(uintptr_t)) {
      uintptr_t result;
      memcpy(&result, ev->data.data(), sizeof(result));
      return result;
    }
  }
  return value;
}

void RecordReplayBytes(const char* why, void* buf, size_t size) {
  if (g_mode == Mode::RECORDING) {
    writer().WriteEvent(EventType::BYTES, why, buf, size);
  } else if (g_mode == Mode::REPLAYING) {
    const auto* ev = reader().NextEvent(why);
    if (ev && buf && !ev->data.empty()) {
      size_t copy_len = ev->data.size() < size ? ev->data.size() : size;
      memcpy(buf, ev->data.data(), copy_len);
    }
  }
}

void RecordReplayString(const char* why, std::string& str) {
  if (g_mode == Mode::RECORDING) {
    writer().WriteEvent(EventType::STRING, why, str.data(), str.size());
  } else if (g_mode == Mode::REPLAYING) {
    const auto* ev = reader().NextEvent(why);
    if (ev) {
      str.assign(reinterpret_cast<const char*>(ev->data.data()), ev->data.size());
    }
  }
}

uint64_t* RecordReplayProgressCounter() {
  return &g_progress_counter;
}

uint64_t* RecordReplayTargetProgress() {
  return &g_target_progress;
}

void RecordReplayOnProgressReached(uint64_t progress) {
  if (g_mode == Mode::RECORDING) {
    if (checkpoints().ShouldAutoCheckpoint(progress)) {
      RecordReplayNewCheckpoint();
    }
  }
}

void RecordReplayNewCheckpoint() {
  if (g_mode == Mode::RECORDING) {
    uint32_t id = checkpoints().CreateCheckpoint(g_progress_counter);
    writer().WriteCheckpoint(g_progress_counter);
    fprintf(stderr, "[openreplay] Checkpoint #%u at progress %llu\n",
            id, g_progress_counter);
  }
}

uint32_t RecordReplayGetCheckpointCount() {
  return checkpoints().Count();
}

void RecordReplaySendCDPMessage(const char* message, size_t length) {
  // TODO: implement CDP message routing
  (void)message;
  (void)length;
}

void RecordReplaySetCDPCallback(CDPMessageCallback callback) {
  g_cdp_callback = callback;
}

void RecordReplayLog(const char* format, ...) {
  va_list args;
  va_start(args, format);
  fprintf(stderr, "[openreplay] ");
  vfprintf(stderr, format, args);
  fprintf(stderr, "\n");
  va_end(args);
}

const char* RecordReplayGetMetadata() {
  if (g_mode == Mode::REPLAYING && g_reader_ptr) {
    return g_reader_ptr->metadata().c_str();
  }
  return nullptr;
}

void RecordReplaySetMetadata(const char* json) {
  pthread_mutex_lock(&g_mutex);
  if (g_mode == Mode::RECORDING) {
    writer().WriteMetadata(json ? json : "{}");
  }
  pthread_mutex_unlock(&g_mutex);
}

}  // extern "C"

// ============================================================
// Auto-init via environment variables
// ============================================================

static void openreplay_shutdown_handler() {
  RecordReplayDetach();
}

__attribute__((constructor))
static void openreplay_auto_init() {
  const char* mode = getenv("OPENREPLAY_MODE");
  if (!mode) mode = getenv("RECORD_ALL_CONTENT");

  if (mode) {
    const char* dispatch = "record";
    if (strcmp(mode, "replay") == 0) dispatch = "replay";
    RecordReplayAttach(dispatch, "auto");

    // Store script path and argv in metadata (recording mode only)
    if (strcmp(dispatch, "record") == 0) {
#ifdef __APPLE__
      int argc = *_NSGetArgc();
      char** argv = *_NSGetArgv();
#else
      int argc = 0;
      char** argv = nullptr;
      // Linux: read from /proc/self/cmdline
      // (simplified: just use OPENREPLAY_SCRIPT env if set)
#endif
      std::string json = "{";

      // Script path: argv[1] for `node script.js` invocations.
      // Resolve to absolute path so replay can find the script regardless of cwd.
      const char* script_env = getenv("OPENREPLAY_SCRIPT");
      const char* script_raw = script_env;
      if (!script_raw && argc >= 2) script_raw = argv[1];

      // Resolve to absolute path
      std::string script_abs;
      if (script_raw) {
        char resolved[4096] = {};
        if (realpath(script_raw, resolved)) {
          script_abs = resolved;
        } else {
          script_abs = script_raw;  // fallback to raw
        }
      }

      const char* script = script_abs.empty() ? nullptr : script_abs.c_str();
      if (script) {
        json += "\"scriptPath\":\"";
        for (const char* c = script; *c; c++) {
          if (*c == '"') json += "\\\"";
          else if (*c == '\\') json += "\\\\";
          else json += *c;
        }
        json += "\"";
      }
      json += "}";
      RecordReplaySetMetadata(json.c_str());
    }

    atexit(openreplay_shutdown_handler);
  }
}

__attribute__((destructor))
static void openreplay_auto_shutdown() {
  RecordReplayDetach();
}
