"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.record = record;
const node_child_process_1 = require("node:child_process");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const utils_js_1 = require("./utils.js");
async function record(script, options) {
    const driverPath = (0, utils_js_1.getDriverPath)();
    if (!(0, node_fs_1.existsSync)(driverPath)) {
        console.error(`Driver not found: ${driverPath}`);
        console.error('Run: cd driver && bash build.sh');
        process.exit(1);
    }
    const nodeBin = options.node || (0, utils_js_1.getNodePath)();
    const scriptPath = (0, node_path_1.resolve)(script);
    if (!(0, node_fs_1.existsSync)(scriptPath)) {
        console.error(`Script not found: ${scriptPath}`);
        process.exit(1);
    }
    const env = {
        ...process.env,
        OPENREPLAY_MODE: 'record',
    };
    if (options.output) {
        env.OPENREPLAY_RECORDING_PATH = (0, node_path_1.resolve)(options.output);
    }
    // On macOS, use DYLD_INSERT_LIBRARIES
    if (process.platform === 'darwin') {
        env.DYLD_INSERT_LIBRARIES = driverPath;
    }
    else {
        env.LD_PRELOAD = driverPath;
    }
    // Generate a random seed for V8's Math.random() PRNG.
    // This seed is passed via --random-seed and stored in the recording metadata.
    // On replay, the same seed is used to produce identical Math.random() sequences.
    // Generate a random seed for V8's Math.random() PRNG.
    // Stored in metadata so replay can use the same seed.
    const randomSeed = Math.floor(Math.random() * 2147483647) + 1;
    env.OPENREPLAY_RANDOM_SEED = String(randomSeed);
    // Pass script path explicitly (argv[1] is now --random-seed, not the script)
    env.OPENREPLAY_SCRIPT = scriptPath;
    console.log(`Recording: ${scriptPath}`);
    console.log(`Driver: ${driverPath}`);
    const child = (0, node_child_process_1.spawn)(nodeBin, [`--random-seed=${randomSeed}`, scriptPath], {
        env,
        stdio: 'inherit',
    });
    child.on('close', (code) => {
        console.log(`\nRecording finished (exit code: ${code})`);
        console.log(`Recordings saved to: ${(0, utils_js_1.getRecordingsDir)()}`);
    });
    child.on('error', (err) => {
        console.error(`Failed to start: ${err.message}`);
        process.exit(1);
    });
}
//# sourceMappingURL=record.js.map