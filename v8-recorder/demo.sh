#!/bin/bash
# 演示脚本 - 展示 V8 Recorder 的完整功能

set -e

echo "========================================="
echo "  V8 Recorder 功能演示"
echo "========================================="
echo ""

# 检查是否已编译
if [ ! -f "simple" ] || [ ! -f "fibonacci" ] || [ ! -f "replay" ]; then
    echo "❌ 示例程序未编译"
    echo "请先运行: ./compile-examples.sh"
    exit 1
fi

echo "📝 演示内容:"
echo "  1. 录制简单计算 (simple)"
echo "  2. 录制 Fibonacci 递归 (fibonacci)"
echo "  3. 分析录制文件"
echo "  4. 重放录制"
echo ""
read -p "按 Enter 开始演示..."

# ==========================================
# 1. Simple 示例
# ==========================================
echo ""
echo "========================================="
echo "1️⃣  录制简单计算"
echo "========================================="
echo ""
echo "运行: ./simple"
echo ""
sleep 1

./simple

echo ""
echo "✅ 录制完成！"
echo ""
ls -lh simple.rec
echo ""
read -p "按 Enter 继续..."

# ==========================================
# 2. Fibonacci 示例
# ==========================================
echo ""
echo "========================================="
echo "2️⃣  录制 Fibonacci 递归计算"
echo "========================================="
echo ""
echo "运行: ./fibonacci"
echo ""
sleep 1

./fibonacci

echo ""
echo "✅ 录制完成！"
echo ""
ls -lh fibonacci.rec
echo ""
read -p "按 Enter 继续..."

# ==========================================
# 3. 分析录制文件
# ==========================================
echo ""
echo "========================================="
echo "3️⃣  分析录制文件"
echo "========================================="
echo ""
echo "运行: python3 analyze.py fibonacci.rec"
echo ""
sleep 1

python3 analyze.py fibonacci.rec

echo ""
read -p "按 Enter 查看执行轨迹..."

echo ""
echo "运行: python3 analyze.py fibonacci.rec --trace"
echo ""
sleep 1

python3 analyze.py fibonacci.rec --trace | head -30

echo ""
echo "... (更多执行点)"
echo ""
read -p "按 Enter 继续..."

# ==========================================
# 4. 重放演示
# ==========================================
echo ""
echo "========================================="
echo "4️⃣  重放录制"
echo "========================================="
echo ""
echo "我们将演示完整重放模式"
echo ""
sleep 1

echo "运行: ./replay fibonacci.rec"
echo ""
sleep 1

# 自动选择选项 1 (完整重放)
echo "1" | ./replay fibonacci.rec

echo ""
echo "✅ 重放完成！"
echo ""

# ==========================================
# 总结
# ==========================================
echo ""
echo "========================================="
echo "  演示完成！"
echo "========================================="
echo ""
echo "📊 生成的文件:"
echo ""
ls -lh *.rec 2>/dev/null || echo "  (无录制文件)"
echo ""
echo "🎯 你可以尝试:"
echo ""
echo "  1. 单步重放:"
echo "     ./replay fibonacci.rec"
echo "     选择选项 2，按 Enter 逐步执行"
echo ""
echo "  2. 断点调试:"
echo "     ./replay fibonacci.rec"
echo "     选择选项 3，输入断点位置 (如 100)"
echo ""
echo "  3. 分析其他录制:"
echo "     python3 analyze.py simple.rec"
echo ""
echo "  4. 修改代码重新录制:"
echo "     vim examples/fibonacci.cc"
echo "     ./compile-examples.sh"
echo "     ./fibonacci"
echo ""
echo "========================================="
echo ""
