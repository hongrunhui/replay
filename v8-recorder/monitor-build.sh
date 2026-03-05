#!/bin/bash
# 监控 V8 编译进度

echo "========================================="
echo "  V8 编译进度监控"
echo "========================================="
echo ""

BUILD_DIR="v8-workspace/v8/out.gn/x64.release"

if [ ! -d "$BUILD_DIR" ]; then
    echo "❌ 编译目录不存在: $BUILD_DIR"
    exit 1
fi

# 总任务数
TOTAL_TASKS=5140

while true; do
    # 统计已编译的 .o 文件
    COMPILED=$(find "$BUILD_DIR" -name "*.o" 2>/dev/null | wc -l | tr -d ' ')

    # 统计已编译的 .a 文件
    ARCHIVES=$(find "$BUILD_DIR" -name "*.a" 2>/dev/null | wc -l | tr -d ' ')

    # 检查是否有 ninja 进程在运行
    if ps aux | grep -v grep | grep -q "ninja.*x64.release"; then
        STATUS="🔄 编译中"
    else
        STATUS="⏸️  已停止"
    fi

    # 计算进度
    PROGRESS=$((COMPILED * 100 / TOTAL_TASKS))

    # 清屏并显示进度
    clear
    echo "========================================="
    echo "  V8 编译进度监控"
    echo "========================================="
    echo ""
    echo "状态: $STATUS"
    echo ""
    echo "进度: $PROGRESS% ($COMPILED / $TOTAL_TASKS)"
    echo ""

    # 进度条
    BAR_LENGTH=50
    FILLED=$((PROGRESS * BAR_LENGTH / 100))
    printf "["
    for i in $(seq 1 $FILLED); do printf "="; done
    for i in $(seq $((FILLED + 1)) $BAR_LENGTH); do printf " "; done
    printf "] $PROGRESS%%\n"
    echo ""

    echo "统计:"
    echo "  目标文件 (.o): $COMPILED"
    echo "  静态库 (.a):   $ARCHIVES"
    echo ""

    # 预估剩余时间
    if [ "$COMPILED" -gt 0 ]; then
        REMAINING=$((TOTAL_TASKS - COMPILED))
        # 假设每个文件平均 1 秒
        REMAINING_MINUTES=$((REMAINING / 60))
        echo "预估剩余时间: ~$REMAINING_MINUTES 分钟"
    fi
    echo ""

    # 最近编译的文件
    echo "最近编译的文件:"
    find "$BUILD_DIR" -name "*.o" -type f -mmin -1 2>/dev/null | tail -5 | while read file; do
        echo "  $(basename $file)"
    done
    echo ""

    echo "按 Ctrl+C 退出监控"
    echo "========================================="

    # 检查是否完成
    if [ "$COMPILED" -ge "$TOTAL_TASKS" ] && ! ps aux | grep -v grep | grep -q "ninja.*x64.release"; then
        echo ""
        echo "🎉 编译完成！"
        break
    fi

    sleep 5
done
