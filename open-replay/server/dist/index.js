"use strict";
// Open Replay — Local Replay Server
// Serves WebSocket (CDP protocol) + DevTools UI (HTTP)
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
const node_http_1 = require("node:http");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const ws_1 = require("ws");
const session_js_1 = require("./session.js");
const protocol_js_1 = require("./protocol.js");
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
};
async function startServer(options) {
    const { port, recordingPath } = options;
    const session = new session_js_1.ReplaySession(recordingPath);
    await session.start();
    // DevTools UI static files directory
    const devtoolsDir = (0, node_path_1.resolve)(__dirname, '../../devtools/dist');
    const hasDevtools = (0, node_fs_1.existsSync)((0, node_path_1.join)(devtoolsDir, 'index.html'));
    // HTTP server for DevTools UI
    const httpServer = (0, node_http_1.createServer)((req, res) => {
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
        const fullPath = (0, node_path_1.join)(devtoolsDir, filePath);
        // Security: prevent path traversal
        if (!fullPath.startsWith(devtoolsDir)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        if (!(0, node_fs_1.existsSync)(fullPath)) {
            // SPA fallback
            const indexPath = (0, node_path_1.join)(devtoolsDir, 'index.html');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end((0, node_fs_1.readFileSync)(indexPath));
            return;
        }
        const ext = (0, node_path_1.extname)(fullPath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end((0, node_fs_1.readFileSync)(fullPath));
    });
    // WebSocket server with manual upgrade handling
    const wss = new ws_1.WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });
    wss.on('connection', (ws) => {
        console.log('[server] Client connected');
        const handler = new protocol_js_1.CDPProtocolHandler(session);
        ws.on('message', (data) => {
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
// CLI entry point — only runs when this file is the main entry
// Check via require.main === module (CommonJS) to detect direct execution
const isDirectRun = typeof require !== 'undefined' && require.main === module;
if (isDirectRun) {
    const recording = process.argv[2];
    const port = parseInt(process.argv[3] || '1234', 10);
    if (!recording) {
        console.error('Usage: node dist/index.js <recording-path> [port]');
        process.exit(1);
    }
    startServer({ port, recordingPath: recording });
}
//# sourceMappingURL=index.js.map