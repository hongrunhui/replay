"use strict";
// Open Replay — Local Replay Server
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
const ws_1 = require("ws");
const session_js_1 = require("./session.js");
const protocol_js_1 = require("./protocol.js");
async function startServer(options) {
    const { port, recordingPath } = options;
    const session = new session_js_1.ReplaySession(recordingPath);
    await session.start();
    const wss = new ws_1.WebSocketServer({ port });
    console.log(`[server] WebSocket: ws://localhost:${port}`);
    console.log(`[server] Recording: ${recordingPath}`);
    console.log(`[server] Session: ${session.id}`);
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
    // Handle shutdown
    process.on('SIGINT', () => {
        console.log('\n[server] Shutting down...');
        session.destroy().finally(() => { wss.close(); process.exit(0); });
    });
    return wss;
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
//# sourceMappingURL=index.js.map