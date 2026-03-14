// Open Replay — Replay Session
//
// Manages a single replay session: starts the ReplayEngine, tracks state,
// and provides the data layer for the protocol handler.

import { ReplayEngine, PauseState, parseRecordingHeader } from './replay-engine.js';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface ConsoleMessage {
  level: string;
  text: string;
  timestamp: number;
}

export class ReplaySession {
  private _recordingPath: string;
  private _sessionId: string;
  private _engine: ReplayEngine | null = null;
  private _consoleMessages: ConsoleMessage[] = [];
  private _started = false;
  private _header: ReturnType<typeof parseRecordingHeader> | null = null;

  constructor(recordingPath: string) {
    // Resolve recording path — could be UUID or full path
    if (!recordingPath.includes('/') && !recordingPath.startsWith('.')) {
      const dir = join(homedir(), '.openreplay', 'recordings');
      const withExt = recordingPath.endsWith('.orec')
        ? recordingPath : `${recordingPath}.orec`;
      const candidate = join(dir, withExt);
      this._recordingPath = existsSync(candidate) ? candidate : recordingPath;
    } else {
      this._recordingPath = recordingPath;
    }
    this._sessionId = globalThis.crypto?.randomUUID?.() ||
      `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      this._header = parseRecordingHeader(this._recordingPath);
    } catch { /* will fail properly in start() */ }
  }

  get id(): string { return this._sessionId; }
  get recordingPath(): string { return this._recordingPath; }
  get engine(): ReplayEngine | null { return this._engine; }

  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    if (!existsSync(this._recordingPath)) {
      throw new Error(`Recording not found: ${this._recordingPath}`);
    }

    this._header = parseRecordingHeader(this._recordingPath);
    console.log(`[session] Recording: ${this._header.magic} v${this._header.version}`);
    console.log(`[session] Timestamp: ${new Date(this._header.timestamp).toISOString()}`);
    console.log(`[session] Build: ${this._header.buildId || '(none)'}`);
    console.log(`[session] ID: ${this._sessionId}`);
  }

  // Start the replay engine (spawns Node.js process + connects inspector)
  async startEngine(): Promise<void> {
    if (this._engine) return;

    this._engine = new ReplayEngine({ recordingPath: this._recordingPath });

    this._engine.on('stderr', (msg: string) => {
      // Always log child stderr for debugging (filter out openreplay noise)
      if (!msg.startsWith('[openreplay]')) {
        process.stderr.write(`[engine stderr] ${msg}`);
      }
      for (const line of msg.split('\n')) {
        if (line.trim()) {
          this._consoleMessages.push({ level: 'log', text: line.trim(), timestamp: Date.now() });
        }
      }
    });

    this._engine.on('stdout', (msg: string) => {
      for (const line of msg.split('\n')) {
        if (line.trim()) {
          this._consoleMessages.push({ level: 'log', text: line.trim(), timestamp: Date.now() });
        }
      }
    });

    await this._engine.start();
    console.log(`[session] Engine started for ${this._sessionId}`);
  }

  getDescription(): Record<string, unknown> {
    return {
      sessionId: this._sessionId,
      recordingPath: this._recordingPath,
      timestamp: this._header?.timestamp || 0,
      buildId: this._header?.buildId || '',
      title: this._recordingPath.split('/').pop() || '',
      duration: 0,
    };
  }

  getSources(): Array<{ sourceId: string; url: string }> {
    if (!this._engine) return [];
    return Array.from(this._engine.scriptUrls.entries()).map(([id, url]) => ({
      sourceId: id,
      url,
    }));
  }

  getConsoleMessages(): ConsoleMessage[] {
    return this._consoleMessages;
  }

  getPauseState(): PauseState | null {
    return this._engine?.getPauseState() ?? null;
  }

  isPaused(): boolean {
    return this._engine?.isPaused() ?? false;
  }

  // Run the replay without debugger — just execute and capture output
  async runReplay(): Promise<{ exitCode: number; stdout: string; stderr: string; messages: unknown[] }> {
    const engine = new ReplayEngine({ recordingPath: this._recordingPath });
    engine.on('stdout', (msg: string) => {
      for (const line of msg.split('\n')) {
        if (line.trim()) this._consoleMessages.push({ level: 'log', text: line.trim(), timestamp: Date.now() });
      }
    });
    engine.on('stderr', (msg: string) => {
      if (!msg.startsWith('[openreplay]')) {
        for (const line of msg.split('\n')) {
          if (line.trim()) this._consoleMessages.push({ level: 'error', text: line.trim(), timestamp: Date.now() });
        }
      }
    });
    const result = await engine.run();
    return { ...result, messages: this.getConsoleMessages() };
  }

  async destroy(): Promise<void> {
    await this._engine?.stop();
    this._engine = null;
    console.log(`[session] Destroyed: ${this._sessionId}`);
  }
}

// List all recordings in ~/.openreplay/recordings
export function listRecordings(): Array<{
  id: string;
  path: string;
  timestamp: number;
  size: number;
  buildId: string;
}> {
  const dir = join(homedir(), '.openreplay', 'recordings');
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith('.orec'))
    .map(f => {
      const path = join(dir, f);
      try {
        const header = parseRecordingHeader(path);
        const { size } = statSync(path);
        return { id: f.replace('.orec', ''), path, timestamp: header.timestamp, size, buildId: header.buildId };
      } catch { return null; }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.timestamp - a.timestamp);
}
