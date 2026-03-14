"use strict";
// Open Replay — Replay Session
//
// Manages a single replay session: starts the ReplayEngine, tracks state,
// and provides the data layer for the protocol handler.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplaySession = void 0;
exports.listRecordings = listRecordings;
const replay_engine_js_1 = require("./replay-engine.js");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
class ReplaySession {
    _recordingPath;
    _sessionId;
    _engine = null;
    _consoleMessages = [];
    _started = false;
    _header = null;
    constructor(recordingPath) {
        // Resolve recording path — could be UUID or full path
        if (!recordingPath.includes('/') && !recordingPath.startsWith('.')) {
            const dir = (0, node_path_1.join)((0, node_os_1.homedir)(), '.openreplay', 'recordings');
            const withExt = recordingPath.endsWith('.orec')
                ? recordingPath : `${recordingPath}.orec`;
            const candidate = (0, node_path_1.join)(dir, withExt);
            this._recordingPath = (0, node_fs_1.existsSync)(candidate) ? candidate : recordingPath;
        }
        else {
            this._recordingPath = recordingPath;
        }
        this._sessionId = globalThis.crypto?.randomUUID?.() ||
            `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
            this._header = (0, replay_engine_js_1.parseRecordingHeader)(this._recordingPath);
        }
        catch { /* will fail properly in start() */ }
    }
    get id() { return this._sessionId; }
    get recordingPath() { return this._recordingPath; }
    get engine() { return this._engine; }
    async start() {
        if (this._started)
            return;
        this._started = true;
        if (!(0, node_fs_1.existsSync)(this._recordingPath)) {
            throw new Error(`Recording not found: ${this._recordingPath}`);
        }
        this._header = (0, replay_engine_js_1.parseRecordingHeader)(this._recordingPath);
        console.log(`[session] Recording: ${this._header.magic} v${this._header.version}`);
        console.log(`[session] Timestamp: ${new Date(this._header.timestamp).toISOString()}`);
        console.log(`[session] Build: ${this._header.buildId || '(none)'}`);
        console.log(`[session] ID: ${this._sessionId}`);
    }
    // Start the replay engine (spawns Node.js process + connects inspector)
    async startEngine() {
        if (this._engine)
            return;
        this._engine = new replay_engine_js_1.ReplayEngine({ recordingPath: this._recordingPath });
        this._engine.on('stderr', (msg) => {
            // Always log child stderr for debugging (filter out openreplay noise)
            if (!msg.startsWith('[openreplay]')) {
                process.stderr.write(`[engine stderr] ${msg}`);
            }
            for (const line of msg.split('\n')) {
                if (line.trim()) {
                    this._consoleMessages.push({ level: 'log', text: line.trim(), timestamp: Date.now() });
                }
            }
        });
        this._engine.on('stdout', (msg) => {
            for (const line of msg.split('\n')) {
                if (line.trim()) {
                    this._consoleMessages.push({ level: 'log', text: line.trim(), timestamp: Date.now() });
                }
            }
        });
        await this._engine.start();
        console.log(`[session] Engine started for ${this._sessionId}`);
    }
    getDescription() {
        return {
            sessionId: this._sessionId,
            recordingPath: this._recordingPath,
            timestamp: this._header?.timestamp || 0,
            buildId: this._header?.buildId || '',
            title: this._recordingPath.split('/').pop() || '',
            duration: 0,
        };
    }
    getSources() {
        if (!this._engine)
            return [];
        return Array.from(this._engine.scriptUrls.entries()).map(([id, url]) => ({
            sourceId: id,
            url,
        }));
    }
    getConsoleMessages() {
        return this._consoleMessages;
    }
    getPauseState() {
        return this._engine?.getPauseState() ?? null;
    }
    isPaused() {
        return this._engine?.isPaused() ?? false;
    }
    // Run the replay without debugger — just execute and capture output
    async runReplay() {
        const engine = new replay_engine_js_1.ReplayEngine({ recordingPath: this._recordingPath });
        engine.on('stdout', (msg) => {
            for (const line of msg.split('\n')) {
                if (line.trim())
                    this._consoleMessages.push({ level: 'log', text: line.trim(), timestamp: Date.now() });
            }
        });
        engine.on('stderr', (msg) => {
            if (!msg.startsWith('[openreplay]')) {
                for (const line of msg.split('\n')) {
                    if (line.trim())
                        this._consoleMessages.push({ level: 'error', text: line.trim(), timestamp: Date.now() });
                }
            }
        });
        const result = await engine.run();
        return { ...result, messages: this.getConsoleMessages() };
    }
    async destroy() {
        await this._engine?.stop();
        this._engine = null;
        console.log(`[session] Destroyed: ${this._sessionId}`);
    }
}
exports.ReplaySession = ReplaySession;
// List all recordings in ~/.openreplay/recordings
function listRecordings() {
    const dir = (0, node_path_1.join)((0, node_os_1.homedir)(), '.openreplay', 'recordings');
    if (!(0, node_fs_1.existsSync)(dir))
        return [];
    return (0, node_fs_1.readdirSync)(dir)
        .filter(f => f.endsWith('.orec'))
        .map(f => {
        const path = (0, node_path_1.join)(dir, f);
        try {
            const header = (0, replay_engine_js_1.parseRecordingHeader)(path);
            const { size } = (0, node_fs_1.statSync)(path);
            return { id: f.replace('.orec', ''), path, timestamp: header.timestamp, size, buildId: header.buildId };
        }
        catch {
            return null;
        }
    })
        .filter((x) => x !== null)
        .sort((a, b) => b.timestamp - a.timestamp);
}
//# sourceMappingURL=session.js.map