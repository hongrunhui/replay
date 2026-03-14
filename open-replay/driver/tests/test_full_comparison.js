// Comprehensive test: exercises all non-deterministic APIs
// Used to compare Open Replay vs Replay.io capabilities

console.log('=== 1. Time ===');
const t1 = Date.now();
const t2 = new Date().toISOString();
const t3 = process.hrtime.bigint();
console.log('Date.now():', t1);
console.log('new Date():', t2);
console.log('hrtime:', t3.toString());

console.log('\n=== 2. Math.random ===');
for (let i = 0; i < 3; i++) console.log(`  #${i}:`, Math.random());

console.log('\n=== 3. Crypto ===');
const crypto = require('crypto');
console.log('randomBytes:', crypto.randomBytes(16).toString('hex'));
console.log('randomUUID:', crypto.randomUUID());
console.log('randomInt:', crypto.randomInt(1000));

console.log('\n=== 4. File I/O ===');
const fs = require('fs');
const content = fs.readFileSync(__filename, 'utf8');
console.log('Self read:', content.length, 'bytes');
try {
  fs.writeFileSync('/tmp/openreplay_test_output.txt', 'hello ' + Date.now());
  console.log('Write: OK');
} catch (e) { console.log('Write:', e.message); }

console.log('\n=== 5. Network (HTTP) ===');
const http = require('http');
const url = 'http://httpbin.org/get?q=openreplay';

const done = new Promise((resolve) => {
  http.get(url, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      console.log('Body length:', data.length);
      try {
        const j = JSON.parse(data);
        console.log('Origin:', j.origin);
      } catch { console.log('Body:', data.slice(0, 100)); }
      resolve();
    });
  }).on('error', e => {
    console.log('Error:', e.message);
    resolve();
  });
});

done.then(() => {
  console.log('\n=== 6. Async ===');
  const start = Date.now();
  setTimeout(() => {
    console.log('setTimeout delta:', Date.now() - start, 'ms');

    console.log('\n=== 7. Process ===');
    console.log('pid:', process.pid);
    console.log('ppid:', process.ppid);
    console.log('argv0:', process.argv[0]);
    console.log('version:', process.version);
    console.log('cwd:', process.cwd());

    console.log('\n=== DONE ===');
  }, 50);
});
