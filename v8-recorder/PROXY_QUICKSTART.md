# V8 Recorder 代理配置快速参考

## 你的代理配置
```
地址: 127.0.0.1
端口: 7897
```

## 三步配置

### 1️⃣ 启用代理
```bash
cd v8-recorder
./proxy.sh enable
```

### 2️⃣ 测试代理
```bash
./proxy.sh test
```

期望输出:
```
✓ Proxy port is open
✓ Proxy is working correctly
```

### 3️⃣ 运行安装
```bash
./setup.sh
```

## 常用命令

```bash
# 查看代理状态
./proxy.sh status

# 禁用代理
./proxy.sh disable

# 测试代理连接
./proxy.sh test
```

## 修改代理地址

编辑 `proxy.sh`:
```bash
PROXY_HOST="127.0.0.1"  # 修改为你的代理地址
PROXY_PORT="7897"       # 修改为你的代理端口
```

或编辑 `setup.sh`:
```bash
PROXY_HOST="127.0.0.1"
PROXY_PORT="7897"
USE_PROXY=true
```

## 常见代理端口

| 软件 | 默认端口 |
|------|---------|
| Clash | 7890 |
| V2Ray | 10809 |
| Shadowsocks | 1080 |
| 你的配置 | 7897 |

## 故障排除

### 代理无法连接
```bash
# 检查代理是否运行
ps aux | grep -i clash  # 或你的代理软件名

# 检查端口
lsof -i :7897
```

### 下载很慢
```bash
# 增加 Git 超时
git config --global http.postBuffer 1048576000
git config --global http.lowSpeedLimit 0
```

### 清理代理配置
```bash
./proxy.sh disable
```

## 完整文档

详细配置说明请查看: [PROXY.md](PROXY.md)

## 预计下载时间

- depot_tools: ~1 分钟
- V8 源码: ~10-30 分钟 (取决于网速)
- 总计: ~15-45 分钟

---

**提示**: 首次下载 V8 源码需要较长时间，请耐心等待。
