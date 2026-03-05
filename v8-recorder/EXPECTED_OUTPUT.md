# 示例程序预期输出

## 1. simple 示例

### 运行命令
```bash
./simple
```

### 预期输出
```
Starting recording...
[Recorder] Started recording to: simple.rec
Result: 25
[Recorder] Stopped recording
[Recorder] Total execution points: 156
[Recorder] Non-deterministic data: 0
Recording stopped
Script result: 25
```

### 说明
- ✅ 成功创建 `simple.rec` 文件
- ✅ 记录了约 150+ 个执行点
- ✅ 最终结果是 25 (add(2,3) + multiply(4,5) = 5 + 20 = 25)
- ✅ 没有非确定性数据（因为只有纯计算）

### 生成的文件
```bash
ls -lh simple.rec
# 预期大小: 约 20-50 KB
```

---

## 2. fibonacci 示例

### 运行命令
```bash
./fibonacci
```

### 预期输出
```
Recording Fibonacci execution...
[Recorder] Started recording to: fibonacci.rec
Fibonacci(10) = 55
Random: 0.7234567890123456
Time: 1709876543210
Combined result: 127.34567890123456
[Recorder] Stopped recording
[Recorder] Total execution points: 287
[Recorder] Non-deterministic data: 2
Final result: 127.34567890123456
```

### 说明
- ✅ Fibonacci(10) = 55 (正确结果)
- ✅ 记录了约 280+ 个执行点（递归调用很多）
- ✅ 记录了 2 个非确定性数据：
  - 1 个随机数 (Math.random)
  - 1 个时间戳 (Date.now)
- ✅ 随机数和时间戳的值每次运行都不同（这是正常的）

### 生成的文件
```bash
ls -lh fibonacci.rec
# 预期大小: 约 30-80 KB
```

---

## 3. replay 示例

### 运行命令
```bash
./replay fibonacci.rec
```

### 预期输出

#### 启动界面
```
Loading recording from: fibonacci.rec
[Replayer] Loaded recording from: fibonacci.rec
[Replayer] Total execution points: 287
[Replayer] Non-deterministic data: 2
[Replayer] Built indices:
  Random: 1
  Time: 1
  IO: 0

=== Replay Options ===
1. Full replay
2. Step-by-step replay
3. Replay with breakpoint
Enter option (1-3):
```

#### 选项 1: 完整重放
```
输入: 1

=== Full Replay ===
  [0] <anonymous> at line 32:6 (depth: 0)
  [1] fibonacci at line 33:8 (depth: 1)
  [2] fibonacci at line 37:15 (depth: 2)
  [3] fibonacci at line 37:15 (depth: 3)
  [4] fibonacci at line 37:15 (depth: 4)
  [5] fibonacci at line 37:15 (depth: 5)
  [6] fibonacci at line 37:15 (depth: 6)
  [7] fibonacci at line 37:15 (depth: 7)
  [8] fibonacci at line 37:15 (depth: 8)
  [9] fibonacci at line 37:15 (depth: 9)
  [100] fibonacci at line 37:15 (depth: 5)
  [200] fibonacci at line 37:15 (depth: 3)

Total execution points: 287

=== Replay Statistics ===
Total execution points: 287
Current position: 287
```

#### 选项 2: 单步重放
```
输入: 2

=== Step-by-Step Replay ===
Press Enter to step, 'q' to quit

按 Enter:
  [0] <anonymous> at line 32:6 (depth: 0)

按 Enter:
  [1] fibonacci at line 33:8 (depth: 1)

按 Enter:
  [2] fibonacci at line 37:15 (depth: 2)

按 Enter:
  [3] fibonacci at line 37:15 (depth: 3)
    Random value: 0.7234567890123456

按 Enter:
  [4] fibonacci at line 37:15 (depth: 4)
    Time value: 1709876543210

输入 'q' 退出
```

#### 选项 3: 断点重放
```
输入: 3

=== Replay with Breakpoint ===
Enter breakpoint execution point ID: 100

Running until breakpoint...

Breakpoint hit!
  [100] fibonacci at line 37:15 (depth: 5)
Executed 100 points before breakpoint

=== Replay Statistics ===
Total execution points: 287
Current position: 101
```

---

## 4. analyze.py 分析工具

### 运行命令
```bash
python3 analyze.py fibonacci.rec
```

### 预期输出
```
=== Recording File: fibonacci.rec ===
Magic: V8REC001
Version: 1
Timestamp: 1709876543210

=== Statistics ===
Total execution points: 287
Non-deterministic data: 2

=== Top 10 Functions ===
  fibonacci: 177 calls
  <anonymous>: 55 calls
  add: 30 calls
  multiply: 25 calls

=== Non-Deterministic Data ===
  RANDOM: 1
  TIME: 1

=== Call Stack ===
Maximum depth: 11

=== Execution Time ===
Duration: 15.43 ms (15430 μs)
```

### 带 --trace 参数
```bash
python3 analyze.py fibonacci.rec --trace
```

### 预期输出（额外显示）
```
=== Execution Trace (first 20 points) ===
[   0] <anonymous> at 32:6
[   1]   fibonacci at 33:8
[   2]     fibonacci at 37:15
[   3]       fibonacci at 37:15
[   4]         fibonacci at 37:15
[   5]           fibonacci at 37:15
[   6]             fibonacci at 37:15
[   7]               fibonacci at 37:15
[   8]                 fibonacci at 37:15
[   9]                   fibonacci at 37:15
[  10]                     fibonacci at 37:15
[  11]                       fibonacci at 37:15
[  12]                     fibonacci at 37:15
[  13]                   fibonacci at 37:15
[  14]                 fibonacci at 37:15
[  15]               fibonacci at 37:15
[  16]             fibonacci at 37:15
[  17]           fibonacci at 37:15
[  18]         fibonacci at 37:15
[  19]       fibonacci at 37:15
... and 267 more points
```

---

## 验证清单

### ✅ simple 示例正常运行的标志
- [ ] 程序正常退出（无错误）
- [ ] 生成 simple.rec 文件
- [ ] 文件大小 20-50 KB
- [ ] 输出显示 "Total execution points: 150+"
- [ ] 最终结果是 25

### ✅ fibonacci 示例正常运行的标志
- [ ] 程序正常退出（无错误）
- [ ] 生成 fibonacci.rec 文件
- [ ] 文件大小 30-80 KB
- [ ] 输出显示 "Fibonacci(10) = 55"
- [ ] 输出显示 "Total execution points: 280+"
- [ ] 输出显示 "Non-deterministic data: 2"
- [ ] 显示随机数和时间戳

### ✅ replay 示例正常运行的标志
- [ ] 成功加载 .rec 文件
- [ ] 显示正确的执行点数量
- [ ] 三种重放模式都能正常工作
- [ ] 单步模式可以看到每个执行点
- [ ] 断点模式可以在指定位置暂停

### ✅ analyze.py 正常运行的标志
- [ ] 成功解析 .rec 文件
- [ ] 显示统计信息
- [ ] 显示函数调用次数
- [ ] 显示非确定性数据
- [ ] --trace 参数显示执行轨迹

---

## 常见问题

### Q1: 执行点数量每次都一样吗？
**A**: 对于相同的代码，执行点数量应该是一样的。但如果代码中有条件分支或循环，数量可能会变化。

### Q2: 随机数和时间戳每次都不同吗？
**A**: 是的，这是正常的。录制时会记录实际的随机数和时间戳值，重放时会使用录制的值。

### Q3: 文件大小为什么不固定？
**A**: 文件大小取决于：
- 执行点数量
- 函数名长度
- 非确定性数据量

### Q4: 重放时能看到原始的随机数吗？
**A**: 可以！在单步重放模式下，当遇到有非确定性数据的执行点时，会显示录制时的值。

### Q5: 如何验证重放是否正确？
**A**:
1. 检查执行点数量是否匹配
2. 检查非确定性数据是否被正确恢复
3. 使用单步模式逐步验证

---

## 性能参考

### 录制性能
- **simple**: 约 0.1 秒
- **fibonacci**: 约 0.5 秒
- **开销**: 约 3-5x 慢于正常执行

### 重放性能
- **加载**: 几乎瞬间（< 0.1 秒）
- **完整重放**: 约 0.01 秒
- **单步重放**: 取决于用户操作速度

### 文件大小
- **每个执行点**: 约 100-200 字节
- **每个非确定性数据**: 约 20-50 字节
- **文件头**: 32 字节

---

## 下一步

如果所有示例都正常运行，你可以：

1. **修改示例代码**
   ```bash
   vim examples/fibonacci.cc
   # 修改 Fibonacci 的参数，试试 fibonacci(15)
   ./compile-examples.sh
   ./fibonacci
   ```

2. **创建自己的录制程序**
   - 参考 examples/ 中的代码
   - 添加自己的 JavaScript 代码
   - 编译并运行

3. **分析录制文件**
   ```bash
   python3 analyze.py your-recording.rec --trace
   ```

4. **调试和重放**
   ```bash
   ./replay your-recording.rec
   # 尝试不同的重放模式
   ```

---

**提示**: 如果输出与预期不符，请检查：
1. V8 是否编译成功
2. 补丁是否正确应用
3. 录制器源码是否正确复制
