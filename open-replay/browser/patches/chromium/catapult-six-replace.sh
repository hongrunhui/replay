#!/usr/bin/env bash
# 把 chromium catapult bundled 的 six 1.15.0 换成现代的 1.17.0
#
# catapult 在 parse_html_deps.py 等地方 import six，并通过 sys.path.insert 把
# 自己 third_party/six/ 放在前面，所以即使用户 site-packages 装了新 six 也用不上。
# 老 six 在 Python 3.12+ 上 from six.moves import urllib_request 这类 lazy
# 加载会全失败，进而让 html5lib 等依赖 six.moves 的库都用不了。
#
# 用法：
#   bash catapult-six-replace.sh /path/to/chromium/src

set -euo pipefail

CHROMIUM_SRC="${1:-/Users/hongrunhui/Documents/code/chromium/src}"
TARGET="$CHROMIUM_SRC/third_party/catapult/third_party/six/six.py"

if [[ ! -f "$TARGET" ]]; then
  echo "ERROR: $TARGET not found" >&2
  exit 1
fi

# 找一个现代 six 的来源
NEW_SIX=""
for candidate in \
  "$HOME/Library/Python/3.13/lib/python/site-packages/six.py" \
  "$HOME/Library/Python/3.12/lib/python/site-packages/six.py" \
  "/opt/homebrew/lib/python3.13/site-packages/six.py"; do
  if [[ -f "$candidate" ]]; then
    NEW_SIX="$candidate"
    break
  fi
done

if [[ -z "$NEW_SIX" ]]; then
  echo "ERROR: 找不到现代 six.py，先跑：" >&2
  echo "  pip3 install --user --break-system-packages six" >&2
  exit 1
fi

NEW_VER=$(grep "^__version__" "$NEW_SIX" | head -1 | sed -E 's/.*"([0-9.]+)".*/\1/')
OLD_VER=$(grep "^__version__" "$TARGET" 2>/dev/null | head -1 | sed -E 's/.*"([0-9.]+)".*/\1/')
echo "found system six: $NEW_SIX (version $NEW_VER)"
echo "current bundled : $TARGET (version $OLD_VER)"

if [[ ! -f "$TARGET.${OLD_VER}-bak" ]]; then
  cp "$TARGET" "$TARGET.${OLD_VER}-bak"
  echo "backed up to $TARGET.${OLD_VER}-bak"
fi
cp "$NEW_SIX" "$TARGET"
echo "replaced. Now version: $(grep '^__version__' "$TARGET" | head -1)"
