// Open Replay — Network Interception
//
// Intercepts: socket, connect, recv/recvfrom/recvmsg, send/sendto/sendmsg,
//             getaddrinfo
//
// Node.js (libuv) uses read()/write() on sockets, not recv()/send().
// We track socket fds and intercept read/write for them in the unified
// read/write handlers (shared with fs.cc via g_socket_fds).

/*
 * 【网络拦截策略】
 *
 * 录制时：真实发起网络请求，记录所有收到的数据（connect 结果、read 数据）。
 * 回放时：不发起真实网络请求，从录制数据中返回之前收到的响应。
 *
 * fd 分类：通过 socket() 拦截追踪哪些 fd 是 socket。
 * read/write 的统一处理在 fs.cc 中——如果 fd 是 socket 且处于回放模式，
 * 从录制数据返回；否则走真实 read/write。
 *
 * DNS：拦截 getaddrinfo 确保域名解析结果确定性。
 */

#include "common.h"

#include <cstring>
#include <cerrno>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netdb.h>
#include <unordered_set>
#include <pthread.h>

// --- Socket fd tracking (shared with fs.cc) ---
// Declared extern so fs.cc can check if a fd is a socket.
std::unordered_set<int> g_socket_fds;
pthread_mutex_t g_socket_fd_mutex = PTHREAD_MUTEX_INITIALIZER;

void TrackSocketFd(int fd) {
  if (fd < 0) return;
  pthread_mutex_lock(&g_socket_fd_mutex);
  g_socket_fds.insert(fd);
  pthread_mutex_unlock(&g_socket_fd_mutex);
}

void UntrackSocketFd(int fd) {
  pthread_mutex_lock(&g_socket_fd_mutex);
  g_socket_fds.erase(fd);
  pthread_mutex_unlock(&g_socket_fd_mutex);
}

bool IsSocketFd(int fd) {
  if (fd < 0) return false;
  pthread_mutex_lock(&g_socket_fd_mutex);
  bool result = g_socket_fds.count(fd) > 0;
  pthread_mutex_unlock(&g_socket_fd_mutex);
  return result;
}

// Check if sockaddr is loopback (127.x.x.x or ::1).
// Loopback = inspector, local services — should NOT be intercepted.
static bool IsLoopbackAddr(const struct sockaddr* addr) {
  if (!addr) return false;
  if (addr->sa_family == AF_INET) {
    auto* in4 = reinterpret_cast<const struct sockaddr_in*>(addr);
    return (ntohl(in4->sin_addr.s_addr) & 0xFF000000) == 0x7F000000;
  }
  if (addr->sa_family == AF_INET6) {
    auto* in6 = reinterpret_cast<const struct sockaddr_in6*>(addr);
    return memcmp(&in6->sin6_addr, &in6addr_loopback, sizeof(struct in6_addr)) == 0;
  }
  return false;
}

extern "C" {

// socket() — do NOT track here. Only track on connect() to non-loopback.
// Server sockets (inspector, etc.) bind+listen, never connect, so they stay untracked.
int my_socket(int domain, int type, int protocol) {
  return socket(domain, type, protocol);
}

// connect() — track the fd as an intercepted socket ONLY for non-loopback connections.
int my_connect(int sockfd, const struct sockaddr* addr, socklen_t addrlen) {
  InterceptGuard guard;
  if (!guard) return connect(sockfd, addr, addrlen);
  if (IsLoopbackAddr(addr)) return connect(sockfd, addr, addrlen);

  // Track this fd as a client socket to an external host
  if (RecordReplayIsRecordingOrReplaying()) TrackSocketFd(sockfd);

  if (RecordReplayIsRecording()) {
    int ret = connect(sockfd, addr, addrlen);
    int saved_errno = errno;
    RecordReplayValue("connect.ret", static_cast<uintptr_t>(ret));
    RecordReplayValue("connect.errno", static_cast<uintptr_t>(saved_errno));
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    // Actually connect for real — kqueue/kevent needs a real socket.
    // We consume the recorded events to keep the stream in sync,
    // but return the real connect result so libuv's event loop works.
    RecordReplayValue("connect.ret", 0);   // consume
    RecordReplayValue("connect.errno", 0); // consume
    return connect(sockfd, addr, addrlen);
  }
  return connect(sockfd, addr, addrlen);
}

// --- send/sendto/sendmsg ---
// During replay, we don't actually send. Just return recorded byte count.
ssize_t my_send(int sockfd, const void* buf, size_t len, int flags) {
  InterceptGuard guard;
  if (!guard) return send(sockfd, buf, len, flags);
  if (!IsSocketFd(sockfd)) return send(sockfd, buf, len, flags);

  if (RecordReplayIsRecording()) {
    ssize_t ret = send(sockfd, buf, len, flags);
    int saved_errno = errno;
    RecordReplayValue("send.ret", static_cast<uintptr_t>(ret));
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    // Do real send — kqueue needs real socket activity.
    RecordReplayValue("send.ret", 0); // consume
    return send(sockfd, buf, len, flags);
  }
  return send(sockfd, buf, len, flags);
}

ssize_t my_sendto(int sockfd, const void* buf, size_t len, int flags,
                  const struct sockaddr* dest_addr, socklen_t addrlen) {
  InterceptGuard guard;
  if (!guard) return sendto(sockfd, buf, len, flags, dest_addr, addrlen);
  if (!IsSocketFd(sockfd)) return sendto(sockfd, buf, len, flags, dest_addr, addrlen);

  if (RecordReplayIsRecording()) {
    ssize_t ret = sendto(sockfd, buf, len, flags, dest_addr, addrlen);
    int saved_errno = errno;
    RecordReplayValue("sendto.ret", static_cast<uintptr_t>(ret));
    errno = saved_errno;
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    RecordReplayValue("sendto.ret", 0); // consume
    return sendto(sockfd, buf, len, flags, dest_addr, addrlen);
  }
  return sendto(sockfd, buf, len, flags, dest_addr, addrlen);
}

// --- recv/recvfrom ---
// During replay, return recorded data instead of real network data.
ssize_t my_recv(int sockfd, void* buf, size_t len, int flags) {
  InterceptGuard guard;
  if (!guard) return recv(sockfd, buf, len, flags);
  if (!IsSocketFd(sockfd)) return recv(sockfd, buf, len, flags);

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

// --- getaddrinfo — DNS resolution ---
int my_getaddrinfo(const char* node, const char* service,
                   const struct addrinfo* hints, struct addrinfo** res) {
  InterceptGuard guard;
  if (!guard) return getaddrinfo(node, service, hints, res);

  if (RecordReplayIsRecording()) {
    int ret = getaddrinfo(node, service, hints, res);
    RecordReplayValue("getaddrinfo.ret", static_cast<uintptr_t>(ret));
    if (ret == 0 && res && *res) {
      // Record the first result's address
      RecordReplayValue("getaddrinfo.family", static_cast<uintptr_t>((*res)->ai_family));
      RecordReplayValue("getaddrinfo.socktype", static_cast<uintptr_t>((*res)->ai_socktype));
      RecordReplayValue("getaddrinfo.protocol", static_cast<uintptr_t>((*res)->ai_protocol));
      RecordReplayValue("getaddrinfo.addrlen", static_cast<uintptr_t>((*res)->ai_addrlen));
      RecordReplayBytes("getaddrinfo.addr", (*res)->ai_addr, (*res)->ai_addrlen);
    }
    return ret;
  }
  if (RecordReplayIsReplaying()) {
    int ret = static_cast<int>(RecordReplayValue("getaddrinfo.ret", 0));
    if (ret == 0) {
      // Reconstruct addrinfo from recording
      int family = static_cast<int>(RecordReplayValue("getaddrinfo.family", 0));
      int socktype = static_cast<int>(RecordReplayValue("getaddrinfo.socktype", 0));
      int protocol = static_cast<int>(RecordReplayValue("getaddrinfo.protocol", 0));
      socklen_t addrlen = static_cast<socklen_t>(RecordReplayValue("getaddrinfo.addrlen", 0));

      // Allocate result (caller must freeaddrinfo)
      struct addrinfo* ai = static_cast<struct addrinfo*>(calloc(1, sizeof(struct addrinfo)));
      ai->ai_family = family;
      ai->ai_socktype = socktype;
      ai->ai_protocol = protocol;
      ai->ai_addrlen = addrlen;
      ai->ai_addr = static_cast<struct sockaddr*>(calloc(1, addrlen));
      RecordReplayBytes("getaddrinfo.addr", ai->ai_addr, addrlen);
      ai->ai_next = nullptr;
      *res = ai;
    }
    return ret;
  }
  return getaddrinfo(node, service, hints, res);
}

}  // extern "C"

// --- Platform registration ---
#ifdef __APPLE__
DYLD_INTERPOSE(my_socket, socket)
DYLD_INTERPOSE(my_connect, connect)
DYLD_INTERPOSE(my_send, send)
DYLD_INTERPOSE(my_sendto, sendto)
DYLD_INTERPOSE(my_recv, recv)
// getaddrinfo disabled: reconstructed addrinfo struct is incomplete,
// Node.js validates ai_socktype strictly. Let DNS resolve for real.
// DYLD_INTERPOSE(my_getaddrinfo, getaddrinfo)
#endif
