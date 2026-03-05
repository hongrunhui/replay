# GitHub 提交指南

## 📦 应该提交的文件

### ✅ 源代码
```
v8-recorder/src/recorder/
├── recorder.h          # 录制器头文件
├── recorder.cc         # 录制器实现
├── replayer.h          # 重放器头文件
└── replayer.cc         # 重放器实现
```

### ✅ 示例程序
```
v8-recorder/examples/
├── simple.cc           # 简单示例
├── fibonacci.cc        # Fibonacci 示例
└── replay.cc           # 重放工具
```

### ✅ 补丁文件
```
v8-recorder/patches/
├── 001-add-recorder.patch
├── 002-instrument-interpreter.patch
├── 003-intercept-builtins.patch
└── 004-fix-python313.patch
```

### ✅ 脚本文件
```
v8-recorder/
├── setup.sh                # 安装脚本
├── build.sh                # 编译脚本
├── compile-examples.sh     # 编译示例
├── test.sh                 # 测试脚本
├── demo.sh                 # 演示脚本
├── proxy.sh                # 代理管理
├── fix-python313.sh        # Python 修复
└── analyze.py              # 分析工具
```

### ✅ 文档文件
```
根目录:
├── README.md                           # 项目主页
├── Replay.io架构分析文档.md
├── Replay-Chromium录制层架构分析.md
├── Replay.io-NPM包录制原理分析.md
├── V8引擎插桩实现原理.md
├── Replay重放机制与断点调试原理.md
├── 云端回放架构设计.md
├── 实现最小录制工具方案.md
└── 开发状态报告.md

v8-recorder/:
├── README.md
├── QUICKSTART.md
├── USAGE.md
├── PROJECT_SUMMARY.md
├── PROXY.md
├── PROXY_QUICKSTART.md
├── PYTHON313_FIX.md
└── EXPECTED_OUTPUT.md
```

### ✅ 配置文件
```
├── .gitignore              # Git 忽略规则
├── package.json            # 项目配置
└── LICENSE                 # 许可证（需要创建）
```

---

## ❌ 不应该提交的文件

### ❌ V8 源码和工具链（太大）
```
v8-recorder/v8-workspace/   # 6.8 GB - V8 源码
v8-recorder/depot_tools/    # 86 MB - 构建工具
```

### ❌ 编译产物
```
v8-recorder/simple          # 可执行文件
v8-recorder/fibonacci       # 可执行文件
v8-recorder/replay          # 可执行文件
*.o                         # 目标文件
*.a                         # 静态库
*.so                        # 动态库
```

### ❌ 录制文件
```
*.rec                       # 录制文件
```

### ❌ 临时文件
```
*.bak                       # 备份文件
*.tmp                       # 临时文件
.DS_Store                   # macOS 系统文件
```

### ❌ Node 模块
```
node_modules/               # NPM 依赖
package-lock.json           # 锁文件
```

---

## 🚀 提交步骤

### 1. 初始化 Git 仓库

```bash
cd /Users/hongrunhui/Documents/code/各种框架源码/replay

# 初始化 Git（如果还没有）
git init

# 添加 .gitignore
git add .gitignore
git commit -m "Add .gitignore"
```

### 2. 添加源代码和文档

```bash
# 添加所有应该提交的文件
git add README.md
git add *.md
git add package.json

# 添加 v8-recorder 目录（会自动排除 .gitignore 中的文件）
git add v8-recorder/src/
git add v8-recorder/examples/
git add v8-recorder/patches/
git add v8-recorder/*.sh
git add v8-recorder/*.py
git add v8-recorder/*.md

# 查看将要提交的文件
git status
```

### 3. 创建首次提交

```bash
git commit -m "Initial commit: V8 Recorder - JavaScript execution recording and replay system

Features:
- Bytecode-level execution tracing
- Non-deterministic operation interception
- Full replay with time-travel debugging
- Performance analysis tools
- Complete documentation in Chinese

Includes:
- Core recorder/replayer implementation (C++)
- Example programs (simple, fibonacci, replay)
- V8 integration patches
- Analysis tools (Python)
- Setup and build scripts
- Comprehensive documentation"
```

### 4. 创建 GitHub 仓库

在 GitHub 上创建新仓库，然后：

```bash
# 添加远程仓库
git remote add origin https://github.com/your-username/replay.git

# 推送到 GitHub
git push -u origin main
```

---

## 📊 提交前检查清单

### 文件检查
- [ ] 已创建 .gitignore
- [ ] 已创建 README.md
- [ ] 所有源代码文件已添加
- [ ] 所有文档文件已添加
- [ ] 所有脚本文件已添加且可执行

### 内容检查
- [ ] 移除了所有敏感信息
- [ ] 移除了所有个人路径
- [ ] 文档中的链接已更新
- [ ] README.md 中的用户名已更新

### 大小检查
```bash
# 检查仓库大小（应该 < 10 MB）
du -sh .git

# 检查最大的文件
find . -type f -size +1M ! -path "./.git/*" ! -path "./node_modules/*" ! -path "./v8-recorder/v8-workspace/*" ! -path "./v8-recorder/depot_tools/*"
```

---

## 📝 提交信息规范

### 格式
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建/工具

### 示例
```bash
# 新功能
git commit -m "feat(recorder): add support for async operations"

# Bug 修复
git commit -m "fix(replayer): fix breakpoint not working in nested calls"

# 文档更新
git commit -m "docs: update proxy configuration guide"

# 工具更新
git commit -m "chore(build): add Python 3.13 compatibility fix"
```

---

## 🔍 验证提交内容

### 查看将要提交的文件
```bash
git status
git diff --cached
```

### 查看文件大小
```bash
git ls-files | xargs du -h | sort -h | tail -20
```

### 检查是否包含大文件
```bash
git ls-files | xargs ls -lh | awk '$5 > 1000000 {print $5, $9}'
```

---

## 🎯 推荐的提交顺序

### 第一次提交
```bash
# 1. 基础配置
git add .gitignore README.md LICENSE
git commit -m "chore: initial project setup"

# 2. 核心代码
git add v8-recorder/src/
git commit -m "feat: add core recorder and replayer implementation"

# 3. 示例程序
git add v8-recorder/examples/
git commit -m "feat: add example programs"

# 4. 补丁文件
git add v8-recorder/patches/
git commit -m "feat: add V8 integration patches"

# 5. 工具脚本
git add v8-recorder/*.sh v8-recorder/*.py
git commit -m "feat: add build and analysis tools"

# 6. 文档
git add v8-recorder/*.md *.md
git commit -m "docs: add comprehensive documentation"
```

### 或者一次性提交
```bash
git add .
git commit -m "Initial commit: complete V8 Recorder implementation"
git push -u origin main
```

---

## 📦 仓库大小预估

提交后的仓库大小约为：

| 内容 | 大小 |
|------|------|
| 源代码 | ~50 KB |
| 示例程序 | ~10 KB |
| 补丁文件 | ~10 KB |
| 脚本文件 | ~30 KB |
| 文档 | ~200 KB |
| **总计** | **~300 KB** |

非常适合 GitHub 托管！

---

## 🔗 后续步骤

提交后，建议：

1. **添加 LICENSE 文件**
   ```bash
   # 使用 BSD-3-Clause 许可证（与 V8 相同）
   ```

2. **创建 GitHub Actions**
   - 自动化测试
   - 文档构建

3. **添加 Badges**
   - 许可证
   - 构建状态
   - 代码覆盖率

4. **创建 Wiki**
   - 详细教程
   - FAQ
   - 贡献指南

5. **设置 GitHub Pages**
   - 项目主页
   - 在线文档

---

## ⚠️ 注意事项

1. **不要提交 v8-workspace/** - 太大（6.8 GB）
2. **不要提交 depot_tools/** - 太大（86 MB）
3. **不要提交编译产物** - 可执行文件、.o、.a 文件
4. **不要提交录制文件** - *.rec 文件
5. **检查敏感信息** - 个人路径、密钥等

---

## 🆘 常见问题

### Q: 如何移除已提交的大文件？
```bash
# 使用 git filter-branch
git filter-branch --tree-filter 'rm -rf v8-workspace' HEAD

# 或使用 BFG Repo-Cleaner
bfg --delete-folders v8-workspace
```

### Q: 如何查看仓库历史大小？
```bash
git count-objects -vH
```

### Q: 如何压缩仓库？
```bash
git gc --aggressive --prune=now
```

---

**准备好了吗？开始提交吧！** 🚀
