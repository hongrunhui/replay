"use strict";
// Open Replay — Replay Engine
//
// Spawns the patched Node.js in replay mode, connects to its inspector
// via WebSocket (CDP), and controls execution via the progress counter.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplayEngine = void 0;
exports.parseRecordingHeader = parseRecordingHeader;
const node_child_process_1 = require("node:child_process");
const node_events_1 = require("node:events");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const node_http_1 = __importDefault(require("node:http"));
const ws_1 = __importDefault(require("ws"));
class ReplayEngine extends node_events_1.EventEmitter {
    opts;
    child = null;
    ws = null;
    nextMsgId = 1;
    pendingRequests = new Map();
    cdpEventHandlers = new Map();
    inspectorPort = 9229;
    currentPause = null;
    scriptUrls = new Map(); // scriptId -> url
    constructor(opts) {
        super();
        this.opts = opts;
    }
    getNodePath() {
        // If user explicitly set a node path, use it.
        if (this.opts.nodePath)
            return this.opts.nodePath;
        // Default to the same Node.js that's running the server.
        // (Patched node has different module resolution patterns which
        //  causes event stream mismatch when recording was done with
        //  a different Node.js version.)
        return process.execPath;
    }
    getDriverPath() {
        if (this.opts.driverPath)
            return this.opts.driverPath;
        const buildBase = (0, node_path_1.resolve)(__dirname, '../../driver/build');
        const dylib = process.platform === 'darwin'
            ? 'libopenreplay.dylib' : 'libopenreplay.so';
        return (0, node_path_1.join)(buildBase, dylib);
    }
    // Build the env/args common to start() and run()
    buildSpawnConfig() {
        const nodePath = this.getNodePath();
        const driverPath = this.getDriverPath();
        if (!(0, node_fs_1.existsSync)(this.opts.recordingPath)) {
            throw new Error(`Recording not found: ${this.opts.recordingPath}`);
        }
        if (!(0, node_fs_1.existsSync)(driverPath)) {
            throw new Error(`Driver not found: ${driverPath}`);
        }
        const env = {
            ...process.env,
            OPENREPLAY_MODE: 'replay',
            REPLAY_RECORDING: this.opts.recordingPath,
        };
        if (process.platform === 'darwin') {
            env.DYLD_INSERT_LIBRARIES = driverPath;
        }
        else {
            env.LD_PRELOAD = driverPath;
        }
        const header = parseRecordingHeader(this.opts.recordingPath);
        const scriptPath = this.opts.scriptPath || header.scriptPath;
        return { nodePath, env, scriptPath };
    }
    // Run replay without debugger — just execute and capture output.
    async run() {
        const { nodePath, env, scriptPath } = this.buildSpawnConfig();
        if (!scriptPath)
            throw new Error('No script path in recording metadata');
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            const proc = (0, node_child_process_1.spawn)(nodePath, [scriptPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });
            proc.stdout?.on('data', (d) => { stdout += d.toString(); this.emit('stdout', d.toString()); });
            proc.stderr?.on('data', (d) => { stderr += d.toString(); this.emit('stderr', d.toString()); });
            proc.on('exit', (code) => {
                this.emit('exit', code ?? 0);
                resolve({ exitCode: code ?? 0, stdout, stderr });
            });
            this.child = proc;
        });
    }
    // Start replay with debugger attached (for stepping/breakpoints).
    async start() {
        const { nodePath, env, scriptPath } = this.buildSpawnConfig();
        this.inspectorPort = 9200 + Math.floor(Math.random() * 800);
        const nodeArgs = scriptPath
            ? [`--inspect-brk=${this.inspectorPort}`, scriptPath]
            : [`--inspect-brk=${this.inspectorPort}`, '-e', 'void 0'];
        this.child = (0, node_child_process_1.spawn)(nodePath, nodeArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });
        this.child.stderr?.on('data', (data) => {
            this.emit('stderr', data.toString());
        });
        this.child.stdout?.on('data', (data) => {
            this.emit('stdout', data.toString());
        });
        this.child.on('exit', (code) => {
            this.emit('exit', code ?? 0);
        });
        await this.waitForInspector();
        // Register event handlers BEFORE enabling domains, so we don't miss
        // scriptParsed/paused events that are emitted synchronously on enable.
        // Track script IDs
        this.onCDPEvent('Debugger.scriptParsed', (params) => {
            if (params?.url)
                this.scriptUrls.set(params.scriptId, params.url);
        });
        // Track pause state
        this.onCDPEvent('Debugger.paused', (params) => {
            this.currentPause = { frames: params?.callFrames || [] };
            this.emit('paused', this.currentPause);
        });
        this.onCDPEvent('Debugger.resumed', () => {
            this.currentPause = null;
            this.emit('resumed');
        });
        // Enable CDP domains — scriptParsed/paused may fire immediately.
        await this.sendCDP('Runtime.enable');
        await this.sendCDP('Debugger.enable');
        await this.sendCDP('Console.enable');
        // Wait for Debugger.paused before returning. Node.js v22 requires
        // Runtime.runIfWaitingForDebugger to release the --inspect-brk hold,
        // then fires Debugger.paused with reason "Break on start".
        const pausePromise = new Promise((resolve) => {
            if (this.currentPause) {
                resolve();
                return;
            }
            const handler = () => resolve();
            this.once('paused', handler);
            setTimeout(() => { this.off('paused', handler); resolve(); }, 3000);
        });
        await this.sendCDP('Runtime.runIfWaitingForDebugger');
        await pausePromise;
    }
    async waitForInspector() {
        // Wait until Node.js prints "Debugger listening on ws://..."
        await new Promise((resolve) => {
            const onStderr = (msg) => {
                if (msg.includes('Debugger listening') || msg.includes('ws://127')) {
                    this.off('stderr', onStderr);
                    resolve();
                }
            };
            this.on('stderr', onStderr);
            setTimeout(resolve, 4000); // fallback
        });
        // Connect WebSocket to inspector
        for (let i = 0; i < 50; i++) {
            try {
                await this.connectWS();
                return;
            }
            catch {
                await new Promise(r => setTimeout(r, 100));
            }
        }
        throw new Error(`Could not connect to inspector on port ${this.inspectorPort}`);
    }
    connectWS() {
        return new Promise((resolve, reject) => {
            // Fetch ws URL from /json endpoint
            const req = node_http_1.default.get(`http://127.0.0.1:${this.inspectorPort}/json`, (res) => {
                let body = '';
                res.on('data', (d) => { body += d.toString(); });
                res.on('end', () => {
                    try {
                        const targets = JSON.parse(body);
                        const wsUrl = targets[0]?.webSocketDebuggerUrl;
                        if (!wsUrl)
                            return reject(new Error('No webSocketDebuggerUrl in /json'));
                        this.ws = new ws_1.default(wsUrl);
                        this.ws.once('open', () => resolve());
                        this.ws.once('error', reject);
                        this.ws.on('message', (data) => {
                            this.handleWsMessage(JSON.parse(data.toString()));
                        });
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
        });
    }
    handleWsMessage(msg) {
        if (msg.id !== undefined) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
                this.pendingRequests.delete(msg.id);
                if (msg.error)
                    pending.reject(new Error(msg.error.message));
                else
                    pending.resolve(msg.result);
            }
        }
        else if (msg.method) {
            const handlers = this.cdpEventHandlers.get(msg.method);
            if (handlers)
                for (const h of handlers)
                    h(msg.params);
        }
    }
    async sendCDP(method, params) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            throw new Error('Inspector WebSocket not open');
        }
        const id = this.nextMsgId++;
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params: params || {} }));
        });
    }
    onCDPEvent(method, handler) {
        if (!this.cdpEventHandlers.has(method)) {
            this.cdpEventHandlers.set(method, []);
        }
        this.cdpEventHandlers.get(method).push(handler);
    }
    isPaused() { return this.currentPause !== null; }
    getPauseState() { return this.currentPause; }
    async resume() {
        await this.sendCDP('Debugger.resume');
    }
    async stepOver() {
        await this.sendCDP('Debugger.stepOver');
    }
    async stepInto() {
        await this.sendCDP('Debugger.stepInto');
    }
    async evaluate(expression, callFrameId) {
        if (callFrameId) {
            const r = await this.sendCDP('Debugger.evaluateOnCallFrame', {
                callFrameId,
                expression,
                returnByValue: true,
                generatePreview: true,
            });
            return r?.result;
        }
        const r = await this.sendCDP('Runtime.evaluate', {
            expression,
            returnByValue: true,
        });
        return r?.result;
    }
    async getProperties(objectId) {
        const r = await this.sendCDP('Runtime.getProperties', {
            objectId,
            ownProperties: true,
        });
        return r?.result || [];
    }
    async runToCompletion() {
        await this.resume();
        return new Promise((resolve) => this.once('exit', resolve));
    }
    getRecordingInfo() {
        const buf = (0, node_fs_1.readFileSync)(this.opts.recordingPath);
        return {
            path: this.opts.recordingPath,
            size: buf.length,
            header: parseRecordingHeader(this.opts.recordingPath),
        };
    }
    async stop() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.child) {
            this.child.kill();
            this.child = null;
        }
        this.pendingRequests.clear();
    }
}
exports.ReplayEngine = ReplayEngine;
// Parse recording file header and metadata
function parseRecordingHeader(path) {
    const buf = (0, node_fs_1.readFileSync)(path);
    if (buf.length < 64)
        throw new Error('Recording file too small');
    const header = {
        magic: buf.subarray(0, 8).toString('ascii'),
        version: buf.readUInt32LE(8),
        timestamp: Number(buf.readBigUInt64LE(16)),
        buildId: buf.subarray(24, 56).toString('ascii').replace(/\0+$/, ''),
        scriptPath: undefined,
    };
    // Scan event stream for METADATA events (type=0x20)
    let i = 64;
    const tailSize = 32;
    while (i + 9 <= buf.length - tailSize) {
        const type = buf[i];
        const dataLen = buf.readUInt32LE(i + 5);
        if (type === 0x20) {
            try {
                const json = JSON.parse(buf.subarray(i + 9, i + 9 + dataLen).toString('utf8'));
                if (json.scriptPath)
                    header.scriptPath = json.scriptPath;
            }
            catch { /* ignore malformed metadata */ }
        }
        i += 9 + dataLen;
    }
    return header;
}
//# sourceMappingURL=replay-engine.js.map