// Demo: non-deterministic operations that should be captured by recording
console.log("=== V8 Recorder Demo ===");
console.log();

// --- Time APIs ---
console.log("[Time]");
console.log("  Date.now():", Date.now());
console.log("  new Date():", new Date().toISOString());
console.log("  new Date().getTime():", new Date().getTime());
console.log("  Date string:", new Date().toLocaleString());
console.log();

// --- Random numbers ---
console.log("[Random]");
for (let i = 0; i < 5; i++) {
  console.log(`  Math.random() #${i + 1}:`, Math.random());
}
console.log();

// --- Simulated UUID v4 ---
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
console.log("[UUID]");
console.log("  id1:", uuidv4());
console.log("  id2:", uuidv4());
console.log();

// --- Dice roller ---
function rollDice(n, sides) {
  const rolls = [];
  for (let i = 0; i < n; i++) rolls.push(Math.floor(Math.random() * sides) + 1);
  return rolls;
}
console.log("[Dice]");
console.log("  3d6:", rollDice(3, 6).join(", "));
console.log("  2d20:", rollDice(2, 20).join(", "));
console.log();

// --- Shuffle ---
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
console.log("[Shuffle]");
console.log("  cards:", shuffle(["A", "K", "Q", "J", "10"]).join(" "));
console.log("  nums:", shuffle([1, 2, 3, 4, 5, 6, 7, 8]).join(" "));
console.log();

// --- Timing measurement ---
console.log("[Timing]");
const t0 = Date.now();
let sum = 0;
for (let i = 0; i < 1e6; i++) sum += i;
const t1 = Date.now();
console.log(`  Sum of 0..999999 = ${sum} (took ${t1 - t0}ms)`);
console.log();

// --- Random color palette ---
function randomColor() {
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}
console.log("[Colors]");
const palette = Array.from({ length: 5 }, randomColor);
console.log("  palette:", palette.join(", "));
console.log();

// --- Timestamp-based ID ---
function tsId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
console.log("[IDs]");
console.log("  tsId1:", tsId());
console.log("  tsId2:", tsId());
console.log();

console.log("=== Done ===");
