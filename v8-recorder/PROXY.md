# 代理配置指南

## 快速配置

如果你在中国大陆或其他需要代理访问 Google 服务的地区，可以使用以下方法配置代理。

### 方法 1: 使用 proxy.sh 脚本 (推荐)

```bash
# 1. 编辑 proxy.sh，设置你的代理地址
vim proxy.sh
# 修改 PROXY_HOST 和 PROXY_PORT

# 2. 启用代理
./proxy.sh enable

# 3. 测试代理
./proxy.sh test

# 4. 查看状态
./proxy.sh status

# 5. 禁用代理 (可选)
./proxy.sh disable
```

### 方法 2: 修改 setup.sh

编辑 `setup.sh` 文件，在开头设置代理:

```bash
# 代理配置
PROXY_HOST="127.0.0.1"
PROXY_PORT="7897"
USE_PROXY=true  # 设置为 false 禁用代理
```

然后运行:

```bash
./setup.sh
```

### 方法 3: 手动设置环境变量

```bash
# 设置代理环境变量
export HTTP_PROXY="http://127.0.0.1:7897"
export HTTPS_PROXY="http://127.0.0.1:7897"

# 配置 Git 代理
git config --global http.proxy "http://127.0.0.1:7897"
git config --global https.proxy "http://127.0.0.1:7897"

# 运行 setup.sh
./setup.sh
```

## 常见代理软件配置

### Clash

```yaml
# Clash 配置示例
port: 7890
socks-port: 7891
allow-lan: true
mode: Rule
log-level: info
```

默认 HTTP 代理端口: `7890`

### V2Ray

默认端口通常是 `1080` (SOCKS) 或 `10809` (HTTP)

### Shadowsocks

需要配合 privoxy 或其他工具转换为 HTTP 代理

## 验证代理配置

### 1. 检查代理端口

```bash
# macOS/Linux
nc -zv 127.0.0.1 7897

# 或使用 telnet
telnet 127.0.0.1 7897
```

### 2. 测试代理连接

```bash
# 使用 curl 测试
curl -x http://127.0.0.1:7897 https://www.google.com

# 测试访问 Chromium 源
curl -x http://127.0.0.1:7897 https://chromium.googlesource.com
```

### 3. 使用 proxy.sh 测试

```bash
./proxy.sh test
```

输出示例:
```
Testing proxy connection to 127.0.0.1:7897...

✓ Proxy port is open

Testing connection to chromium.googlesource.com...
✓ Proxy is working correctly
```

## 常见问题

### 问题 1: 代理连接失败

**症状**: `Cannot connect to proxy port`

**解决方案**:
1. 确认代理软件正在运行
2. 检查代理端口是否正确
3. 确认防火墙没有阻止连接

```bash
# 检查代理进程
ps aux | grep -i clash  # 或 v2ray, shadowsocks

# 检查端口监听
lsof -i :7897
netstat -an | grep 7897
```

### 问题 2: depot_tools 下载慢

**症状**: `fetch v8` 命令卡住或很慢

**解决方案**:
1. 确认代理已正确配置
2. 尝试使用 SOCKS 代理转 HTTP 代理
3. 增加 Git 超时时间

```bash
# 增加 Git 超时
git config --global http.lowSpeedLimit 0
git config --global http.lowSpeedTime 999999
git config --global http.postBuffer 1048576000
```

### 问题 3: gclient sync 失败

**症状**: `gclient sync` 报错或超时

**解决方案**:
1. 确认代理对 HTTPS 有效
2. 设置 depot_tools 使用代理

```bash
# 设置 depot_tools 代理
export DEPOT_TOOLS_HTTP_PROXY="http://127.0.0.1:7897"
export DEPOT_TOOLS_HTTPS_PROXY="http://127.0.0.1:7897"

# 重试
gclient sync
```

### 问题 4: SSL 证书错误

**症状**: `SSL certificate problem`

**解决方案**:
```bash
# 临时禁用 SSL 验证 (不推荐用于生产环境)
git config --global http.sslVerify false

# 或者配置代理的 CA 证书
git config --global http.sslCAInfo /path/to/ca-bundle.crt
```

## 代理配置检查清单

使用此清单确保代理配置正确:

- [ ] 代理软件正在运行
- [ ] 代理端口正确 (127.0.0.1:7897)
- [ ] 环境变量已设置 (HTTP_PROXY, HTTPS_PROXY)
- [ ] Git 代理已配置
- [ ] 代理连接测试通过
- [ ] 可以访问 chromium.googlesource.com

## 完整配置示例

### 使用 Clash (端口 7890)

```bash
# 1. 启动 Clash
# 2. 配置代理
./proxy.sh enable  # 会自动使用 setup.sh 中的配置

# 或手动设置
export HTTP_PROXY="http://127.0.0.1:7890"
export HTTPS_PROXY="http://127.0.0.1:7890"
git config --global http.proxy "http://127.0.0.1:7890"
git config --global https.proxy "http://127.0.0.1:7890"

# 3. 测试
./proxy.sh test

# 4. 运行安装
./setup.sh
```

### 使用 V2Ray (端口 10809)

```bash
# 修改 proxy.sh 中的端口
# PROXY_PORT="10809"

# 然后执行
./proxy.sh enable
./proxy.sh test
./setup.sh
```

## 下载时间估算

使用代理后的预期下载时间:

| 组件 | 大小 | 时间 (10Mbps) | 时间 (50Mbps) |
|------|------|---------------|---------------|
| depot_tools | ~50MB | 1 分钟 | 10 秒 |
| V8 源码 | ~2GB | 30 分钟 | 6 分钟 |
| 依赖项 | ~1GB | 15 分钟 | 3 分钟 |
| **总计** | ~3GB | **45 分钟** | **10 分钟** |

## 清理代理配置

如果不再需要代理:

```bash
# 使用脚本清理
./proxy.sh disable

# 或手动清理
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
git config --global --unset http.proxy
git config --global --unset https.proxy
```

## 参考资料

- [Git 代理配置](https://git-scm.com/docs/git-config#Documentation/git-config.txt-httpproxy)
- [depot_tools 文档](https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools.html)
- [Clash 文档](https://github.com/Dreamacro/clash)
- [V2Ray 文档](https://www.v2ray.com/)
