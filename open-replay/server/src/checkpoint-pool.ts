// Checkpoint Pool — maintains pre-warmed replay processes at different execution points
// for fast backward jumps. Instead of fork() (which corrupts kqueue on macOS),
// we spawn multiple replay processes, each paused at a different line.
//
// Architecture:
//   1. On first runToLine, run the script to completion to collect all line positions
//   2. Spawn N checkpoint processes, each paused at evenly-spaced lines
//   3. When user jumps backward, find the nearest checkpoint process
//   4. Resume it to the target line (short forward replay instead of full restart)

import { ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import http from 'node:http';
import WebSocket from 'ws';
import { parseRecordingHeader } from './replay-engine.js';

interface CheckpointProcess {
  pid: number;
  port: number;
  line: number;  // line where this process is paused
  child: ChildProcess;
  ws?: WebSocket;
}

export class CheckpointPool {
  private checkpoints: CheckpointProcess[] = [];
  private recordingPath: string;
  private maxCheckpoints: number;

  constructor(recordingPath: string, maxCheckpoints = 5) {
    this.recordingPath = recordingPath;
    this.maxCheckpoints = maxCheckpoints;
  }

  get size() { return this.checkpoints.length; }

  // Find the nearest checkpoint at or before the target line
  findNearest(targetLine: number): CheckpointProcess | null {
    let best: CheckpointProcess | null = null;
    for (const cp of this.checkpoints) {
      if (cp.line <= targetLine) {
        if (!best || cp.line > best.line) best = cp;
      }
    }
    return best;
  }

  // Pre-warm checkpoints at evenly-spaced lines
  async warmUp(totalLines: number, scriptFile: string): Promise<void> {
    if (totalLines <= 0 || this.checkpoints.length > 0) return;

    const interval = Math.max(1, Math.floor(totalLines / (this.maxCheckpoints + 1)));
    const lines: number[] = [];
    for (let i = interval; i < totalLines; i += interval) {
      if (lines.length >= this.maxCheckpoints) break;
      lines.push(i);
    }

    // Spawn checkpoint processes in parallel
    const header = parseRecordingHeader(this.recordingPath);
    const nodePath = this.getNodePath();
    const driverPath = this.getDriverPath();

    await Promise.all(lines.map(line =>
      this.spawnCheckpoint(line, scriptFile, nodePath, driverPath, header.randomSeed)
        .catch(() => {}) // ignore failures
    ));

    process.stderr.write(`[checkpoint-pool] ${this.checkpoints.length} checkpoints created\n`);
  }

  private async spawnCheckpoint(
    line: number, scriptFile: string,
    nodePath: string, driverPath: string,
    randomSeed?: number,
  ): Promise<void> {
    const port = 9200 + Math.floor(Math.random() * 800);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENREPLAY_MODE: 'replay',
      REPLAY_RECORDING: this.recordingPath,
    };
    if (process.platform === 'darwin') {
      env.DYLD_INSERT_LIBRARIES = driverPath;
    }

    const args: string[] = [`--inspect-brk=${port}`];
    if (randomSeed) args.push(`--random-seed=${randomSeed}`);
    args.push(scriptFile);

    const child = spawn(nodePath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    // Wait for inspector
    await new Promise<void>((resolve) => {
      child.stderr?.on('data', (d: Buffer) => {
        if (d.toString().includes('Debugger listening')) resolve();
      });
      setTimeout(resolve, 8000);
    });

    // Connect and run to the target line
    const wsUrl = await this.getWsUrl(port);
    if (!wsUrl) { child.kill(); return; }

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((r, j) => { ws.once('open', r); ws.once('error', j); setTimeout(j, 5000); }).catch(() => {});

    let msgId = 1;
    const pending = new Map<number, (v: any) => void>();
    ws.on('message', (d: Buffer) => {
      const msg = JSON.parse(d.toString());
      if (msg.id) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg.result); } }
      if (msg.method === 'Debugger.paused' && msg.params?.reason === 'Break on start') {
        // Resume "Break on start" pauses
        ws.send(JSON.stringify({ id: msgId++, method: 'Debugger.resume', params: {} }));
      }
    });

    const cdp = (method: string, params: any = {}): Promise<any> => {
      const id = msgId++;
      return new Promise(r => {
        pending.set(id, r);
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => { pending.delete(id); r(null); }, 10000);
      });
    };

    await cdp('Debugger.enable');
    await cdp('Runtime.enable');

    // Set breakpoint at target line
    const filename = scriptFile.split('/').pop() || scriptFile;
    await cdp('Debugger.setBreakpointByUrl', {
      urlRegex: `.*${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`,
      lineNumber: line,
    });
    await cdp('Runtime.runIfWaitingForDebugger');

    // Wait for breakpoint hit
    await new Promise<void>((resolve) => {
      ws.on('message', (d: Buffer) => {
        const msg = JSON.parse(d.toString());
        if (msg.method === 'Debugger.paused' && msg.params?.reason !== 'Break on start') {
          resolve();
        }
      });
      setTimeout(resolve, 10000);
    });

    this.checkpoints.push({ pid: child.pid!, port, line, child, ws });
  }

  private getNodePath(): string {
    const patched = resolve(__dirname, '../../node/out/Release/node');
    return existsSync(patched) ? patched : process.execPath;
  }

  private getDriverPath(): string {
    const base = resolve(__dirname, '../../driver/build');
    return process.platform === 'darwin'
      ? resolve(base, 'libopenreplay.dylib')
      : resolve(base, 'libopenreplay.so');
  }

  private getWsUrl(port: number): Promise<string | null> {
    return new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let body = '';
        res.on('data', (d: Buffer) => body += d.toString());
        res.on('end', () => {
          try { resolve(JSON.parse(body)[0]?.webSocketDebuggerUrl); }
          catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
      setTimeout(() => resolve(null), 5000);
    });
  }

  // Clean up all checkpoint processes
  destroy(): void {
    for (const cp of this.checkpoints) {
      cp.ws?.close();
      cp.child.kill();
    }
    this.checkpoints = [];
  }
}
