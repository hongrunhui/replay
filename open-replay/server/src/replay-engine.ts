// Open Replay — Replay Engine
//
// Spawns the patched Node.js in replay mode, connects to its inspector
// via WebSocket (CDP), and controls execution via the progress counter.

import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { resolve, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import http from 'node:http';
import WebSocket from 'ws';

interface ReplayEngineOptions {
  recordingPath: string;
  nodePath?: string;
  driverPath?: string;
  scriptPath?: string;  // override script to run (default: from recording metadata)
}

export interface PauseState {
  frames: FrameInfo[];
}

export interface FrameInfo {
  callFrameId: string;
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  scopeChain: ScopeInfo[];
}

interface ScopeInfo {
  type: string;
  object: { type: string; objectId?: string; description?: string };
  name?: string;
}

export class ReplayEngine extends EventEmitter {
  private opts: ReplayEngineOptions;
  private child: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private nextMsgId = 1;
  private pendingRequests = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();
  private cdpEventHandlers = new Map<string, ((params: unknown) => void)[]>();
  private inspectorPort = 9229;
  private currentPause: PauseState | null = null;
  readonly scriptUrls = new Map<string, string>();   // scriptId -> url

  constructor(opts: ReplayEngineOptions) {
    super();
    this.opts = opts;
  }

  private getNodePath(): string {
    // If user explicitly set a node path, use it.
    if (this.opts.nodePath) return this.opts.nodePath;
    // Default to the same Node.js that's running the server.
    // (Patched node has different module resolution patterns which
    //  causes event stream mismatch when recording was done with
    //  a different Node.js version.)
    return process.execPath;
  }

  private getDriverPath(): string {
    if (this.opts.driverPath) return this.opts.driverPath;
    const buildBase = resolve(__dirname, '../../driver/build');
    const dylib = process.platform === 'darwin'
      ? 'libopenreplay.dylib' : 'libopenreplay.so';
    return join(buildBase, dylib);
  }

  // Build the env/args common to start() and run()
  private buildSpawnConfig(): { nodePath: string; env: NodeJS.ProcessEnv; scriptPath?: string } {
    const nodePath = this.getNodePath();
    const driverPath = this.getDriverPath();

    if (!existsSync(this.opts.recordingPath)) {
      throw new Error(`Recording not found: ${this.opts.recordingPath}`);
    }
    if (!existsSync(driverPath)) {
      throw new Error(`Driver not found: ${driverPath}`);
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENREPLAY_MODE: 'replay',
      REPLAY_RECORDING: this.opts.recordingPath,
    };
    if (process.platform === 'darwin') {
      env.DYLD_INSERT_LIBRARIES = driverPath;
    } else {
      env.LD_PRELOAD = driverPath;
    }

    const header = parseRecordingHeader(this.opts.recordingPath);
    const scriptPath = this.opts.scriptPath || header.scriptPath;
    return { nodePath, env, scriptPath };
  }

  // Run replay without debugger — just execute and capture output.
  async run(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const { nodePath, env, scriptPath } = this.buildSpawnConfig();
    if (!scriptPath) throw new Error('No script path in recording metadata');

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      const proc = spawn(nodePath, [scriptPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); this.emit('stdout', d.toString()); });
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); this.emit('stderr', d.toString()); });
      proc.on('exit', (code) => {
        this.emit('exit', code ?? 0);
        resolve({ exitCode: code ?? 0, stdout, stderr });
      });
      this.child = proc;
    });
  }

  // Start replay with debugger attached (for stepping/breakpoints).
  async start(): Promise<void> {
    const { nodePath, env, scriptPath } = this.buildSpawnConfig();

    this.inspectorPort = 9200 + Math.floor(Math.random() * 800);

    const nodeArgs = scriptPath
      ? [`--inspect-brk=${this.inspectorPort}`, scriptPath]
      : [`--inspect-brk=${this.inspectorPort}`, '-e', 'void 0'];

    this.child = spawn(nodePath, nodeArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    this.child.stderr?.on('data', (data: Buffer) => {
      this.emit('stderr', data.toString());
    });
    this.child.stdout?.on('data', (data: Buffer) => {
      this.emit('stdout', data.toString());
    });
    this.child.on('exit', (code) => {
      this.emit('exit', code ?? 0);
    });

    await this.waitForInspector();

    // Register event handlers BEFORE enabling domains, so we don't miss
    // scriptParsed/paused events that are emitted synchronously on enable.

    // Track script IDs
    this.onCDPEvent('Debugger.scriptParsed', (params: any) => {
      if (params?.url) this.scriptUrls.set(params.scriptId, params.url);
    });

    // Track pause state
    this.onCDPEvent('Debugger.paused', (params: any) => {
      this.currentPause = { frames: params?.callFrames || [] };
      this.emit('paused', this.currentPause);
    });
    this.onCDPEvent('Debugger.resumed', () => {
      this.currentPause = null;
      this.emit('resumed');
    });

    // Enable CDP domains — scriptParsed/paused may fire immediately.
    await this.sendCDP('Runtime.enable');
    await this.sendCDP('Debugger.enable');
    await this.sendCDP('Console.enable');

    // Wait for Debugger.paused before returning. Node.js v22 requires
    // Runtime.runIfWaitingForDebugger to release the --inspect-brk hold,
    // then fires Debugger.paused with reason "Break on start".
    const pausePromise = new Promise<void>((resolve) => {
      if (this.currentPause) { resolve(); return; }
      const handler = () => resolve();
      this.once('paused', handler);
      setTimeout(() => { this.off('paused', handler); resolve(); }, 3000);
    });

    await this.sendCDP('Runtime.runIfWaitingForDebugger');
    await pausePromise;
  }

  private async waitForInspector(): Promise<void> {
    // Wait until Node.js prints "Debugger listening on ws://..."
    await new Promise<void>((resolve) => {
      const onStderr = (msg: string) => {
        if (msg.includes('Debugger listening') || msg.includes('ws://127')) {
          this.off('stderr', onStderr);
          resolve();
        }
      };
      this.on('stderr', onStderr);
      setTimeout(resolve, 4000);  // fallback
    });

    // Connect WebSocket to inspector
    for (let i = 0; i < 50; i++) {
      try {
        await this.connectWS();
        return;
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    throw new Error(`Could not connect to inspector on port ${this.inspectorPort}`);
  }

  private connectWS(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Fetch ws URL from /json endpoint
      const req = http.get(
        `http://127.0.0.1:${this.inspectorPort}/json`,
        (res) => {
          let body = '';
          res.on('data', (d: Buffer) => { body += d.toString(); });
          res.on('end', () => {
            try {
              const targets = JSON.parse(body);
              const wsUrl: string | undefined = targets[0]?.webSocketDebuggerUrl;
              if (!wsUrl) return reject(new Error('No webSocketDebuggerUrl in /json'));

              this.ws = new WebSocket(wsUrl);
              this.ws.once('open', () => resolve());
              this.ws.once('error', reject);
              this.ws.on('message', (data: Buffer) => {
                this.handleWsMessage(JSON.parse(data.toString()));
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', reject);
    });
  }

  private handleWsMessage(msg: { id?: number; method?: string; result?: unknown; error?: { message: string }; params?: unknown }): void {
    if (msg.id !== undefined) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error.message));
        else pending.resolve(msg.result);
      }
    } else if (msg.method) {
      const handlers = this.cdpEventHandlers.get(msg.method);
      if (handlers) for (const h of handlers) h(msg.params);
    }
  }

  async sendCDP(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Inspector WebSocket not open');
    }
    const id = this.nextMsgId++;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  onCDPEvent(method: string, handler: (params: unknown) => void): void {
    if (!this.cdpEventHandlers.has(method)) {
      this.cdpEventHandlers.set(method, []);
    }
    this.cdpEventHandlers.get(method)!.push(handler);
  }

  isPaused(): boolean { return this.currentPause !== null; }
  getPauseState(): PauseState | null { return this.currentPause; }

  async resume(): Promise<void> {
    await this.sendCDP('Debugger.resume');
  }

  async stepOver(): Promise<void> {
    await this.sendCDP('Debugger.stepOver');
  }

  async stepInto(): Promise<void> {
    await this.sendCDP('Debugger.stepInto');
  }

  async evaluate(expression: string, callFrameId?: string): Promise<unknown> {
    if (callFrameId) {
      const r = await this.sendCDP('Debugger.evaluateOnCallFrame', {
        callFrameId,
        expression,
        returnByValue: true,
        generatePreview: true,
      }) as any;
      return r?.result;
    }
    const r = await this.sendCDP('Runtime.evaluate', {
      expression,
      returnByValue: true,
    }) as any;
    return r?.result;
  }

  async getProperties(objectId: string): Promise<unknown[]> {
    const r = await this.sendCDP('Runtime.getProperties', {
      objectId,
      ownProperties: true,
    }) as any;
    return r?.result || [];
  }

  async runToCompletion(): Promise<number> {
    await this.resume();
    return new Promise((resolve) => this.once('exit', resolve));
  }

  getRecordingInfo(): { path: string; size: number; header: ReturnType<typeof parseRecordingHeader> } {
    const buf = readFileSync(this.opts.recordingPath);
    return {
      path: this.opts.recordingPath,
      size: buf.length,
      header: parseRecordingHeader(this.opts.recordingPath),
    };
  }

  async stop(): Promise<void> {
    if (this.ws) { this.ws.close(); this.ws = null; }
    if (this.child) { this.child.kill(); this.child = null; }
    this.pendingRequests.clear();
  }
}

// Parse recording file header and metadata
export function parseRecordingHeader(path: string): {
  magic: string;
  version: number;
  timestamp: number;
  buildId: string;
  scriptPath?: string;
} {
  const buf = readFileSync(path);
  if (buf.length < 64) throw new Error('Recording file too small');

  const header = {
    magic: buf.subarray(0, 8).toString('ascii'),
    version: buf.readUInt32LE(8),
    timestamp: Number(buf.readBigUInt64LE(16)),
    buildId: buf.subarray(24, 56).toString('ascii').replace(/\0+$/, ''),
    scriptPath: undefined as string | undefined,
  };

  // Scan event stream for METADATA events (type=0x20)
  let i = 64;
  const tailSize = 32;
  while (i + 9 <= buf.length - tailSize) {
    const type = buf[i];
    const dataLen = buf.readUInt32LE(i + 5);
    if (type === 0x20) {
      try {
        const json = JSON.parse(buf.subarray(i + 9, i + 9 + dataLen).toString('utf8'));
        if (json.scriptPath) header.scriptPath = json.scriptPath;
      } catch { /* ignore malformed metadata */ }
    }
    i += 9 + dataLen;
  }

  return header;
}
