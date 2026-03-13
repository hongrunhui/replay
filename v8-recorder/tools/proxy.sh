#!/bin/bash
# 代理配置管理脚本

PROXY_HOST="127.0.0.1"
PROXY_PORT="7897"

show_usage() {
    echo "Usage: $0 {enable|disable|status|test}"
    echo ""
    echo "Commands:"
    echo "  enable   - Enable proxy for Git and environment"
    echo "  disable  - Disable proxy"
    echo "  status   - Show current proxy configuration"
    echo "  test     - Test proxy connection"
    echo ""
    echo "Current proxy: ${PROXY_HOST}:${PROXY_PORT}"
    echo "To change proxy, edit this script and modify PROXY_HOST and PROXY_PORT"
}

enable_proxy() {
    echo "Enabling proxy: ${PROXY_HOST}:${PROXY_PORT}"

    # 设置环境变量
    export HTTP_PROXY="http://${PROXY_HOST}:${PROXY_PORT}"
    export HTTPS_PROXY="http://${PROXY_HOST}:${PROXY_PORT}"
    export http_proxy="http://${PROXY_HOST}:${PROXY_PORT}"
    export https_proxy="http://${PROXY_HOST}:${PROXY_PORT}"

    # 配置 Git
    git config --global http.proxy "http://${PROXY_HOST}:${PROXY_PORT}"
    git config --global https.proxy "http://${PROXY_HOST}:${PROXY_PORT}"

    # 添加到 shell 配置文件
    SHELL_RC=""
    if [ -f "$HOME/.zshrc" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        SHELL_RC="$HOME/.bashrc"
    fi

    if [ -n "$SHELL_RC" ]; then
        # 检查是否已经添加
        if ! grep -q "V8_RECORDER_PROXY" "$SHELL_RC"; then
            echo "" >> "$SHELL_RC"
            echo "# V8 Recorder Proxy Configuration" >> "$SHELL_RC"
            echo "export HTTP_PROXY=\"http://${PROXY_HOST}:${PROXY_PORT}\"" >> "$SHELL_RC"
            echo "export HTTPS_PROXY=\"http://${PROXY_HOST}:${PROXY_PORT}\"" >> "$SHELL_RC"
            echo "export http_proxy=\"http://${PROXY_HOST}:${PROXY_PORT}\"" >> "$SHELL_RC"
            echo "export https_proxy=\"http://${PROXY_HOST}:${PROXY_PORT}\"" >> "$SHELL_RC"
            echo "# V8_RECORDER_PROXY" >> "$SHELL_RC"
            echo "✓ Added proxy to $SHELL_RC"
        else
            echo "✓ Proxy already in $SHELL_RC"
        fi
    fi

    echo "✓ Proxy enabled"
    echo ""
    echo "Note: For current session, run:"
    echo "  source $SHELL_RC"
    echo "Or restart your terminal"
}

disable_proxy() {
    echo "Disabling proxy..."

    # 取消环境变量
    unset HTTP_PROXY
    unset HTTPS_PROXY
    unset http_proxy
    unset https_proxy

    # 取消 Git 配置
    git config --global --unset http.proxy 2>/dev/null || true
    git config --global --unset https.proxy 2>/dev/null || true

    # 从 shell 配置文件中移除
    SHELL_RC=""
    if [ -f "$HOME/.zshrc" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        SHELL_RC="$HOME/.bashrc"
    fi

    if [ -n "$SHELL_RC" ]; then
        # 删除代理配置行
        sed -i.bak '/V8 Recorder Proxy Configuration/,/V8_RECORDER_PROXY/d' "$SHELL_RC" 2>/dev/null || true
        echo "✓ Removed proxy from $SHELL_RC"
    fi

    echo "✓ Proxy disabled"
}

show_status() {
    echo "=== Proxy Status ==="
    echo ""
    echo "Environment Variables:"
    echo "  HTTP_PROXY:  ${HTTP_PROXY:-<not set>}"
    echo "  HTTPS_PROXY: ${HTTPS_PROXY:-<not set>}"
    echo ""
    echo "Git Configuration:"
    echo "  http.proxy:  $(git config --global --get http.proxy 2>/dev/null || echo '<not set>')"
    echo "  https.proxy: $(git config --global --get https.proxy 2>/dev/null || echo '<not set>')"
    echo ""
}

test_proxy() {
    echo "Testing proxy connection to ${PROXY_HOST}:${PROXY_PORT}..."
    echo ""

    # 测试代理端口是否开放
    if command -v nc &> /dev/null; then
        if nc -z -w 2 ${PROXY_HOST} ${PROXY_PORT} 2>/dev/null; then
            echo "✓ Proxy port is open"
        else
            echo "✗ Cannot connect to proxy port"
            echo "  Make sure your proxy is running on ${PROXY_HOST}:${PROXY_PORT}"
            return 1
        fi
    else
        echo "⚠ 'nc' command not found, skipping port check"
    fi

    # 测试通过代理访问 Google
    echo ""
    echo "Testing connection to chromium.googlesource.com..."
    if curl -x "http://${PROXY_HOST}:${PROXY_PORT}" \
            -s -o /dev/null -w "%{http_code}" \
            --connect-timeout 5 \
            https://chromium.googlesource.com 2>/dev/null | grep -q "200\|301\|302"; then
        echo "✓ Proxy is working correctly"
        return 0
    else
        echo "✗ Cannot access chromium.googlesource.com through proxy"
        echo "  Check your proxy configuration"
        return 1
    fi
}

# 主逻辑
case "$1" in
    enable)
        enable_proxy
        ;;
    disable)
        disable_proxy
        ;;
    status)
        show_status
        ;;
    test)
        test_proxy
        ;;
    *)
        show_usage
        exit 1
        ;;
esac
