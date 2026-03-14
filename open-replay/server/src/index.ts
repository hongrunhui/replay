// Open Replay — Local Replay Server
// Serves WebSocket (CDP protocol) + DevTools UI (HTTP)

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { ReplaySession } from './session.js';
import { CDPProtocolHandler } from './protocol.js';

interface ServerOptions {
  port: number;
  recordingPath: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

export async function startServer(options: ServerOptions) {
  const { port, recordingPath } = options;

  const session = new ReplaySession(recordingPath);
  await session.start();

  // DevTools UI static files directory
  const devtoolsDir = resolve(__dirname, '../../devtools/dist');
  const hasDevtools = existsSync(join(devtoolsDir, 'index.html'));

  // HTTP server for DevTools UI
  const httpServer = createServer((req, res) => {
    if (!hasDevtools) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="background:#1e1e1e;color:#d4d4d4;font-family:monospace;padding:40px">
        <h2>Open Replay Server</h2>
        <p>WebSocket: ws://localhost:${port}</p>
        <p>DevTools UI not built. Run: <code>cd devtools && npm run build</code></p>
      </body></html>`);
      return;
    }

    let filePath = req.url === '/' ? '/index.html' : req.url || '/index.html';
    const fullPath = join(devtoolsDir, filePath);

    // Security: prevent path traversal
    if (!fullPath.startsWith(devtoolsDir)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    if (!existsSync(fullPath)) {
      // SPA fallback
      const indexPath = join(devtoolsDir, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(indexPath));
      return;
    }

    const ext = extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(readFileSync(fullPath));
  });

  // WebSocket server attached to HTTP server
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[server] Client connected');
    const handler = new CDPProtocolHandler(session);

    ws.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString());
      console.log(`[server] <- ${message.method}`);
      handler.handleMessage(message).then((response) => {
        ws.send(JSON.stringify(response));
      }).catch((err) => {
        console.error('[server] Error:', err);
      });
    });

    ws.on('close', () => {
      console.log('[server] Client disconnected');
    });
  });

  httpServer.listen(port, () => {
    console.log(`[server] DevTools UI: http://localhost:${port}`);
    console.log(`[server] WebSocket:   ws://localhost:${port}`);
    console.log(`[server] Recording:   ${recordingPath}`);
    console.log(`[server] Session:     ${session.id}`);
    if (!hasDevtools) {
      console.log(`[server] DevTools UI not built — cd devtools && npm run build`);
    }
  });

  process.on('SIGINT', () => {
    console.log('\n[server] Shutting down...');
    session.destroy().finally(() => { httpServer.close(); process.exit(0); });
  });

  return httpServer;
}

// CLI entry point
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const recording = process.argv[2];
  const port = parseInt(process.argv[3] || '1234', 10);

  if (!recording) {
    console.error('Usage: tsx src/index.ts <recording-path> [port]');
    process.exit(1);
  }

  startServer({ port, recordingPath: recording });
}
