#!/usr/bin/env bash
# 启动 Replay.io chromium fork + 我们的 driver。
#
# 用法：
#   bash 启动chrome.sh                       # 默认 record 模式
#   bash 启动chrome.sh --replay <session>     # 回放指定 session
#   bash 启动chrome.sh --off                  # 不录制（裸跑 chromium，调试用）
#
# 关键环境变量：
#   OPENREPLAY_MODE     = record / replay / off
#   OPENREPLAY_SESSION  = session uuid（不传则自动生成）
#   OPENREPLAY_DEBUG_LOG = log 文件前缀
#   DYLD_INSERT_LIBRARIES = driver dylib

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BROWSER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DYLIB="$BROWSER_DIR/driver/build/libopenreplay_browser.dylib"
CHROMIUM="${CHROMIUM:-/Users/hongrunhui/Documents/code/chromium}"
CHROME_APP="$CHROMIUM/out/Release/Chromium.app/Contents/MacOS/Chromium"

# 命令行解析
MODE="record"
SESSION=""
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --record) MODE="record"; shift ;;
    --replay) MODE="replay"; SESSION="${2:-}"; shift 2 ;;
    --off)    MODE="off"; shift ;;
    --session) SESSION="${2:-}"; shift 2 ;;
    --) shift; EXTRA_ARGS=("$@"); break ;;
    *) EXTRA_ARGS+=("$1"); shift ;;
  esac
done

# 自动生成 session
if [[ -z "$SESSION" ]]; then
  SESSION="session-$(date +%s)"
fi

# 健全性检查
if [[ ! -f "$DYLIB" ]]; then
  echo "ERROR: driver dylib 不存在：$DYLIB" >&2
  echo "  先跑：bash $BROWSER_DIR/driver/build.sh" >&2
  exit 1
fi
if [[ ! -x "$CHROME_APP" ]]; then
  echo "ERROR: chromium 二进制不存在：$CHROME_APP" >&2
  echo "  先跑：cd $CHROMIUM/src && ninja -C ../out/Release chrome" >&2
  exit 1
fi

echo "==> driver  : $DYLIB"
echo "==> chrome  : $CHROME_APP"
echo "==> mode    : $MODE"
echo "==> session : $SESSION"
echo "==> extra   : ${EXTRA_ARGS[*]:-(none)}"

# Replay.io chromium 必备的命令行：禁沙箱（让 DYLD_INSERT_LIBRARIES 进 renderer），
# 关 maglev（先不打字节码 patch），关 GPU sandbox（同样原因），单进程模型最简化（debug 用）
CHROME_FLAGS=(
  --no-sandbox
  --disable-gpu-sandbox
  --disable-features=RendererSandbox,MaglevTopTierCompiler
  --user-data-dir="/tmp/openreplay-chrome-$SESSION"
  --disable-features=Vulkan
  --disable-dev-shm-usage
  --no-first-run
  --no-default-browser-check
)

mkdir -p "$HOME/.openreplay/recordings/$SESSION"

DYLD_INSERT_LIBRARIES="$DYLIB" \
  OPENREPLAY_MODE="$MODE" \
  OPENREPLAY_SESSION="$SESSION" \
  OPENREPLAY_DEBUG_LOG="/tmp/openreplay-$SESSION" \
  exec "$CHROME_APP" "${CHROME_FLAGS[@]}" "${EXTRA_ARGS[@]}"
