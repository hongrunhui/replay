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
/*
 * 【回放引擎架构】
 *
 * ReplayEngine 负责把录制好的 .orec 文件"重放"出来，并提供调试能力。
 *
 * 工作流程：
 * 1. 启动一个子进程运行 patched Node.js，注入 libopenreplay.dylib（回放模式）
 * 2. 通过 Node.js 的 --inspect-brk 启动 V8 Inspector（Chrome DevTools Protocol）
 * 3. 用 WebSocket 连接到 Inspector，发送 CDP 命令控制执行
 *
 * 两种运行模式：
 * - run()：无调试器，直接执行到结束，收集 stdout/stderr。用于验证回放正确性。
 * - start()：带调试器，--inspect-brk 在第一行暂停。用于交互式调试（设断点、单步等）。
 *
 * WebSocket CDP 连接流程：
 * 1. 子进程启动后，stderr 会输出 "Debugger listening on ws://127.0.0.1:PORT/..."
 * 2. 先 HTTP GET /json 获取 webSocketDebuggerUrl（每次启动 URL 中的 UUID 不同）
 * 3. 用 WebSocket 连接该 URL，后续通过 JSON-RPC 收发 CDP 消息
 *
 * runIfWaitingForDebugger 的作用：
 * Node.js v22+ 的 --inspect-brk 行为变了：
 * 启用 Debugger.enable 后不会自动暂停，需要先发 Runtime.runIfWaitingForDebugger
 * 释放 --inspect-brk 的等待锁，然后 V8 才会触发 Debugger.paused 事件。
 * 如果不发这个命令，进程会永远卡在等待状态。
 */
const node_child_process_1 = require("node:child_process");
const node_events_1 = require("node:events");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
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
    capturedStdout = ''; // stdout captured during current runToLine execution
    lastStderr = ''; // last stderr output from child process
    constructor(opts) {
        super();
        this.opts = opts;
    }
    getNodePath() {
        if (this.opts.nodePath)
            return this.opts.nodePath;
        // Prefer patched Node.js — it's compatible with DYLD driver + inspector.
        // System Node.js v22 has DYLD+inspector conflict, patched v20 does not.
        const patched = (0, node_path_1.resolve)(__dirname, '../../node/out/Release/node');
        if ((0, node_fs_1.existsSync)(patched))
            return patched;
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
    /*
     * 【run() — 无调试器直接回放】
     * 不使用 --inspect-brk，子进程直接执行到结束。
     * 用途：快速验证录制文件能否正确回放，比较 stdout 与原始录制是否一致。
     * 不建立 WebSocket 连接，不支持断点/单步。
     */
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
    /*
     * 【start() — 带调试器的交互式回放】
     * 使用 --inspect-brk 启动，在第一行代码前暂停。
     * 建立 WebSocket CDP 连接后，调用方可以：
     *   - setBreakpoint / resume / stepOver / stepInto
     *   - evaluate 表达式（在暂停帧上下文中求值）
     *   - getProperties 查看对象属性
     *
     * Inspector 端口随机选取 9200-9999，避免多实例冲突。
     *
     * 启动序列的时序很重要：
     * 1. 先注册 CDP 事件处理器（scriptParsed / paused / resumed）
     * 2. 再 enable 各 CDP domain（enable 可能同步触发事件）
     * 3. 发 runIfWaitingForDebugger 释放 --inspect-brk
     * 4. 等待 Debugger.paused 事件（超时 3s 兜底）
     * 如果顺序反了，可能丢失 scriptParsed 事件导致 scriptUrls 不完整。
     */
    async start() {
        const { nodePath, env, scriptPath } = this.buildSpawnConfig();
        this.inspectorPort = 9200 + Math.floor(Math.random() * 800);
        const nodeArgs = scriptPath
            ? [`--inspect-brk=${this.inspectorPort}`, scriptPath]
            : [`--inspect-brk=${this.inspectorPort}`, '-e', 'void 0'];
        this.child = (0, node_child_process_1.spawn)(nodePath, nodeArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });
        this.lastStderr = '';
        this.child.stderr?.on('data', (data) => {
            const msg = data.toString();
            this.lastStderr += msg;
            this.emit('stderr', msg);
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
            // Map CDP callFrame.location.lineNumber to our flat FrameInfo.lineNumber
            const rawFrames = params?.callFrames || [];
            this.currentPause = {
                frames: rawFrames.map((f) => ({
                    callFrameId: f.callFrameId,
                    functionName: f.functionName || '',
                    url: f.url || '',
                    lineNumber: f.location?.lineNumber ?? f.lineNumber ?? 0,
                    columnNumber: f.location?.columnNumber ?? f.columnNumber ?? 0,
                    scopeChain: f.scopeChain || [],
                })),
                stdout: '',
            };
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
            setTimeout(resolve, 8000); // fallback — replay mode takes longer to init
        });
        // Connect WebSocket to inspector
        let lastConnectError = null;
        for (let i = 0; i < 50; i++) {
            try {
                await this.connectWS();
                return;
            }
            catch (err) {
                lastConnectError = err;
                await new Promise(r => setTimeout(r, 100));
            }
            // After 10 retries, check if child process is still alive
            if (i === 9 && this.child && this.child.exitCode !== null) {
                throw new Error(`Inspector connection failed after 10 retries: child process exited with code ${this.child.exitCode}. ` +
                    `stderr: ${this.lastStderr.slice(-500)}`);
            }
        }
        throw new Error(`Could not connect to inspector on port ${this.inspectorPort} after 50 retries. ` +
            `Last error: ${lastConnectError?.message || 'unknown'}. ` +
            `Ensure the patched Node.js is built and the recording file is valid. ` +
            `stderr: ${this.lastStderr.slice(-500)}`);
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
    /*
     * 【CDP 消息分发】
     * CDP 使用 JSON-RPC 风格协议，消息分两类：
     * - 有 id 的：是之前 sendCDP() 请求的响应，通过 pendingRequests Map 匹配
     * - 有 method 的：是服务器推送的事件（如 Debugger.paused），分发给 cdpEventHandlers
     */
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
    /** Returns the last stderr output from the child process. Useful for diagnostics. */
    getLastError() { return this.lastStderr; }
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
    /*
     * 收集每行代码的执行次数 — Replay.io 方案。
     *
     * 原理：V8 字节码生成器在每个语句位置插入 Instrumentation 字节码。
     * 执行时 V8 runtime 计算 (script_id, line) 传给驱动，驱动直接聚合。
     * 进程退出后驱动把命中计数写入 JSON 文件，server 读取。
     *
     * 与旧 Profiler Coverage 方案相比：
     * - 不需要单独进程的 CDP 连接
     * - 回放到哪就收集到哪（和 runToLine 共用进程）
     * - 精确到语句级别
     */
    async collectHitCounts(targetFile) {
        const { nodePath, env, scriptPath } = this.buildSpawnConfig();
        if (!scriptPath)
            return {};
        const header = parseRecordingHeader(this.opts.recordingPath);
        const traceFile = (0, node_path_1.join)((0, node_os_1.homedir)(), '.openreplay', `trace-${Date.now()}.json`);
        // Enable V8 instrumentation + trace output via env vars
        const instrEnv = {
            ...env,
            OPENREPLAY_INSTRUMENT: '1',
            OPENREPLAY_TRACE_OUTPUT: traceFile,
        };
        const nodeArgs = [];
        if (header.randomSeed)
            nodeArgs.push(`--random-seed=${header.randomSeed}`);
        nodeArgs.push(scriptPath);
        // Run replay to completion with instrumentation enabled
        const child = (0, node_child_process_1.spawn)(nodePath, nodeArgs, { env: instrEnv, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stderr?.on('data', (d) => {
            const msg = d.toString();
            if (msg.includes('[openreplay]'))
                process.stderr.write(`[hitcount] ${msg}`);
        });
        let exited = false;
        await new Promise((resolve) => {
            child.on('exit', (code) => { exited = true; resolve(); });
            setTimeout(() => { if (!exited) {
                child.kill();
                resolve();
            } }, 120000);
        });
        // Give driver time to flush trace file (ShutdownDriver writes on exit)
        if (exited)
            await new Promise(r => setTimeout(r, 200));
        // Read trace file written by driver
        const counts = {};
        try {
            const { readFileSync, unlinkSync, existsSync: fileExists } = await import('node:fs');
            if (!fileExists(traceFile)) {
                console.warn('[engine] Trace file not found:', traceFile, '- returning empty hit counts');
                return counts;
            }
            const json = readFileSync(traceFile, 'utf8');
            if (!json || json.trim().length === 0) {
                console.warn('[engine] Trace file is empty:', traceFile, '- returning empty hit counts');
                try {
                    unlinkSync(traceFile);
                }
                catch { }
                return counts;
            }
            let data;
            try {
                data = JSON.parse(json);
            }
            catch (parseErr) {
                console.warn('[engine] Trace file is malformed:', traceFile, '-', parseErr.message, '- returning empty hit counts');
                try {
                    unlinkSync(traceFile);
                }
                catch { }
                return counts;
            }
            // The trace contains ALL scripts (Node.js internals + user code).
            // We need to find the user script's script_id.
            // Strategy: read the source file to get its line count, then find the
            // script_id whose max line number matches (user scripts are small,
            // Node.js internals have thousands of lines).
            let sourceLineCount = 0;
            try {
                const source = readFileSync(targetFile, 'utf8');
                sourceLineCount = source.split('\n').length;
            }
            catch { }
            // Find the best matching script_id:
            // Trace keys are now source_positions (character offsets), not line numbers.
            // User script: max source_position must be < source text length.
            let sourceLength = 0;
            try {
                sourceLength = readFileSync(targetFile, 'utf8').length;
            }
            catch { }
            let bestScriptId = null;
            let bestLocationCount = 0;
            for (const [scriptId, posCounts] of Object.entries(data)) {
                const positions = Object.keys(posCounts).map(Number);
                if (positions.length === 0)
                    continue;
                const maxPos = Math.max(...positions);
                // User script: max source_position within source file length
                if (sourceLength > 0 && maxPos < sourceLength) {
                    if (positions.length > bestLocationCount) {
                        bestLocationCount = positions.length;
                        bestScriptId = scriptId;
                    }
                }
            }
            // Extract hit counts: trace stores {source_position: count}.
            // Map source_position → line using source text.
            // Same line with multiple positions → take MAX (not sum).
            // This matches Replay.io: `for(init;cond;update)` shows 1x, not 12x.
            if (bestScriptId && data[bestScriptId]) {
                let source = '';
                try {
                    source = readFileSync(targetFile, 'utf8');
                }
                catch { }
                const lineStarts = [0];
                for (let i = 0; i < source.length; i++) {
                    if (source[i] === '\n')
                        lineStarts.push(i + 1);
                }
                const posToLine = (pos) => {
                    let lo = 0, hi = lineStarts.length - 1;
                    while (lo < hi) {
                        const mid = (lo + hi + 1) >> 1;
                        if (lineStarts[mid] <= pos)
                            lo = mid;
                        else
                            hi = mid - 1;
                    }
                    return lo;
                };
                // Group by line, take count of FIRST source_position per line.
                // for(init;cond;update) → use init's count (1x), not cond's (6x).
                const lineFirstPos = {};
                for (const [posStr, count] of Object.entries(data[bestScriptId])) {
                    const pos = parseInt(posStr, 10);
                    if (isNaN(pos) || pos < 0)
                        continue;
                    const lineNum = posToLine(pos);
                    if (!(lineNum in lineFirstPos) || pos < lineFirstPos[lineNum].pos) {
                        lineFirstPos[lineNum] = { pos, count: count };
                    }
                }
                for (const [line, { count }] of Object.entries(lineFirstPos)) {
                    counts[parseInt(line, 10)] = count;
                }
                console.log(`[engine] Hit counts: script ${bestScriptId}, ${Object.keys(counts).length} lines`);
            }
            else {
                console.log(`[engine] No matching script found for ${targetFile} (${sourceLineCount} lines)`);
            }
            // Clean up trace file
            try {
                unlinkSync(traceFile);
            }
            catch { }
        }
        catch (e) {
            console.error('[engine] Failed to read trace file:', e.message);
        }
        return counts;
    }
    async runToCompletion() {
        await this.resume();
        return new Promise((resolve) => this.once('exit', resolve));
    }
    /*
     * 【时间旅行核心】runToLine — 回退到指定位置
     *
     * 原理：因为回放是确定性的（时间/随机/网络都从录制数据返回），
     * "回退" 等价于杀掉当前进程 → 重新启动 → 运行到目标行。
     * 每次 runToLine 都是从头重放，但由于所有非确定性值都来自录制，
     * 程序一定会走到完全相同的执行路径。
     *
     * 性能：对短脚本（<1s）几乎无延迟。长脚本需要 checkpoint 优化（Phase 10.1）。
     */
    // Get PIDs of fork checkpoint children (from driver stderr output)
    forkCheckpointPids = [];
    async runToLine(fileUrl, lineNumber) {
        // Save checkpoint PIDs before stopping (they'll survive if we SIGCONT one first)
        const savedCheckpoints = [...this.forkCheckpointPids];
        // Try to restore from a fork checkpoint (if available).
        // SIGCONT the child BEFORE killing the parent, so the child wakes up
        // and blocks SIGTERM before the parent's atexit can kill it.
        let restoredFromCheckpoint = false;
        if (savedCheckpoints.length > 0 && this.child) {
            const cpChild = savedCheckpoints[savedCheckpoints.length - 1]; // latest checkpoint
            try {
                process.kill(cpChild.pid, 'SIGCONT'); // Wake checkpoint child
                restoredFromCheckpoint = true;
                process.stderr.write(`[engine] Restoring from checkpoint (pid ${cpChild.pid}, events ${cpChild.events})\n`);
            }
            catch {
                // Checkpoint child already dead
                restoredFromCheckpoint = false;
            }
        }
        // Kill the current main process
        await this.stop();
        this.scriptUrls.clear();
        this.cdpEventHandlers.clear();
        this.currentPause = null;
        this.nextMsgId = 1;
        if (restoredFromCheckpoint) {
            const cpChild = savedCheckpoints[savedCheckpoints.length - 1];
            // Give child time to resume and process the SIGCONT
            await new Promise(r => setTimeout(r, 300));
            // Send SIGUSR1 to activate Node.js inspector on port 9229
            try {
                process.kill(cpChild.pid, 'SIGUSR1');
                process.stderr.write(`[engine] Sent SIGUSR1 to checkpoint child ${cpChild.pid}\n`);
            }
            catch {
                process.stderr.write(`[engine] Checkpoint child died, falling back\n`);
                restoredFromCheckpoint = false;
            }
        }
        if (restoredFromCheckpoint) {
            const cpChild = savedCheckpoints[savedCheckpoints.length - 1];
            this.inspectorPort = 9229;
            this.forkCheckpointPids = [];
            this.child = null;
            // Wait for inspector to become available (SIGUSR1 → inspector takes ~1-2s)
            for (let attempt = 0; attempt < 20; attempt++) {
                try {
                    await new Promise(r => setTimeout(r, 300));
                    await this.connectWS();
                    process.stderr.write(`[engine] Connected to checkpoint inspector!\n`);
                    break;
                }
                catch {
                    if (attempt === 19) {
                        process.stderr.write(`[engine] Checkpoint inspector failed after 20 attempts, falling back\n`);
                        try {
                            process.kill(cpChild.pid, 9);
                        }
                        catch { }
                        restoredFromCheckpoint = false;
                    }
                }
            }
        }
        // Fall back: start fresh process
        if (!restoredFromCheckpoint) {
            this.forkCheckpointPids = [];
            const { nodePath, env, scriptPath } = this.buildSpawnConfig();
            this.inspectorPort = 9200 + Math.floor(Math.random() * 800);
            const header = parseRecordingHeader(this.opts.recordingPath);
            const nodeArgs = [`--inspect-brk=${this.inspectorPort}`];
            if (header.randomSeed)
                nodeArgs.push(`--random-seed=${header.randomSeed}`);
            nodeArgs.push(scriptPath || '-e void 0');
            this.child = (0, node_child_process_1.spawn)(nodePath, nodeArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });
            this.lastStderr = '';
            this.child.stderr?.on('data', (d) => {
                const msg = d.toString();
                this.lastStderr += msg;
                const cpMatch = msg.match(/Fork checkpoint #(\d+) created \(child pid (\d+), events (\d+)\)/);
                if (cpMatch) {
                    this.forkCheckpointPids.push({
                        pid: parseInt(cpMatch[2], 10),
                        events: parseInt(cpMatch[3], 10),
                    });
                }
                process.stderr.write(`[child] ${msg}`);
                this.emit('stderr', msg);
            });
            // Capture stdout for console output up to the pause point
            this.capturedStdout = '';
            this.child.stdout?.on('data', (d) => {
                this.capturedStdout += d.toString();
                this.emit('stdout', d.toString());
            });
            this.child.on('exit', (code) => this.emit('exit', code ?? 0));
        }
        await this.waitForInspector();
        // Register handlers
        this.onCDPEvent('Debugger.scriptParsed', (p) => {
            if (p?.url)
                this.scriptUrls.set(p.scriptId, p.url);
        });
        // Helper: map CDP callFrames to our FrameInfo (location.lineNumber → lineNumber)
        const mapFrames = (raw) => raw.map((f) => ({
            callFrameId: f.callFrameId,
            functionName: f.functionName || '',
            url: f.url || '',
            lineNumber: f.location?.lineNumber ?? f.lineNumber ?? 0,
            columnNumber: f.location?.columnNumber ?? f.columnNumber ?? 0,
            scopeChain: f.scopeChain || [],
        }));
        let pauseReason = '';
        // Collect console messages via CDP (more reliable than stdout buffering)
        const consoleMessages = [];
        this.onCDPEvent('Runtime.consoleAPICalled', (p) => {
            const level = p?.type || 'log';
            const args = p?.args || [];
            const text = args.map((a) => a.value ?? a.description ?? '').join(' ');
            const line = p?.stackTrace?.callFrames?.[0]?.lineNumber;
            if (text)
                consoleMessages.push({ level, text, line });
        });
        // Console.messageAdded is a duplicate of Runtime.consoleAPICalled — skip it
        // to avoid double-counting messages.
        this.onCDPEvent('Debugger.paused', (p) => {
            pauseReason = p?.reason || '';
            this.currentPause = { frames: mapFrames(p?.callFrames || []), stdout: '' };
            this.emit('paused', this.currentPause);
        });
        this.onCDPEvent('Debugger.resumed', () => {
            this.currentPause = null;
        });
        await this.sendCDP('Runtime.enable');
        await this.sendCDP('Debugger.enable');
        await this.sendCDP('Console.enable');
        await this.sendCDP('Runtime.runIfWaitingForDebugger');
        // Step 1: Wait for "Break on start" pause
        const gotInitialPause = await new Promise((resolve) => {
            if (this.currentPause) {
                resolve(true);
                return;
            }
            const h = () => resolve(true);
            this.once('paused', h);
            setTimeout(() => { this.off('paused', h); resolve(false); }, 8000);
        });
        if (!gotInitialPause)
            return null;
        // Step 2: Set breakpoint (we're paused, so this is safe)
        // Use just the filename for matching (works with file:///private/tmp/... URLs)
        const filename = fileUrl.split('/').pop() || fileUrl;
        const urlRegex = `.*${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`;
        await this.sendCDP('Debugger.setBreakpointByUrl', { urlRegex, lineNumber });
        // Step 3: Resume past "Break on start"
        await this.resume();
        // Step 4: Wait for the REAL breakpoint hit (not "Break on start")
        return new Promise((resolve) => {
            const resolveWithData = (state) => {
                if (state) {
                    // Delay to allow stdout flush + late-arriving CDP console events
                    setTimeout(() => {
                        // Merge CDP messages + stdout lines (prefer CDP if available)
                        const merged = [...consoleMessages];
                        if (merged.length === 0 && this.capturedStdout) {
                            // Fallback: parse stdout lines
                            for (const line of this.capturedStdout.split('\n')) {
                                const trimmed = line.trim();
                                if (trimmed && !trimmed.startsWith('[openreplay]')) {
                                    merged.push({ level: 'log', text: trimmed });
                                }
                            }
                        }
                        resolve({ ...state, stdout: this.capturedStdout, consoleMessages: merged });
                    }, 300);
                }
                else {
                    resolve(null);
                }
            };
            const onPause = () => {
                if (!this.currentPause)
                    return;
                if (pauseReason === 'Break on start') {
                    this.resume().catch(() => { });
                    return;
                }
                this.off('paused', onPause);
                resolveWithData(this.currentPause);
            };
            this.on('paused', onPause);
            if (this.currentPause && pauseReason !== 'Break on start') {
                resolveWithData(this.currentPause);
                return;
            }
            this.once('exit', (code) => {
                this.off('paused', onPause);
                // Process crashed or exited before hitting the breakpoint
                if (code !== 0) {
                    const errState = {
                        frames: [],
                        stdout: this.capturedStdout,
                        consoleMessages: [{
                                level: 'error',
                                text: `Process crashed before reaching line ${lineNumber + 1} (exit code: ${code}). stderr: ${this.lastStderr.slice(-500).trim()}`,
                            }],
                    };
                    resolve(errState);
                }
                else {
                    resolve(null);
                }
            });
            setTimeout(() => { this.off('paused', onPause); resolve(null); }, 15000);
        });
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
/*
 * 【录制文件头解析】
 * 读取 .orec 文件的 64 字节 header 和内嵌的 METADATA 事件。
 * METADATA 事件（type=0x20）可能出现在事件流的任意位置，
 * 需要扫描整个事件流才能找到。目前只提取 scriptPath 字段，
 * 用于 start()/run() 自动确定要回放的脚本。
 */
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
        randomSeed: undefined,
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
                if (json.randomSeed)
                    header.randomSeed = json.randomSeed;
            }
            catch { /* ignore malformed metadata */ }
        }
        i += 9 + dataLen;
    }
    return header;
}
//# sourceMappingURL=replay-engine.js.map