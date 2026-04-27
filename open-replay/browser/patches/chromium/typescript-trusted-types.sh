#!/usr/bin/env bash
# 给 chromium 自带的 TypeScript 5.0.3 lib.dom.d.ts 追加 Trusted Types 占位声明。
# 因为 lib.dom.d.ts 引用了 TrustedHTML / TrustedScript / TrustedScriptURL
# 但自身没声明这些类型；chromium tsconfig 又把 typeRoots 设为空数组阻止
# 自动加载 @types/trusted-types。所以这里直接在 lib.dom.d.ts 末尾追加占位
# type alias，让 tsc 能过类型检查。
#
# 这是 node_modules 里的文件，chromium master 不追踪，所以走 shell 脚本而非 patch。
#
# 用法：
#   bash typescript-trusted-types.sh /path/to/chromium/src

set -euo pipefail

CHROMIUM_SRC="${1:-/Users/hongrunhui/Documents/code/chromium/src}"
TARGET="$CHROMIUM_SRC/third_party/node/node_modules/typescript/lib/lib.dom.d.ts"

if [[ ! -f "$TARGET" ]]; then
  echo "ERROR: $TARGET not found" >&2
  exit 1
fi

if grep -q "open-replay browser patch" "$TARGET" 2>/dev/null; then
  echo "Already patched."
  exit 0
fi

cat >> "$TARGET" <<'EOF'

// [open-replay browser patch 2026-04-28]
// TypeScript 5.0.3 自带的 lib.dom.d.ts 引用了 Trusted Types API 类型
// (TrustedHTML / TrustedScript / TrustedScriptURL) 但它自己没声明，且
// chromium tsconfig 里 typeRoots:[] 关掉了 @types 自动发现。
// 这里追加占位 type alias（语义上等价于 string，跟规范的实际行为一致），
// 让 tsc 通过类型检查。生产 chrome 用的是 native 实现，不靠这套类型。
declare type TrustedHTML = string;
declare type TrustedScript = string;
declare type TrustedScriptURL = string;
declare interface TrustedTypePolicyFactory {
    createPolicy(name: string, options?: any): any;
}
declare var trustedTypes: TrustedTypePolicyFactory | undefined;
EOF
echo "Patched: $TARGET"
