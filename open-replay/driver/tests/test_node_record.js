// Test script for recording — exercises non-deterministic operations
// Run with: OPENREPLAY_MODE=record DYLD_INSERT_LIBRARIES=<driver> node test_node_record.js

console.log('=== Open Replay Node.js Integration Test ===');
console.log('');

// 1. Time APIs
console.log('--- Time ---');
console.log('Date.now():', Date.now());
console.log('new Date():', new Date().toISOString());
console.log('process.hrtime():', process.hrtime());

// 2. Random
console.log('');
console.log('--- Random ---');
for (let i = 0; i < 5; i++) {
  console.log(`Math.random() #${i}:`, Math.random());
}

// 3. Crypto random
const crypto = require('crypto');
console.log('');
console.log('--- Crypto ---');
console.log('randomBytes(8):', crypto.randomBytes(8).toString('hex'));
console.log('randomUUID():', crypto.randomUUID());

// 4. File I/O
const fs = require('fs');
const path = require('path');
console.log('');
console.log('--- File I/O ---');
const thisFile = fs.readFileSync(__filename, 'utf8');
console.log('Read self:', thisFile.length, 'bytes');
console.log('__filename:', __filename);
console.log('cwd:', process.cwd());

// 5. Environment
console.log('');
console.log('--- Environment ---');
console.log('NODE_VERSION:', process.version);
console.log('PLATFORM:', process.platform);
console.log('ARCH:', process.arch);

// 6. Async operation
console.log('');
console.log('--- Async ---');
setTimeout(() => {
  console.log('setTimeout fired at:', Date.now());
  console.log('');
  console.log('=== Test Complete ===');
}, 100);
