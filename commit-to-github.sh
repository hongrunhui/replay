#!/bin/bash
# 一键提交到 GitHub 的脚本

set -e

echo "========================================="
echo "  准备提交到 GitHub"
echo "========================================="
echo ""

# 检查是否有暂存的文件
STAGED_FILES=$(git diff --cached --name-only | wc -l)
if [ "$STAGED_FILES" -eq 0 ]; then
    echo "❌ 没有暂存的文件"
    echo "请先运行: git add ."
    exit 1
fi

echo "📊 提交统计:"
echo "  文件数量: $STAGED_FILES 个"
echo "  仓库大小: $(du -sh .git | cut -f1)"
echo ""

# 显示将要提交的文件
echo "📁 将要提交的文件:"
git status --short | head -20
if [ "$STAGED_FILES" -gt 20 ]; then
    echo "  ... 还有 $((STAGED_FILES - 20)) 个文件"
fi
echo ""

# 确认提交
read -p "确认提交这些文件? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 取消提交"
    exit 1
fi

# 提交到本地仓库
echo ""
echo "📝 提交到本地仓库..."
git commit -m "Initial commit: V8 Recorder - JavaScript execution recording and replay system

Complete implementation including:
- Core recorder/replayer implementation (C++)
- Example programs (simple, fibonacci, replay)
- V8 integration patches (4 patches)
- Build and analysis tools (Python, Shell)
- Comprehensive Chinese documentation
- Proxy configuration for China users
- Python 3.13 compatibility fix

Features:
- Bytecode-level execution tracing
- Non-deterministic operation interception (Math.random, Date.now, console.log)
- Full replay with time-travel debugging
- Performance analysis tools
- Complete toolchain from recording to analysis

Documentation:
- Architecture analysis documents (8 files)
- Quick start guide
- Detailed usage guide
- Proxy configuration guide
- Expected output reference

Total: 41 files, ~300 KB"

echo "✅ 本地提交完成"
echo ""

# 询问是否推送到 GitHub
read -p "是否推送到 GitHub? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "ℹ️  本地提交已完成，稍后可以手动推送"
    echo ""
    echo "推送命令:"
    echo "  git remote add origin https://github.com/YOUR_USERNAME/replay.git"
    echo "  git branch -M main"
    echo "  git push -u origin main"
    exit 0
fi

# 检查是否已配置远程仓库
if ! git remote | grep -q "origin"; then
    echo ""
    echo "⚠️  未配置远程仓库"
    echo ""
    read -p "请输入 GitHub 仓库地址 (例: https://github.com/username/replay.git): " REPO_URL

    if [ -z "$REPO_URL" ]; then
        echo "❌ 未输入仓库地址"
        exit 1
    fi

    git remote add origin "$REPO_URL"
    echo "✅ 已添加远程仓库: $REPO_URL"
fi

# 推送到 GitHub
echo ""
echo "📤 推送到 GitHub..."
git branch -M main
git push -u origin main

echo ""
echo "========================================="
echo "  ✅ 提交完成！"
echo "========================================="
echo ""
echo "🎉 项目已成功推送到 GitHub"
echo ""
echo "📝 下一步:"
echo "  1. 访问你的 GitHub 仓库"
echo "  2. 添加项目描述和标签"
echo "  3. 创建 Release"
echo "  4. 分享给其他人"
echo ""
