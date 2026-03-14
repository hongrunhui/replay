#!/usr/bin/env node
import { Command } from 'commander';
import { record } from './record.js';
import { list } from './list.js';
import { serve } from './replay.js';
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
  .action(record);

program
  .command('list')
  .description('List all recordings')
  .option('-d, --dir <path>', 'Recordings directory')
  .action(list);

program
  .command('serve <recording>')
  .description('Start replay server for a recording')
  .option('-p, --port <port>', 'WebSocket port', '1234')
  .option('--devtools', 'Also start DevTools UI')
  .action(serve);

program
  .command('delete <recording>')
  .description('Delete a recording')
  .action(deleteRecording);

program.parse();
