"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteRecording = deleteRecording;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const utils_js_1 = require("./utils.js");
function deleteRecording(recording) {
    // If it's a UUID, look in the recordings dir
    let path = recording;
    if (!recording.includes('/')) {
        const dir = (0, utils_js_1.getRecordingsDir)();
        path = (0, node_path_1.join)(dir, recording.endsWith('.orec') ? recording : `${recording}.orec`);
    }
    if (!(0, node_fs_1.existsSync)(path)) {
        console.error(`Recording not found: ${path}`);
        process.exit(1);
    }
    (0, node_fs_1.unlinkSync)(path);
    console.log(`Deleted: ${path}`);
}
//# sourceMappingURL=delete.js.map