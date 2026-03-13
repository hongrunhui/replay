// Demo 3: Weather station simulator
console.log("=== Weather Station ===");
console.log("Report time:", new Date().toISOString());
console.log();

// Temperature readings over "24 hours"
console.log("[Temperature]");
let temps = [];
let base = 18 + Math.random() * 8; // base temp 18-26°C
for (let h = 0; h < 24; h++) {
  const variation = Math.sin((h - 6) * Math.PI / 12) * 6 + (Math.random() - 0.5) * 2;
  const temp = (base + variation).toFixed(1);
  temps.push(Number(temp));
  if (h % 6 === 0) console.log(`  ${String(h).padStart(2, '0')}:00  ${temp}°C`);
}
const avg = (temps.reduce((a, b) => a + b) / temps.length).toFixed(1);
const min = Math.min(...temps).toFixed(1);
const max = Math.max(...temps).toFixed(1);
console.log(`  Avg: ${avg}°C  Min: ${min}°C  Max: ${max}°C`);
console.log();

// Wind speed & direction
console.log("[Wind]");
const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
for (let i = 0; i < 5; i++) {
  const speed = (Math.random() * 30).toFixed(1);
  const dir = dirs[Math.floor(Math.random() * dirs.length)];
  console.log(`  Reading ${i + 1}: ${speed} km/h ${dir}`);
}
console.log();

// Humidity
console.log("[Humidity]");
const humidity = (40 + Math.random() * 50).toFixed(0);
console.log(`  Current: ${humidity}%`);
console.log(`  Dew point: ${(Number(humidity) * 0.3 + 2).toFixed(1)}°C`);
console.log();

// Rain probability forecast
console.log("[Forecast]");
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const today = new Date().getDay();
for (let i = 0; i < 7; i++) {
  const dayIdx = (today + i) % 7;
  const rain = Math.floor(Math.random() * 100);
  const bar = "█".repeat(Math.floor(rain / 10)) + "░".repeat(10 - Math.floor(rain / 10));
  console.log(`  ${days[dayIdx]}  ${bar} ${rain}%`);
}
console.log();

// Alert check
const alertLevel = Math.random();
if (alertLevel > 0.7) {
  console.error("[ALERT] High wind warning!");
} else if (alertLevel > 0.4) {
  console.error("[NOTICE] UV index elevated");
}

console.log("Station ID:", Math.random().toString(36).slice(2, 10).toUpperCase());
console.log("=== End Report ===");
