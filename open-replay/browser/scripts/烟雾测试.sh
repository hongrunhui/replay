#!/usr/bin/env bash
# Driver 真实化烟雾测试 —— 不需要 chromium，直接用 /bin/echo 当宿主进程
# 验证：DYLD_INSERT_LIBRARIES + driver constructor 能跑、能识别进程角色、
#       能开 .orec 文件、能写入事件、能正确关闭
#
# 期望输出（stderr）:
#   [openreplay] driver loaded: role=browser pid=NNNN mode=record
#   [openreplay] recording → ~/.openreplay/recordings/<uuid>/browser-NNNN.orec

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BROWSER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DYLIB="$BROWSER_DIR/driver/build/libopenreplay_browser.dylib"

if [[ ! -f "$DYLIB" ]]; then
  echo "ERROR: driver 没构建。先跑 driver/build.sh" >&2
  exit 1
fi

SESSION="smoke-$(date +%s)"
echo "==> session: $SESSION"
echo "==> dylib  : $DYLIB"

# 跑一个最小可被注入的进程：/bin/echo（注意：DYLD_INSERT_LIBRARIES 有时被
# Apple 二进制的 hardened runtime 屏蔽。如果这里失败，说明系统 echo 已加固
# —— 改用我们自己编的小 host 程序。/usr/bin/env 也可能加固；试 /bin/echo）
echo "==> launching /bin/echo with driver injected"
DYLD_INSERT_LIBRARIES="$DYLIB" \
  OPENREPLAY_MODE=record \
  OPENREPLAY_SESSION="$SESSION" \
  OPENREPLAY_DEBUG_LOG=/tmp/openreplay-smoke \
  /bin/echo "hello from injected process" || true

echo
echo "==> stderr/log files:"
ls -la /tmp/openreplay-smoke* 2>/dev/null || echo "  (没有 log 文件，可能是 hardened runtime 屏蔽了 DYLD_*)"

echo
echo "==> .orec files:"
RECDIR="$HOME/.openreplay/recordings/$SESSION"
if [[ -d "$RECDIR" ]]; then
  ls -la "$RECDIR"
else
  echo "  (空 —— driver 没 init 成功)"
fi

echo
echo "==> log content (前 20 行):"
for f in /tmp/openreplay-smoke*; do
  if [[ -f "$f" ]]; then
    echo "--- $f ---"
    head -20 "$f"
  fi
done
