// Demo 4: Mini task scheduler
console.log("=== Task Scheduler ===");
console.log("Started:", new Date().toISOString());
console.log();

// Task queue with priorities
const tasks = [];
function addTask(name, priority) {
  tasks.push({ name, priority, id: Math.random().toString(36).slice(2, 8) });
}

addTask("Send email report", 3);
addTask("Backup database", 5);
addTask("Clean temp files", 1);
addTask("Generate invoice", 4);
addTask("Sync user data", 2);
addTask("Update cache", 2);
addTask("Process payments", 5);
addTask("Archive logs", 1);

// Sort by priority (high first)
tasks.sort((a, b) => b.priority - a.priority);

console.log("[Task Queue]");
for (const t of tasks) {
  const bar = "■".repeat(t.priority) + "□".repeat(5 - t.priority);
  console.log(`  [${t.id}] ${bar} P${t.priority}  ${t.name}`);
}
console.log();

// Simulate execution with random durations
console.log("[Execution Log]");
let clock = Date.now();
for (const t of tasks) {
  const duration = Math.floor(Math.random() * 500) + 50;
  const success = Math.random() > 0.15;
  clock += duration;
  if (success) {
    console.log(`  ✓ ${t.name} (${duration}ms)`);
  } else {
    console.error(`  ✗ ${t.name} FAILED after ${duration}ms`);
  }
}
console.log();

// Stats
const completed = tasks.filter(() => Math.random() > 0.15).length;
console.log("[Summary]");
console.log(`  Total: ${tasks.length}`);
console.log(`  Success: ${completed}/${tasks.length}`);
console.log(`  Uptime: ${((Date.now() - clock + 5000) / 1000).toFixed(1)}s`);
console.log(`  Run ID: ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
console.log();
console.log("=== Scheduler Done ===");
