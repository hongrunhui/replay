#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const record_js_1 = require("./record.js");
const list_js_1 = require("./list.js");
const replay_js_1 = require("./replay.js");
const delete_js_1 = require("./delete.js");
const program = new commander_1.Command();
program
    .name('openreplay')
    .description('Open Replay — Record and replay Node.js programs')
    .version('0.1.0');
program
    .command('record <script>')
    .description('Record a Node.js script execution')
    .option('-o, --output <path>', 'Output recording file path')
    .option('--node <path>', 'Path to Node.js binary (default: node)')
    .action(record_js_1.record);
program
    .command('list')
    .description('List all recordings')
    .option('-d, --dir <path>', 'Recordings directory')
    .action(list_js_1.list);
program
    .command('replay <recording>')
    .description('Replay a recording (UUID, partial UUID, or path)')
    .option('-p, --port <port>', 'WebSocket port (with --server)', '1234')
    .option('--server', 'Start a WebSocket replay server instead of direct replay')
    .option('--node <path>', 'Path to Node.js binary')
    .action(replay_js_1.replay);
program
    .command('delete <recording>')
    .description('Delete a recording')
    .action(delete_js_1.deleteRecording);
program.parse();
//# sourceMappingURL=index.js.map