"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecordingsDir = getRecordingsDir;
exports.getDriverPath = getDriverPath;
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
function getRecordingsDir() {
    return (0, node_path_1.join)((0, node_os_1.homedir)(), '.openreplay', 'recordings');
}
function getDriverPath() {
    // Look for driver relative to CLI package
    const base = (0, node_path_1.join)(__dirname, '..', '..', 'driver', 'build');
    if (process.platform === 'darwin') {
        return (0, node_path_1.join)(base, 'libopenreplay.dylib');
    }
    return (0, node_path_1.join)(base, 'libopenreplay.so');
}
//# sourceMappingURL=utils.js.map