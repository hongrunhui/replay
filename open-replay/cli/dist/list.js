"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = list;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const utils_js_1 = require("./utils.js");
function list(options) {
    const dir = options.dir || (0, utils_js_1.getRecordingsDir)();
    let files;
    try {
        files = (0, node_fs_1.readdirSync)(dir).filter(f => f.endsWith('.orec'));
    }
    catch {
        console.log('No recordings found.');
        return;
    }
    if (files.length === 0) {
        console.log('No recordings found.');
        return;
    }
    console.log(`Recordings in ${dir}:\n`);
    console.log('  ID                                    Size      Date');
    console.log('  ' + '-'.repeat(70));
    for (const file of files.sort()) {
        const fullPath = (0, node_path_1.join)(dir, file);
        const stat = (0, node_fs_1.statSync)(fullPath);
        const id = file.replace('.orec', '');
        const size = formatSize(stat.size);
        const date = stat.mtime.toISOString().replace('T', ' ').slice(0, 19);
        console.log(`  ${id}  ${size.padStart(8)}  ${date}`);
    }
    console.log(`\n  Total: ${files.length} recording(s)`);
}
function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
//# sourceMappingURL=list.js.map