#!/usr/bin/env node
import { Command } from 'commander';
import { record } from './record.js';
import { list } from './list.js';
import { replay } from './replay.js';
import { deleteRecording } from './delete.js';

const program = new Command();

program
  .name('openreplay')
  .description('Open Replay — Record and replay Node.js programs')
  .version('0.1.0');

program
  .command('record <script>')
  .description('Record a Node.js script execution')
  .option('-o, --output <path>', 'Output recording file path')
  .option('--node <path>', 'Path to Node.js binary (default: node)')
  .option('-s, --serve', 'Auto-start replay server after recording')
  .option('-p, --port <port>', 'Server port (with --serve)', '1234')
  .action(record);

program
  .command('list')
  .description('List all recordings')
  .option('-d, --dir <path>', 'Recordings directory')
  .action(list);

program
  .command('replay <recording>')
  .description('Replay a recording (UUID, partial UUID, or path)')
  .option('-p, --port <port>', 'WebSocket port (with --server)', '1234')
  .option('--server', 'Start a WebSocket replay server instead of direct replay')
  .option('--debug', 'Start with debugger (--inspect-brk), connect via Chrome DevTools')
  .option('--inspect-port <port>', 'Inspector port for --debug mode', '9229')
  .option('--node <path>', 'Path to Node.js binary')
  .action(replay);

program
  .command('delete <recording>')
  .description('Delete a recording')
  .action(deleteRecording);

program.parse();
