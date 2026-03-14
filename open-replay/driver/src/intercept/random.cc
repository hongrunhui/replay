// Open Replay — Random Number Interception
//
// Intercepts: arc4random, arc4random_buf, getentropy, getrandom (Linux)

#include "intercept/common.h"

#include <cstring>

#ifdef __APPLE__
#include <sys/random.h>
#else
#include <sys/random.h>  // getrandom on Linux
#endif

extern "C" {

uint32_t my_arc4random() {
  InterceptGuard guard;
  if (!guard) return arc4random();

  if (RecordReplayIsRecording()) {
    uint32_t ret = arc4random();
    return static_cast<uint32_t>(RecordReplayValue("arc4random",
        static_cast<uintptr_t>(ret)));
  }
  if (RecordReplayIsReplaying()) {
    return static_cast<uint32_t>(RecordReplayValue("arc4random", 0));
  }
  return arc4random();
}

void my_arc4random_buf(void* buf, size_t nbytes) {
  InterceptGuard guard;
  if (!guard) { arc4random_buf(buf, nbytes); return; }

  if (RecordReplayIsRecording()) {
    arc4random_buf(buf, nbytes);
    RecordReplayBytes("arc4random_buf", buf, nbytes);
    return;
  }
  if (RecordReplayIsReplaying()) {
    RecordReplayBytes("arc4random_buf", buf, nbytes);
    return;
  }
  arc4random_buf(buf, nbytes);
}

int my_getentropy(void* buf, size_t buflen) {
  InterceptGuard guard;
  if (!guard) return getentropy(buf, buflen);

  if (RecordReplayIsRecording()) {
    int ret = getentropy(buf, buflen);
    if (ret == 0) RecordReplayBytes("getentropy", buf, buflen);
    return static_cast<int>(RecordReplayValue("getentropy.ret",
        static_cast<uintptr_t>(ret)));
  }
  if (RecordReplayIsReplaying()) {
    RecordReplayBytes("getentropy", buf, buflen);
    return static_cast<int>(RecordReplayValue("getentropy.ret", 0));
  }
  return getentropy(buf, buflen);
}

#ifndef __APPLE__
ssize_t my_getrandom(void* buf, size_t buflen, unsigned int flags) {
  InterceptGuard guard;
  if (!guard) return getrandom(buf, buflen, flags);

  if (RecordReplayIsRecording()) {
    ssize_t ret = getrandom(buf, buflen, flags);
    if (ret > 0) RecordReplayBytes("getrandom", buf, static_cast<size_t>(ret));
    return static_cast<ssize_t>(RecordReplayValue("getrandom.ret",
        static_cast<uintptr_t>(ret)));
  }
  if (RecordReplayIsReplaying()) {
    ssize_t ret = static_cast<ssize_t>(RecordReplayValue("getrandom.ret", 0));
    if (ret > 0) RecordReplayBytes("getrandom", buf, static_cast<size_t>(ret));
    return ret;
  }
  return getrandom(buf, buflen, flags);
}
#endif

}  // extern "C"

// --- Platform registration ---

#ifdef __APPLE__
DYLD_INTERPOSE(my_arc4random, arc4random)
DYLD_INTERPOSE(my_arc4random_buf, arc4random_buf)
DYLD_INTERPOSE(my_getentropy, getentropy)
#endif
