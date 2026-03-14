// Open Replay — Replay Engine
//
// Spawns the patched Node.js in replay mode, connects to its inspector
// via WebSocket (CDP), and controls execution via the progress counter.

/*
 * 【回放引擎架构】
 *
 * ReplayEngine 负责把录制好的 .orec 文件"重放"出来，并提供调试能力。
 *
 * 工作流程：
 * 1. 启动一个子进程运行 patched Node.js，注入 libopenreplay.dylib（回放模式）
 * 2. 通过 Node.js 的 --inspect-brk 启动 V8 Inspector（Chrome DevTools Protocol）
 * 3. 用 WebSocket 连接到 Inspector，发送 CDP 命令控制执行
 *
 * 两种运行模式：
 * - run()：无调试器，直接执行到结束，收集 stdout/stderr。用于验证回放正确性。
 * - start()：带调试器，--inspect-brk 在第一行暂停。用于交互式调试（设断点、单步等）。
 *
 * WebSocket CDP 连接流程：
 * 1. 子进程启动后，stderr 会输出 "Debugger listening on ws://127.0.0.1:PORT/..."
 * 2. 先 HTTP GET /json 获取 webSocketDebuggerUrl（每次启动 URL 中的 UUID 不同）
 * 3. 用 WebSocket 连接该 URL，后续通过 JSON-RPC 收发 CDP 消息
 *
 * runIfWaitingForDebugger 的作用：
 * Node.js v22+ 的 --inspect-brk 行为变了：
 * 启用 Debugger.enable 后不会自动暂停，需要先发 Runtime.runIfWaitingForDebugger
 * 释放 --inspect-brk 的等待锁，然后 V8 才会触发 Debugger.paused 事件。
 * 如果不发这个命令，进程会永远卡在等待状态。
 */

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
  stdout: string;  // console output captured up to this pause point
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
  capturedStdout = '';  // stdout captured during current runToLine execution

  constructor(opts: ReplayEngineOptions) {
    super();
    this.opts = opts;
  }

  private getNodePath(): string {
    if (this.opts.nodePath) return this.opts.nodePath;
    // Prefer patched Node.js — it's compatible with DYLD driver + inspector.
    // System Node.js v22 has DYLD+inspector conflict, patched v20 does not.
    const patched = resolve(__dirname, '../../node/out/Release/node');
    if (existsSync(patched)) return patched;
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

  /*
   * 【run() — 无调试器直接回放】
   * 不使用 --inspect-brk，子进程直接执行到结束。
   * 用途：快速验证录制文件能否正确回放，比较 stdout 与原始录制是否一致。
   * 不建立 WebSocket 连接，不支持断点/单步。
   */
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

  /*
   * 【start() — 带调试器的交互式回放】
   * 使用 --inspect-brk 启动，在第一行代码前暂停。
   * 建立 WebSocket CDP 连接后，调用方可以：
   *   - setBreakpoint / resume / stepOver / stepInto
   *   - evaluate 表达式（在暂停帧上下文中求值）
   *   - getProperties 查看对象属性
   *
   * Inspector 端口随机选取 9200-9999，避免多实例冲突。
   *
   * 启动序列的时序很重要：
   * 1. 先注册 CDP 事件处理器（scriptParsed / paused / resumed）
   * 2. 再 enable 各 CDP domain（enable 可能同步触发事件）
   * 3. 发 runIfWaitingForDebugger 释放 --inspect-brk
   * 4. 等待 Debugger.paused 事件（超时 3s 兜底）
   * 如果顺序反了，可能丢失 scriptParsed 事件导致 scriptUrls 不完整。
   */
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
      // Map CDP callFrame.location.lineNumber to our flat FrameInfo.lineNumber
      const rawFrames = params?.callFrames || [];
      this.currentPause = {
        frames: rawFrames.map((f: any) => ({
          callFrameId: f.callFrameId,
          functionName: f.functionName || '',
          url: f.url || '',
          lineNumber: f.location?.lineNumber ?? f.lineNumber ?? 0,
          columnNumber: f.location?.columnNumber ?? f.columnNumber ?? 0,
          scopeChain: f.scopeChain || [],
        })),
        stdout: '',
      };
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
      setTimeout(resolve, 8000);  // fallback — replay mode takes longer to init
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

  /*
   * 【CDP 消息分发】
   * CDP 使用 JSON-RPC 风格协议，消息分两类：
   * - 有 id 的：是之前 sendCDP() 请求的响应，通过 pendingRequests Map 匹配
   * - 有 method 的：是服务器推送的事件（如 Debugger.paused），分发给 cdpEventHandlers
   */
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

  /*
   * 收集每行代码的执行次数。
   * 原理：启动一个新的 replay 进程，开启 V8 Profiler 的精确覆盖率，
   * 运行到结束，然后读取 coverage 数据转换为 line → hitCount 映射。
   */
  async collectHitCounts(targetFile: string): Promise<Record<number, number>> {
    // Start a fresh replay process (no --inspect-brk, just run to completion)
    const { nodePath, env, scriptPath } = this.buildSpawnConfig();
    if (!scriptPath) return {};

    const header = parseRecordingHeader(this.opts.recordingPath);

    // Use --inspect-brk so we can start profiler BEFORE script runs
    const port = 9200 + Math.floor(Math.random() * 800);
    const nodeArgs: string[] = [`--inspect-brk=${port}`];
    if (header.randomSeed) nodeArgs.push(`--random-seed=${header.randomSeed}`);
    nodeArgs.push(scriptPath);

    const child = spawn(nodePath, nodeArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    // Wait for inspector
    await new Promise<void>((resolve) => {
      child.stderr?.on('data', (d: Buffer) => {
        if (d.toString().includes('Debugger listening')) resolve();
      });
      setTimeout(resolve, 8000);
    });

    // Use a completely independent WebSocket connection (don't touch this.ws)
    const wsUrl = await new Promise<string>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let body = '';
        res.on('data', (d: Buffer) => { body += d.toString(); });
        res.on('end', () => {
          try {
            const url = JSON.parse(body)[0]?.webSocketDebuggerUrl;
            url ? resolve(url) : reject(new Error('No WS URL'));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 8000);
    }).catch(() => '');

    if (!wsUrl) { child.kill(); return {}; }

    // Independent CDP connection for coverage collection
    const tmpWs = new WebSocket(wsUrl);
    let tmpId = 1;
    const tmpPending = new Map<number, { resolve: (v: any) => void }>();

    await new Promise<void>((resolve, reject) => {
      tmpWs.once('open', resolve);
      tmpWs.once('error', reject);
      setTimeout(reject, 5000);
    }).catch(() => { child.kill(); return {}; });

    tmpWs.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined) {
        const p = tmpPending.get(msg.id);
        if (p) { tmpPending.delete(msg.id); p.resolve(msg.result); }
      }
      // Auto-resume any pause (Break on start)
      if (msg.method === 'Debugger.paused') {
        tmpWs.send(JSON.stringify({ id: tmpId++, method: 'Debugger.resume', params: {} }));
      }
    });

    const tmpSend = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
      const id = tmpId++;
      return new Promise((resolve) => {
        tmpPending.set(id, { resolve });
        tmpWs.send(JSON.stringify({ id, method, params }));
        setTimeout(() => { tmpPending.delete(id); resolve(null); }, 15000);
      });
    };

    try {
      // Start profiler BEFORE script runs
      await tmpSend('Profiler.enable');
      await tmpSend('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
      await tmpSend('Runtime.enable');
      await tmpSend('Debugger.enable');
      await tmpSend('Runtime.runIfWaitingForDebugger');

      // Wait for script to finish
      await new Promise<void>((resolve) => {
        child.on('exit', () => resolve());
        setTimeout(resolve, 15000);
      });

      // Collect coverage
      const coverage = await tmpSend('Profiler.takePreciseCoverage');
      const scripts = coverage?.result || [];

      const counts: Record<number, number> = {};
      const filename = targetFile.split('/').pop() || targetFile;

      for (const script of scripts) {
        if (!script.url?.includes(filename)) continue;

        // Get source to map byte offsets to lines
        const src = await tmpSend('Debugger.getScriptSource', { scriptId: script.scriptId });
        const source: string = src?.scriptSource || '';
        if (!source) continue;

        const lineOffsets = [0];
        for (let i = 0; i < source.length; i++) {
          if (source[i] === '\n') lineOffsets.push(i + 1);
        }
        const offsetToLine = (offset: number) => {
          for (let i = lineOffsets.length - 1; i >= 0; i--) {
            if (lineOffsets[i] <= offset) return i;
          }
          return 0;
        };

        for (const func of script.functions) {
          for (const range of func.ranges) {
            if (range.count === 0) continue;
            const s = offsetToLine(range.startOffset);
            const e = offsetToLine(range.endOffset);
            for (let line = s; line <= e; line++) {
              counts[line] = Math.max(counts[line] || 0, range.count);
            }
          }
        }
      }
      return counts;
    } finally {
      tmpWs.close();
      child.kill();
    }
  }

  async runToCompletion(): Promise<number> {
    await this.resume();
    return new Promise((resolve) => this.once('exit', resolve));
  }

  /*
   * 【时间旅行核心】runToLine — 回退到指定位置
   *
   * 原理：因为回放是确定性的（时间/随机/网络都从录制数据返回），
   * "回退" 等价于杀掉当前进程 → 重新启动 → 运行到目标行。
   * 每次 runToLine 都是从头重放，但由于所有非确定性值都来自录制，
   * 程序一定会走到完全相同的执行路径。
   *
   * 性能：对短脚本（<1s）几乎无延迟。长脚本需要 checkpoint 优化（Phase 10.1）。
   */
  // Get PIDs of fork checkpoint children (from driver stderr output)
  private forkCheckpointPids: Array<{ pid: number; events: number }> = [];

  async runToLine(fileUrl: string, lineNumber: number): Promise<PauseState | null> {
    // Save checkpoint PIDs before stopping (they'll survive if we SIGCONT one first)
    const savedCheckpoints = [...this.forkCheckpointPids];

    // Try to restore from a fork checkpoint (if available).
    // SIGCONT the child BEFORE killing the parent, so the child wakes up
    // and blocks SIGTERM before the parent's atexit can kill it.
    let restoredFromCheckpoint = false;
    if (savedCheckpoints.length > 0 && this.child) {
      const cpChild = savedCheckpoints[savedCheckpoints.length - 1]; // latest checkpoint
      try {
        process.kill(cpChild.pid, 'SIGCONT');  // Wake checkpoint child
        restoredFromCheckpoint = true;
        process.stderr.write(`[engine] Restoring from checkpoint (pid ${cpChild.pid}, events ${cpChild.events})\n`);
      } catch {
        // Checkpoint child already dead
        restoredFromCheckpoint = false;
      }
    }

    // Kill the current main process
    await this.stop();
    this.scriptUrls.clear();
    this.cdpEventHandlers.clear();
    this.currentPause = null;
    this.nextMsgId = 1;

    if (restoredFromCheckpoint) {
      const cpChild = savedCheckpoints[savedCheckpoints.length - 1];
      // Give child time to resume and process the SIGCONT
      await new Promise(r => setTimeout(r, 300));

      // Send SIGUSR1 to activate Node.js inspector on port 9229
      try {
        process.kill(cpChild.pid, 'SIGUSR1');
        process.stderr.write(`[engine] Sent SIGUSR1 to checkpoint child ${cpChild.pid}\n`);
      } catch {
        process.stderr.write(`[engine] Checkpoint child died, falling back\n`);
        restoredFromCheckpoint = false;
      }
    }

    if (restoredFromCheckpoint) {
      const cpChild = savedCheckpoints[savedCheckpoints.length - 1];
      this.inspectorPort = 9229;
      this.forkCheckpointPids = [];
      this.child = null;

      // Wait for inspector to become available (SIGUSR1 → inspector takes ~1-2s)
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          await new Promise(r => setTimeout(r, 300));
          await this.connectWS();
          process.stderr.write(`[engine] Connected to checkpoint inspector!\n`);
          break;
        } catch {
          if (attempt === 19) {
            process.stderr.write(`[engine] Checkpoint inspector failed after 20 attempts, falling back\n`);
            try { process.kill(cpChild.pid, 9); } catch {}
            restoredFromCheckpoint = false;
          }
        }
      }
    }

    // Fall back: start fresh process
    if (!restoredFromCheckpoint) {
      this.forkCheckpointPids = [];
      const { nodePath, env, scriptPath } = this.buildSpawnConfig();
      this.inspectorPort = 9200 + Math.floor(Math.random() * 800);
      const header = parseRecordingHeader(this.opts.recordingPath);
      const nodeArgs: string[] = [`--inspect-brk=${this.inspectorPort}`];
      if (header.randomSeed) nodeArgs.push(`--random-seed=${header.randomSeed}`);
      nodeArgs.push(scriptPath || '-e void 0');

      this.child = spawn(nodePath, nodeArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString();
        const cpMatch = msg.match(/Fork checkpoint #(\d+) created \(child pid (\d+), events (\d+)\)/);
        if (cpMatch) {
          this.forkCheckpointPids.push({
            pid: parseInt(cpMatch[2], 10),
            events: parseInt(cpMatch[3], 10),
          });
        }
        process.stderr.write(`[child] ${msg}`);
        this.emit('stderr', msg);
      });
      // Capture stdout for console output up to the pause point
      this.capturedStdout = '';
      this.child.stdout?.on('data', (d: Buffer) => {
        this.capturedStdout += d.toString();
        this.emit('stdout', d.toString());
      });
      this.child.on('exit', (code) => this.emit('exit', code ?? 0));
    }

    await this.waitForInspector();

    // Register handlers
    this.onCDPEvent('Debugger.scriptParsed', (p: any) => {
      if (p?.url) this.scriptUrls.set(p.scriptId, p.url);
    });
    // Helper: map CDP callFrames to our FrameInfo (location.lineNumber → lineNumber)
    const mapFrames = (raw: any[]): any[] => raw.map((f: any) => ({
      callFrameId: f.callFrameId,
      functionName: f.functionName || '',
      url: f.url || '',
      lineNumber: f.location?.lineNumber ?? f.lineNumber ?? 0,
      columnNumber: f.location?.columnNumber ?? f.columnNumber ?? 0,
      scopeChain: f.scopeChain || [],
    }));

    let pauseReason = '';
    this.onCDPEvent('Debugger.paused', (p: any) => {
      pauseReason = p?.reason || '';
      this.currentPause = { frames: mapFrames(p?.callFrames || []), stdout: '' };
      this.emit('paused', this.currentPause);
    });
    this.onCDPEvent('Debugger.resumed', () => {
      this.currentPause = null;
    });

    await this.sendCDP('Runtime.enable');
    await this.sendCDP('Debugger.enable');
    await this.sendCDP('Runtime.runIfWaitingForDebugger');

    // Step 1: Wait for "Break on start" pause
    const gotInitialPause = await new Promise<boolean>((resolve) => {
      if (this.currentPause) { resolve(true); return; }
      const h = () => resolve(true);
      this.once('paused', h);
      setTimeout(() => { this.off('paused', h); resolve(false); }, 8000);
    });
    if (!gotInitialPause) return null;

    // Step 2: Set breakpoint (we're paused, so this is safe)
    // Use just the filename for matching (works with file:///private/tmp/... URLs)
    const filename = fileUrl.split('/').pop() || fileUrl;
    const urlRegex = `.*${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`;
    await this.sendCDP('Debugger.setBreakpointByUrl', { urlRegex, lineNumber });

    // Step 3: Resume past "Break on start"
    await this.resume();

    // Step 4: Wait for the REAL breakpoint hit (not "Break on start")
    return new Promise<PauseState | null>((resolve) => {
      const resolveWithStdout = (state: PauseState | null) => {
        if (state) {
          resolve({ ...state, stdout: this.capturedStdout });
        } else {
          resolve(null);
        }
      };

      const onPause = () => {
        if (!this.currentPause) return;
        if (pauseReason === 'Break on start') {
          this.resume().catch(() => {});
          return;
        }
        this.off('paused', onPause);
        resolveWithStdout(this.currentPause);
      };
      this.on('paused', onPause);
      if (this.currentPause && pauseReason !== 'Break on start') {
        resolveWithStdout(this.currentPause);
        return;
      }
      this.once('exit', () => { this.off('paused', onPause); resolve(null); });
      setTimeout(() => { this.off('paused', onPause); resolve(null); }, 15000);
    });
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

/*
 * 【录制文件头解析】
 * 读取 .orec 文件的 64 字节 header 和内嵌的 METADATA 事件。
 * METADATA 事件（type=0x20）可能出现在事件流的任意位置，
 * 需要扫描整个事件流才能找到。目前只提取 scriptPath 字段，
 * 用于 start()/run() 自动确定要回放的脚本。
 */
export function parseRecordingHeader(path: string): {
  magic: string;
  version: number;
  timestamp: number;
  buildId: string;
  scriptPath?: string;
  randomSeed?: number;
} {
  const buf = readFileSync(path);
  if (buf.length < 64) throw new Error('Recording file too small');

  const header = {
    magic: buf.subarray(0, 8).toString('ascii'),
    version: buf.readUInt32LE(8),
    timestamp: Number(buf.readBigUInt64LE(16)),
    buildId: buf.subarray(24, 56).toString('ascii').replace(/\0+$/, ''),
    scriptPath: undefined as string | undefined,
    randomSeed: undefined as number | undefined,
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
        if (json.randomSeed) header.randomSeed = json.randomSeed;
      } catch { /* ignore malformed metadata */ }
    }
    i += 9 + dataLen;
  }

  return header;
}
