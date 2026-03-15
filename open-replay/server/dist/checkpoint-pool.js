"use strict";
// Checkpoint Pool — maintains pre-warmed replay processes at different execution points
// for fast backward jumps. Instead of fork() (which corrupts kqueue on macOS),
// we spawn multiple replay processes, each paused at a different line.
//
// Architecture:
//   1. On first runToLine, run the script to completion to collect all line positions
//   2. Spawn N checkpoint processes, each paused at evenly-spaced lines
//   3. When user jumps backward, find the nearest checkpoint process
//   4. Resume it to the target line (short forward replay instead of full restart)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckpointPool = void 0;
const node_child_process_1 = require("node:child_process");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const node_http_1 = __importDefault(require("node:http"));
const ws_1 = __importDefault(require("ws"));
const replay_engine_js_1 = require("./replay-engine.js");
class CheckpointPool {
    checkpoints = [];
    recordingPath;
    maxCheckpoints;
    constructor(recordingPath, maxCheckpoints = 5) {
        this.recordingPath = recordingPath;
        this.maxCheckpoints = maxCheckpoints;
    }
    get size() { return this.checkpoints.length; }
    // Find the nearest checkpoint at or before the target line
    findNearest(targetLine) {
        let best = null;
        for (const cp of this.checkpoints) {
            if (cp.line <= targetLine) {
                if (!best || cp.line > best.line)
                    best = cp;
            }
        }
        return best;
    }
    // Pre-warm checkpoints at evenly-spaced lines
    async warmUp(totalLines, scriptFile) {
        if (totalLines <= 0 || this.checkpoints.length > 0)
            return;
        const interval = Math.max(1, Math.floor(totalLines / (this.maxCheckpoints + 1)));
        const lines = [];
        for (let i = interval; i < totalLines; i += interval) {
            if (lines.length >= this.maxCheckpoints)
                break;
            lines.push(i);
        }
        // Spawn checkpoint processes in parallel
        const header = (0, replay_engine_js_1.parseRecordingHeader)(this.recordingPath);
        const nodePath = this.getNodePath();
        const driverPath = this.getDriverPath();
        await Promise.all(lines.map(line => this.spawnCheckpoint(line, scriptFile, nodePath, driverPath, header.randomSeed)
            .catch(() => { }) // ignore failures
        ));
        process.stderr.write(`[checkpoint-pool] ${this.checkpoints.length} checkpoints created\n`);
    }
    async spawnCheckpoint(line, scriptFile, nodePath, driverPath, randomSeed) {
        const port = 9200 + Math.floor(Math.random() * 800);
        const env = {
            ...process.env,
            OPENREPLAY_MODE: 'replay',
            REPLAY_RECORDING: this.recordingPath,
        };
        if (process.platform === 'darwin') {
            env.DYLD_INSERT_LIBRARIES = driverPath;
        }
        const args = [`--inspect-brk=${port}`];
        if (randomSeed)
            args.push(`--random-seed=${randomSeed}`);
        args.push(scriptFile);
        const child = (0, node_child_process_1.spawn)(nodePath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
        // Wait for inspector
        await new Promise((resolve) => {
            child.stderr?.on('data', (d) => {
                if (d.toString().includes('Debugger listening'))
                    resolve();
            });
            setTimeout(resolve, 8000);
        });
        // Connect and run to the target line
        const wsUrl = await this.getWsUrl(port);
        if (!wsUrl) {
            child.kill();
            return;
        }
        const ws = new ws_1.default(wsUrl);
        await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); setTimeout(j, 5000); }).catch(() => { });
        let msgId = 1;
        const pending = new Map();
        ws.on('message', (d) => {
            const msg = JSON.parse(d.toString());
            if (msg.id) {
                const p = pending.get(msg.id);
                if (p) {
                    pending.delete(msg.id);
                    p(msg.result);
                }
            }
            if (msg.method === 'Debugger.paused' && msg.params?.reason === 'Break on start') {
                // Resume "Break on start" pauses
                ws.send(JSON.stringify({ id: msgId++, method: 'Debugger.resume', params: {} }));
            }
        });
        const cdp = (method, params = {}) => {
            const id = msgId++;
            return new Promise(r => {
                pending.set(id, r);
                ws.send(JSON.stringify({ id, method, params }));
                setTimeout(() => { pending.delete(id); r(null); }, 10000);
            });
        };
        await cdp('Debugger.enable');
        await cdp('Runtime.enable');
        // Set breakpoint at target line
        const filename = scriptFile.split('/').pop() || scriptFile;
        await cdp('Debugger.setBreakpointByUrl', {
            urlRegex: `.*${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`,
            lineNumber: line,
        });
        await cdp('Runtime.runIfWaitingForDebugger');
        // Wait for breakpoint hit
        await new Promise((resolve) => {
            ws.on('message', (d) => {
                const msg = JSON.parse(d.toString());
                if (msg.method === 'Debugger.paused' && msg.params?.reason !== 'Break on start') {
                    resolve();
                }
            });
            setTimeout(resolve, 10000);
        });
        this.checkpoints.push({ pid: child.pid, port, line, child, ws });
    }
    getNodePath() {
        const patched = (0, node_path_1.resolve)(__dirname, '../../node/out/Release/node');
        return (0, node_fs_1.existsSync)(patched) ? patched : process.execPath;
    }
    getDriverPath() {
        const base = (0, node_path_1.resolve)(__dirname, '../../driver/build');
        return process.platform === 'darwin'
            ? (0, node_path_1.resolve)(base, 'libopenreplay.dylib')
            : (0, node_path_1.resolve)(base, 'libopenreplay.so');
    }
    getWsUrl(port) {
        return new Promise((resolve) => {
            node_http_1.default.get(`http://127.0.0.1:${port}/json`, (res) => {
                let body = '';
                res.on('data', (d) => body += d.toString());
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body)[0]?.webSocketDebuggerUrl);
                    }
                    catch {
                        resolve(null);
                    }
                });
            }).on('error', () => resolve(null));
            setTimeout(() => resolve(null), 5000);
        });
    }
    // Clean up all checkpoint processes
    destroy() {
        for (const cp of this.checkpoints) {
            cp.ws?.close();
            cp.child.kill();
        }
        this.checkpoints = [];
    }
}
exports.CheckpointPool = CheckpointPool;
//# sourceMappingURL=checkpoint-pool.js.map