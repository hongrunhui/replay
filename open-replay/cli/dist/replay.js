"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serve = void 0;
exports.replay = replay;
const node_child_process_1 = require("node:child_process");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const utils_js_1 = require("./utils.js");
// Resolve recording path from UUID or path
function resolveRecording(recording) {
    if ((0, node_fs_1.existsSync)(recording))
        return (0, node_path_1.resolve)(recording);
    // Try as UUID
    const dir = (0, utils_js_1.getRecordingsDir)();
    const withExt = recording.endsWith('.orec') ? recording : `${recording}.orec`;
    const candidate = (0, node_path_1.join)(dir, withExt);
    if ((0, node_fs_1.existsSync)(candidate))
        return candidate;
    // Try partial match
    if ((0, node_fs_1.existsSync)(dir)) {
        const match = (0, node_fs_1.readdirSync)(dir).find(f => f.startsWith(recording) && f.endsWith('.orec'));
        if (match)
            return (0, node_path_1.join)(dir, match);
    }
    return recording; // let it fail with a proper error
}
// Parse script path from recording metadata
// Parse recording metadata (scriptPath, randomSeed, etc.)
function getRecordingMetadata(recordingPath) {
    try {
        const buf = (0, node_fs_1.readFileSync)(recordingPath);
        let i = 64;
        while (i + 9 <= buf.length - 32) {
            const type = buf[i];
            const dataLen = buf.readUInt32LE(i + 5);
            if (type === 0x20) {
                return JSON.parse(buf.subarray(i + 9, i + 9 + dataLen).toString('utf8'));
            }
            i += 9 + dataLen;
        }
    }
    catch { /* ignore */ }
    return {};
}
// Direct replay: run the script with the driver in replay mode
async function directReplay(recordingPath, options) {
    const driverPath = (0, utils_js_1.getDriverPath)();
    if (!(0, node_fs_1.existsSync)(driverPath)) {
        console.error(`Driver not found: ${driverPath}`);
        console.error('Run: cd driver && bash build.sh');
        process.exit(1);
    }
    const meta = getRecordingMetadata(recordingPath);
    if (!meta.scriptPath) {
        console.error('No script path found in recording metadata.');
        console.error('This recording may have been created with an older driver version.');
        process.exit(1);
    }
    if (!(0, node_fs_1.existsSync)(meta.scriptPath)) {
        console.error(`Script not found: ${meta.scriptPath}`);
        process.exit(1);
    }
    const nodeBin = options.node || 'node';
    const env = {
        ...process.env,
    };
    // Inject driver for both normal and debug mode.
    // The time extrapolation mechanism handles event exhaustion gracefully,
    // so the inspector can coexist with REPLAYING mode.
    env.OPENREPLAY_MODE = 'replay';
    env.REPLAY_RECORDING = recordingPath;
    if (process.platform === 'darwin') {
        env.DYLD_INSERT_LIBRARIES = driverPath;
    }
    else {
        env.LD_PRELOAD = driverPath;
    }
    const inspectPort = options.inspectPort || '9229';
    const nodeArgs = [];
    if (meta.randomSeed) {
        nodeArgs.push(`--random-seed=${meta.randomSeed}`);
    }
    if (options.debug) {
        nodeArgs.push(`--inspect-brk=${inspectPort}`);
    }
    nodeArgs.push(meta.scriptPath);
    console.error(`Replaying: ${recordingPath}`);
    console.error(`Script: ${meta.scriptPath}`);
    if (meta.randomSeed)
        console.error(`Random seed: ${meta.randomSeed}`);
    if (options.debug) {
        console.error(`\nDebugger listening on ws://127.0.0.1:${inspectPort}`);
        console.error(`Open Chrome and navigate to: chrome://inspect`);
        console.error(`Or open: devtools://devtools/bundled/js_app.html?ws=127.0.0.1:${inspectPort}`);
        console.error(`\nWaiting for debugger to connect...`);
    }
    const child = (0, node_child_process_1.spawn)(nodeBin, nodeArgs, {
        env,
        stdio: ['inherit', 'inherit', 'pipe'],
    });
    // Filter out openreplay messages from stderr (keep inspector + errors)
    child.stderr?.on('data', (data) => {
        const text = data.toString();
        for (const line of text.split('\n')) {
            if (line.trim() && !line.startsWith('[openreplay]')) {
                process.stderr.write(line + '\n');
            }
        }
    });
    // In debug mode, wait for the child to exit (it won't until debugger disconnects)
    if (options.debug) {
        return; // Don't set up close handler — let the process run interactively
    }
    child.on('close', (code) => {
        process.exit(code ?? 0);
    });
    child.on('error', (err) => {
        console.error(`Failed to start: ${err.message}`);
        process.exit(1);
    });
}
// Server replay: start WebSocket server for programmatic access
async function serverReplay(recordingPath, options) {
    const port = parseInt(options.port || '1234', 10);
    // Dynamic import to avoid compile-time dependency on server package
    let startServer;
    try {
        const mod = await Function('p', 'return import(p)')('../../server/src/index.js');
        startServer = mod.startServer;
    }
    catch {
        console.error('Server module not available. Install server dependencies first.');
        process.exit(1);
    }
    await startServer({ port, recordingPath });
}
async function replay(recording, options) {
    const recordingPath = resolveRecording(recording);
    if (!(0, node_fs_1.existsSync)(recordingPath)) {
        console.error(`Recording not found: ${recordingPath}`);
        process.exit(1);
    }
    if (options.server) {
        await serverReplay(recordingPath, options);
    }
    else {
        await directReplay(recordingPath, options);
    }
}
// Keep old name for backwards compatibility
exports.serve = replay;
//# sourceMappingURL=replay.js.map