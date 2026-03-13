// Demo 2: A mini lottery simulator
console.log("=== Lottery Simulator ===");
console.log("Draw time:", new Date().toISOString());
console.log();

// Pick N unique numbers from 1..max
function draw(n, max) {
  const pool = Array.from({ length: max }, (_, i) => i + 1);
  const picks = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks.sort((a, b) => a - b);
}

// Simulate 3 rounds of 6/45 lottery
for (let round = 1; round <= 3; round++) {
  const nums = draw(6, 45);
  const bonus = Math.floor(Math.random() * 45) + 1;
  console.log(`Round ${round}: [${nums.join(", ")}] + bonus ${bonus}`);
}
console.log();

// Coin flip experiment
let heads = 0, tails = 0;
for (let i = 0; i < 100; i++) {
  if (Math.random() < 0.5) heads++; else tails++;
}
console.log(`Coin flips: ${heads} heads, ${tails} tails`);

// Password generator
function genPassword(len) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
  let pw = "";
  for (let i = 0; i < len; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}
console.log();
console.log("Passwords:");
console.log("  8-char:", genPassword(8));
console.log("  16-char:", genPassword(16));
console.log("  32-char:", genPassword(32));

// Elapsed
console.log();
console.log("Generated at:", Date.now());
console.log("=== Done ===");
