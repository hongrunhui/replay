// Realistic Express-like app test
// Tests: HTTP server + client request + JSON handling + async + file I/O

const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

// Simulate a simple API server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);

  if (url.pathname === '/api/user') {
    const user = {
      id: crypto.randomUUID(),
      name: 'Alice',
      token: crypto.randomBytes(8).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(user));
  } else if (url.pathname === '/api/random') {
    const data = {
      values: Array.from({ length: 5 }, () => Math.random()),
      timestamp: Date.now(),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// Start server on random port
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log('Server started on port', port);

  // Make requests to our own server
  Promise.all([
    fetchJSON(`http://127.0.0.1:${port}/api/user`),
    fetchJSON(`http://127.0.0.1:${port}/api/random`),
    fetchJSON(`http://127.0.0.1:${port}/api/random`),
  ]).then(([user, rand1, rand2]) => {
    console.log('\n=== Results ===');
    console.log('User ID:', user.id);
    console.log('User token:', user.token);
    console.log('User created:', user.createdAt);
    console.log('Random values 1:', rand1.values.map(v => v.toFixed(4)).join(', '));
    console.log('Random values 2:', rand2.values.map(v => v.toFixed(4)).join(', '));
    console.log('Timestamps:', rand1.timestamp, rand2.timestamp);

    // File operations
    const logData = JSON.stringify({ user, rand1, rand2 }, null, 2);
    fs.writeFileSync('/tmp/openreplay_express_test.json', logData);
    const readBack = fs.readFileSync('/tmp/openreplay_express_test.json', 'utf8');
    console.log('\nFile write+read:', readBack.length, 'bytes');

    // Async chain
    setTimeout(() => {
      console.log('Delayed check at:', Date.now());
      console.log('Math.random after delay:', Math.random().toFixed(6));

      server.close(() => {
        console.log('\n=== Done ===');
      });
    }, 100);
  }).catch(err => {
    console.error('Error:', err.message);
    server.close();
  });
});

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${data.slice(0, 100)}`)); }
      });
    }).on('error', reject);
  });
}
