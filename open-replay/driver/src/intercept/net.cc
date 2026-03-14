// Open Replay — Network Interception
//
// Intercepts: connect, accept, recv, send, poll, select

#include "intercept/common.h"

#include <cstring>
#include <cerrno>
#include <sys/socket.h>
#include <sys/select.h>
#include <poll.h>
#include <netinet/in.h>

extern "C" {

int my_connect(int sockfd, const struct sockaddr* addr, socklen_t addrlen) {
  InterceptGuard guard;
  if (!guard) return connect(sockfd, addr, addrlen);

  if (RecordReplayIsRecording()) {
    int ret = connect(sockfd, addr, addrlen);
    int saved_errno = errno;
    RecordReplayValue("connect.ret", static_cast<uintptr_t>(ret));
    RecordReplayValue("connect.errno", static_cast<uintptr_t>(saved_errno));
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    int ret = static_cast<int>(RecordReplayValue("connect.ret", 0));
    errno = static_cast<int>(RecordReplayValue("connect.errno", 0));
    return ret;
  }
  return connect(sockfd, addr, addrlen);
}

int my_accept(int sockfd, struct sockaddr* addr, socklen_t* addrlen) {
  InterceptGuard guard;
  if (!guard) return accept(sockfd, addr, addrlen);

  if (RecordReplayIsRecording()) {
    int ret = accept(sockfd, addr, addrlen);
    int saved_errno = errno;
    RecordReplayValue("accept.ret", static_cast<uintptr_t>(ret));
    if (ret >= 0 && addr && addrlen) {
      RecordReplayValue("accept.addrlen", static_cast<uintptr_t>(*addrlen));
      RecordReplayBytes("accept.addr", addr, *addrlen);
    }
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    int ret = static_cast<int>(RecordReplayValue("accept.ret", 0));
    if (ret >= 0 && addr && addrlen) {
      *addrlen = static_cast<socklen_t>(RecordReplayValue("accept.addrlen", 0));
      RecordReplayBytes("accept.addr", addr, *addrlen);
    }
    return ret;
  }
  return accept(sockfd, addr, addrlen);
}

ssize_t my_recv(int sockfd, void* buf, size_t len, int flags) {
  InterceptGuard guard;
  if (!guard) return recv(sockfd, buf, len, flags);

  if (RecordReplayIsRecording()) {
    ssize_t ret = recv(sockfd, buf, len, flags);
    int saved_errno = errno;
    RecordReplayValue("recv.ret", static_cast<uintptr_t>(ret));
    if (ret > 0) {
      RecordReplayBytes("recv.data", buf, static_cast<size_t>(ret));
    }
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    ssize_t ret = static_cast<ssize_t>(RecordReplayValue("recv.ret", 0));
    if (ret > 0 && buf) {
      RecordReplayBytes("recv.data", buf, static_cast<size_t>(ret));
    }
    return ret;
  }
  return recv(sockfd, buf, len, flags);
}

ssize_t my_send(int sockfd, const void* buf, size_t len, int flags) {
  InterceptGuard guard;
  if (!guard) return send(sockfd, buf, len, flags);

  if (RecordReplayIsRecording()) {
    ssize_t ret = send(sockfd, buf, len, flags);
    int saved_errno = errno;
    RecordReplayValue("send.ret", static_cast<uintptr_t>(ret));
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    return static_cast<ssize_t>(RecordReplayValue("send.ret", 0));
  }
  return send(sockfd, buf, len, flags);
}

int my_poll(struct pollfd* fds, nfds_t nfds, int timeout) {
  InterceptGuard guard;
  if (!guard) return poll(fds, nfds, timeout);

  if (RecordReplayIsRecording()) {
    int ret = poll(fds, nfds, timeout);
    int saved_errno = errno;
    RecordReplayValue("poll.ret", static_cast<uintptr_t>(ret));
    if (ret > 0 && fds) {
      RecordReplayBytes("poll.fds", fds, nfds * sizeof(struct pollfd));
    }
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    int ret = static_cast<int>(RecordReplayValue("poll.ret", 0));
    if (ret > 0 && fds) {
      RecordReplayBytes("poll.fds", fds, nfds * sizeof(struct pollfd));
    }
    return ret;
  }
  return poll(fds, nfds, timeout);
}

}  // extern "C"

// --- Platform registration ---
// Disabled for MVP — re-enable when network interception is needed
#if 0
#ifdef __APPLE__
DYLD_INTERPOSE(my_connect, connect)
DYLD_INTERPOSE(my_accept, accept)
DYLD_INTERPOSE(my_recv, recv)
DYLD_INTERPOSE(my_send, send)
DYLD_INTERPOSE(my_poll, poll)
#endif
#endif
