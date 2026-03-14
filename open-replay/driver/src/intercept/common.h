// Open Replay — System Call Interception: Common Utilities
//
// Shared interception infrastructure: guard, platform macros, registration.

/*
 * 【拦截基础设施】
 * 本文件提供所有系统调用拦截共用的工具：
 * 1. DYLD_INTERPOSE 宏（macOS）/ REAL_FUNC 宏（Linux）—— 平台注册机制
 * 2. InterceptGuard —— 防重入 RAII 守卫
 * 3. g_intercept_depth —— 全局重入深度计数器
 *
 * 整个拦截体系的核心思路：
 * 拦截函数（如 my_open）替代真实系统调用 → 执行真实调用 → 录制返回值。
 * 但拦截函数内部也会调用系统调用（如 writer 写文件），这些内部调用绝不能被再次拦截，
 * 否则会无限递归。InterceptGuard 通过深度计数器解决这个问题。
 */

#ifndef OPENREPLAY_INTERCEPT_COMMON_H_
#define OPENREPLAY_INTERCEPT_COMMON_H_

#include "driver.h"

#ifdef __APPLE__
#include <mach/mach_time.h>
/*
 * 【DYLD_INTERPOSE 原理】
 * 在 Mach-O 的 __DATA,__interpose section 中声明一个 {替换, 原始} 函数指针对。
 * macOS 的动态链接器（dyld）在加载时会扫描此 section，将其他 image（如 Node.js）
 * 中对 _original 的调用重定向到 _replacement。
 *
 * 关键特性：interpose 只影响其他 image 的调用，不影响本 dylib 内部的调用。
 * 所以 my_open() 内部调用 open() 会走真实的 libc open，不会自递归。
 * 但 raw_syscall.h 中的 raw::write/read 仍然使用 syscall() 直接调用内核，
 * 作为额外保险层（防止未来链接方式改变导致意外递归）。
 */
#define DYLD_INTERPOSE(_replacement, _original) \
  __attribute__((used)) static struct { \
    const void* replacement; \
    const void* original; \
  } _interpose_##_original \
  __attribute__((section("__DATA,__interpose"))) = { \
    (const void*)(unsigned long)&_replacement, \
    (const void*)(unsigned long)&_original \
  };
#else
#include <dlfcn.h>
// Linux: resolve original function via dlsym
#define REAL_FUNC(name) \
  static auto real_##name = reinterpret_cast<decltype(&name)>(dlsym(RTLD_NEXT, #name))
#endif

/*
 * 【防重入守卫 (InterceptGuard)】
 *
 * 为什么用 extern 全局变量而不是 static？
 * ─────────────────────────────────────
 * g_intercept_depth 定义在 driver.cc 中，这里声明为 extern。
 * 如果每个 .cc 文件用 static 局部变量，那 fs.cc 和 time.cc 各有自己的计数器，
 * 当 my_open() 内部触发 gettimeofday() 时，time.cc 的计数器为 0，
 * 仍会认为"不是重入"从而再次拦截 —— 可能导致事件流错乱。
 * 共享同一个计数器才能正确检测跨模块的重入。
 *
 * 为什么不用 thread_local？
 * ──────────────────────
 * macOS 上，dylib 的 constructor 可能在 TLS 初始化之前执行，
 * 访问 thread_local 变量会崩溃。用全局 int 最安全。
 * 缺点是多线程不安全，未来需改用 pthread_getspecific。
 */
extern int g_intercept_depth;

/*
 * 【InterceptGuard 使用方式】
 * 在每个拦截函数开头创建：InterceptGuard guard;
 * 构造时 depth++，析构时 depth--（RAII）。
 * if (!guard) 表示"当前是重入调用或模式为 IDLE"，应直接透传。
 */
struct InterceptGuard {
  bool active;
  InterceptGuard() : active(g_intercept_depth == 0 &&
                            RecordReplayIsRecordingOrReplaying()) {
    g_intercept_depth++;
  }
  ~InterceptGuard() { g_intercept_depth--; }
  operator bool() const { return active; }
};

#endif  // OPENREPLAY_INTERCEPT_COMMON_H_
