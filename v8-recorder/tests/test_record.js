// test_record.js — 测试录制/重放的 JS 脚本
// 包含多种非确定性源：时间、随机数、文件读取

const fs = require('fs');
const crypto = require('crypto');

console.log('=== V8 Recorder JS Test ===\n');

// 1. 时间
const t1 = Date.now();
const t2 = new Date().toISOString();
console.log(`Date.now(): ${t1}`);
console.log(`ISO time:   ${t2}`);

// 2. Math.random
const randoms = Array.from({length: 5}, () => Math.random());
console.log(`Math.random: [${randoms.map(r => r.toFixed(6)).join(', ')}]`);

// 3. crypto.randomBytes
const bytes = crypto.randomBytes(8);
console.log(`crypto.randomBytes: ${bytes.toString('hex')}`);

// 4. 文件读取
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  console.log(`package.json name: ${pkg.name || '(none)'}`);
} catch (e) {
  console.log(`No package.json found`);
}

// 5. process.hrtime
const hr = process.hrtime();
console.log(`hrtime: [${hr[0]}, ${hr[1]}]`);

// 6. 计算（确定性部分）
function fib(n) { return n <= 1 ? n : fib(n-1) + fib(n-2); }
console.log(`fib(20) = ${fib(20)}`);

// 7. 再取一次时间看 elapsed
const elapsed = Date.now() - t1;
console.log(`\nElapsed: ${elapsed}ms`);
console.log('\n=== Done ===');
