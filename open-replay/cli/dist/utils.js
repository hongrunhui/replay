"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecordingsDir = getRecordingsDir;
exports.getDriverPath = getDriverPath;
exports.getNodePath = getNodePath;
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_fs_1 = require("node:fs");
function getRecordingsDir() {
    return (0, node_path_1.join)((0, node_os_1.homedir)(), '.openreplay', 'recordings');
}
function getDriverPath() {
    const base = (0, node_path_1.join)(__dirname, '..', '..', 'driver', 'build');
    if (process.platform === 'darwin') {
        return (0, node_path_1.join)(base, 'libopenreplay.dylib');
    }
    return (0, node_path_1.join)(base, 'libopenreplay.so');
}
// Prefer patched Node.js (v20) — compatible with driver + inspector.
// Falls back to system node if patched version not built.
function getNodePath() {
    const patched = (0, node_path_1.join)(__dirname, '..', '..', 'node', 'out', 'Release', 'node');
    if ((0, node_fs_1.existsSync)(patched))
        return patched;
    return 'node';
}
//# sourceMappingURL=utils.js.map