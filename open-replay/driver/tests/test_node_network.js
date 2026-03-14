// Test script for network recording — exercises HTTP requests
// Run with: OPENREPLAY_MODE=record DYLD_INSERT_LIBRARIES=<driver> node test_node_network.js

const http = require('http');

console.log('=== Network Test ===');
console.log('Date.now():', Date.now());
console.log('Math.random():', Math.random());

// Simple HTTP GET to a public API
const url = 'http://httpbin.org/get?test=openreplay';
console.log(`\nFetching: ${url}`);

http.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response length:', data.length);
    // Parse and show a subset
    try {
      const json = JSON.parse(data);
      console.log('Origin:', json.origin);
      console.log('URL:', json.url);
    } catch (e) {
      console.log('Response (first 200):', data.slice(0, 200));
    }
    console.log('\n=== Test Complete ===');
  });
}).on('error', (err) => {
  // If no internet, use a local fallback
  console.log('HTTP error (expected if offline):', err.message);
  console.log('Testing with local data instead...');
  console.log('Fake response: {"status": "ok", "random":', Math.random(), '}');
  console.log('\n=== Test Complete ===');
});
