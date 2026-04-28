#!/usr/bin/env bash
# 构建 libopenreplay_browser.dylib —— Phase B2' 的 stub driver
#
# 输出：browser/driver/build/libopenreplay_browser.dylib
# 校验：导出符号数应当 = 96 (66 V8 宏 + 15 V8 extras + 15 Skia)

set -euo pipefail

DRIVER_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$DRIVER_DIR/src"
BUILD_DIR="$DRIVER_DIR/build"
mkdir -p "$BUILD_DIR"

# v8 头路径 —— 来自 Replay.io 的 chromium fork
CHROMIUM_SRC="${CHROMIUM_SRC:-/Users/hongrunhui/Documents/code/chromium/src}"
V8_INCLUDE="$CHROMIUM_SRC/v8/include"

if [[ ! -f "$V8_INCLUDE/v8.h" ]]; then
  echo "ERROR: v8.h not found at $V8_INCLUDE" >&2
  echo "       set CHROMIUM_SRC env var to your chromium/src path" >&2
  exit 1
fi

OUT="$BUILD_DIR/libopenreplay_browser.dylib"

echo "==> compiling stub driver"
echo "    sources : $SRC_DIR/{stubs_v8api,stubs_extras}.cc"
echo "    output  : $OUT"
echo "    v8 hdrs : $V8_INCLUDE"

# macOS arm64 dylib
# - 默认符号可见性（不加 -fvisibility=hidden）
# - 关掉异常和 RTTI 减少代码尺寸
# - C++17 因为 v8.h 用了一些 C++17 特性
CXXFLAGS=(
  -std=c++17
  -arch arm64
  -O2
  -g
  -Wall
  -Wno-unused-parameter
  -Wno-unused-function
  -fno-exceptions
  -fno-rtti
  -I "$V8_INCLUDE"
)

LDFLAGS=(
  -dynamiclib
  -arch arm64
  -install_name "@rpath/libopenreplay_browser.dylib"
  -compatibility_version 1.0
  -current_version 1.0.0
  -Wl,-undefined,dynamic_lookup
)

clang++ "${CXXFLAGS[@]}" "${LDFLAGS[@]}" \
  "$SRC_DIR/stubs_v8api.cc" \
  "$SRC_DIR/stubs_extras.cc" \
  "$SRC_DIR/raw_syscall.cc" \
  "$SRC_DIR/recording.cc" \
  "$SRC_DIR/state.cc" \
  "$SRC_DIR/record_real.cc" \
  "$SRC_DIR/intercept/net.cc" \
  "$SRC_DIR/intercept/time.cc" \
  -o "$OUT"

echo "==> built $OUT"
ls -la "$OUT"

echo
echo "==> verifying exports"
TOTAL=$(nm -gU "$OUT" | grep -cE '_(V8RecordReplay|V8IsRecording|V8IsReplaying|V8GetRecordingId|V8GetMessageRecordReplay|V8IsMainThread|RecordReplay)' || true)
V8API=$(nm -gU "$OUT" | grep -cE '_(V8RecordReplay|V8IsRecording|V8IsReplaying|V8GetRecordingId|V8IsMainThread)' || true)
EXTRAS=$(nm -gU "$OUT" | grep -cE '_(V8GetMessageRecordReplay|V8RecordReplayCurrentReturnValue|V8RecordReplayReadAssetFileContents|V8RecordReplayDependencyGraphExecutionNode|V8RecordReplayPaintStart|V8RecordReplayGetProgressCounter|V8RecordReplayAddMetadata|V8RecordReplayHTMLParse|V8RecordReplayOnConsoleMessage|V8RecordReplayPaintFinished|V8RecordReplayRegisterBrowserEventCallback|V8RecordReplaySetAPIObjectIdCallback|V8RecordReplaySetCrashReason|V8RecordReplaySetDefaultContext|V8RecordReplaySetPaintCallback)' || true)
SKIA=$(nm -gU "$OUT" | grep -cE '^[0-9a-f]+ T _RecordReplay' || true)

echo "    V8 API + extras (V8 prefix) : $V8API"
echo "    Skia symbols (no prefix)    : $SKIA"
echo "    Total tracked               : $TOTAL"
echo
echo "    expected: ~81 V8-prefix + 15 Skia = 96"

if [[ "$TOTAL" -lt 90 ]]; then
  echo "WARN: symbol count below 90, something is missing" >&2
fi

echo "==> DONE"
