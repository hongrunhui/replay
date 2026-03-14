// Open Replay — Raw Syscall Wrappers
//
// These functions bypass DYLD_INTERPOSE by calling syscalls directly.
// Used by the recording stream to avoid infinite recursion when
// intercepted functions (write, open, close) are called internally.

#ifndef OPENREPLAY_RAW_SYSCALL_H_
#define OPENREPLAY_RAW_SYSCALL_H_

#include <cstddef>
#include <cstdint>
#include <sys/types.h>
#include <sys/stat.h>

namespace openreplay {
namespace raw {

// Raw file operations — bypass any interposition
int open(const char* path, int flags, int mode = 0);
int close(int fd);
ssize_t write(int fd, const void* buf, size_t count);
ssize_t read(int fd, void* buf, size_t count);
int fsync(int fd);
off_t lseek(int fd, off_t offset, int whence);
int raw_fstat(int fd, struct stat* buf);
int mkdir(const char* path, int mode);

// Recursive mkdir -p
int mkdirp(const char* path, int mode = 0755);

}  // namespace raw
}  // namespace openreplay

#endif  // OPENREPLAY_RAW_SYSCALL_H_
