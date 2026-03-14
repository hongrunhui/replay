// Complex async app: Promise chains, error handling, streams, timers
const crypto = require('crypto');
const { Readable } = require('stream');

async function main() {
  console.log('=== Start ===');
  console.log('Time:', Date.now());

  // 1. Promise.all with mixed results
  const results = await Promise.all([
    generateId('user'),
    generateId('session'),
    generateId('request'),
    delay(50).then(() => ({ delayed: true, time: Date.now() })),
  ]);
  console.log('\nIDs:', results.slice(0, 3).map(r => r.id).join(', '));
  console.log('Delayed result time:', results[3].time);

  // 2. Error handling
  try {
    await riskyOperation(0.3);
    console.log('Risky: succeeded');
  } catch (e) {
    console.log('Risky: caught', e.message);
  }

  // 3. Stream processing
  const streamResult = await processStream([10, 20, 30, 40, 50]);
  console.log('Stream sum:', streamResult);

  // 4. Recursive async with random branching
  const tree = await buildRandomTree(3);
  console.log('Tree:', JSON.stringify(tree));

  // 5. Multiple timers
  const t1 = await timerRace(30, 60);
  console.log('Timer race winner:', t1);

  console.log('\nFinal time:', Date.now());
  console.log('Final random:', Math.random().toFixed(8));
  console.log('=== End ===');
}

async function generateId(prefix) {
  const bytes = crypto.randomBytes(6).toString('hex');
  return { id: `${prefix}-${bytes}`, created: Date.now() };
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function riskyOperation(threshold) {
  const val = Math.random();
  if (val < threshold) throw new Error(`failed (${val.toFixed(4)} < ${threshold})`);
  return val;
}

function processStream(numbers) {
  return new Promise((resolve) => {
    let sum = 0;
    const stream = new Readable({
      objectMode: true,
      read() {
        const n = numbers.shift();
        if (n !== undefined) this.push(n);
        else this.push(null);
      }
    });
    stream.on('data', (n) => { sum += n * Math.random(); });
    stream.on('end', () => resolve(Math.round(sum * 100) / 100));
  });
}

async function buildRandomTree(depth) {
  if (depth <= 0) return { leaf: Math.random().toFixed(4) };
  const branches = Math.random() > 0.5 ? 2 : 1;
  const children = [];
  for (let i = 0; i < branches; i++) {
    children.push(await buildRandomTree(depth - 1));
  }
  return { depth, children };
}

function timerRace(ms1, ms2) {
  return Promise.race([
    delay(ms1).then(() => `timer-${ms1}ms`),
    delay(ms2).then(() => `timer-${ms2}ms`),
  ]);
}

main().catch(console.error);
