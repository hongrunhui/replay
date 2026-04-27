// Open Replay — Raw Syscall Implementation
//
// Uses syscall() on macOS and Linux to bypass DYLD_INTERPOSE / LD_PRELOAD.
// This ensures the recording stream's I/O never triggers our own interception.

#include "raw_syscall.h"

#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#ifdef __APPLE__
#include <sys/syscall.h>
// macOS: use syscall() directly (deprecated but functional)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

namespace openreplay {
namespace raw {

int open(const char* path, int flags, int mode) {
  return static_cast<int>(syscall(SYS_open, path, flags, mode));
}

int close(int fd) {
  return static_cast<int>(syscall(SYS_close, fd));
}

ssize_t write(int fd, const void* buf, size_t count) {
  return syscall(SYS_write, fd, buf, count);
}

ssize_t read(int fd, void* buf, size_t count) {
  return syscall(SYS_read, fd, buf, count);
}

int fsync(int fd) {
  return static_cast<int>(syscall(SYS_fsync, fd));
}

off_t lseek(int fd, off_t offset, int whence) {
  return syscall(SYS_lseek, fd, offset, whence);
}

int raw_fstat(int fd, struct stat* buf) {
  return static_cast<int>(syscall(SYS_fstat, fd, buf));
}

int mkdir(const char* path, int mode) {
  return static_cast<int>(syscall(SYS_mkdir, path, mode));
}

}  // namespace raw
}  // namespace openreplay

#pragma clang diagnostic pop

#else
// Linux: use syscall() via <sys/syscall.h>
#include <sys/syscall.h>

namespace openreplay {
namespace raw {

int open(const char* path, int flags, int mode) {
  return static_cast<int>(::syscall(SYS_openat, AT_FDCWD, path, flags, mode));
}

int close(int fd) {
  return static_cast<int>(::syscall(SYS_close, fd));
}

ssize_t write(int fd, const void* buf, size_t count) {
  return ::syscall(SYS_write, fd, buf, count);
}

ssize_t read(int fd, void* buf, size_t count) {
  return ::syscall(SYS_read, fd, buf, count);
}

int fsync(int fd) {
  return static_cast<int>(::syscall(SYS_fsync, fd));
}

off_t lseek(int fd, off_t offset, int whence) {
  return ::syscall(SYS_lseek, fd, offset, whence);
}

int raw_fstat(int fd, struct stat* buf) {
  return static_cast<int>(::syscall(SYS_fstat, fd, buf));
}

int mkdir(const char* path, int mode) {
  return static_cast<int>(::syscall(SYS_mkdirat, AT_FDCWD, path, mode));
}

}  // namespace raw
}  // namespace openreplay

#endif

// Shared implementation
namespace openreplay {
namespace raw {

int mkdirp(const char* path, int mode) {
  char tmp[1024];
  strncpy(tmp, path, sizeof(tmp) - 1);
  tmp[sizeof(tmp) - 1] = '\0';

  for (char* p = tmp + 1; *p; p++) {
    if (*p == '/') {
      *p = '\0';
      mkdir(tmp, mode);  // Ignore errors (dir may exist)
      *p = '/';
    }
  }
  return mkdir(tmp, mode);
}

}  // namespace raw
}  // namespace openreplay
