// WebSocket protocol client for the Open Replay server

export type PauseFrame = {
  frameId: string;
  functionName: string;
  line: number;
  column?: number;
  url?: string;
};

export type RunToLineResult = {
  paused: boolean;
  line?: number;
  frames?: PauseFrame[];
  reason?: string;
};

export type ConsoleMessage = {
  messageId: string;
  level: string;
  text: string;
  timestamp?: number;
  line?: number;
};

export type RecordingInfo = {
  sessionId: string;
  recordingPath: string;
  timestamp: number;
  buildId: string;
  title: string;
};

export type SourceInfo = {
  sourceId: string;
  url: string;
};

export class ReplayClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private _connected = false;

  onDisconnect?: () => void;

  get connected() { return this._connected; }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => { this._connected = true; resolve(); };
      this.ws.onerror = () => reject(new Error('WebSocket error'));
      this.ws.onclose = () => { this._connected = false; this.onDisconnect?.(); };
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      };
    });
  }

  private send(method: string, params?: Record<string, unknown>): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Not connected'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Request timeout'));
      }, 30000);
      this.pending.set(id, {
        resolve: (v: any) => { clearTimeout(timeout); resolve(v); },
        reject: (e: Error) => { clearTimeout(timeout); reject(e); },
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async getDescription(): Promise<RecordingInfo> {
    return this.send('Recording.getDescription');
  }

  async getSources(): Promise<SourceInfo[]> {
    const r = await this.send('Recording.getSources');
    return r?.sources || [];
  }

  async getSourceContents(sourceId: string): Promise<string> {
    const r = await this.send('Recording.getSourceContents', { sourceId });
    return r?.contents || '';
  }

  async startEngine(): Promise<void> {
    await this.send('Recording.startEngine');
  }

  async runToLine(file: string, line: number): Promise<RunToLineResult> {
    return this.send('Recording.runToLine', { file, line });
  }

  async getScope(frameId: string): Promise<Array<{ type: string; bindings: Array<{ name: string; value: unknown; type: string }> }>> {
    const r = await this.send('Pause.getScope', { frameId });
    return r?.scopes || [];
  }

  async evaluateInFrame(frameId: string, expression: string): Promise<any> {
    return this.send('Pause.evaluateInFrame', { frameId, expression });
  }

  async getConsoleMessages(): Promise<ConsoleMessage[]> {
    const r = await this.send('Console.findMessages');
    return r?.messages || [];
  }

  async getSourceMap(sourceUrl: string): Promise<any> {
    const r = await this.send('Recording.getSourceMap', { sourceUrl });
    return r?.sourceMap || null;
  }

  async getOriginalSource(sourceMapUrl: string, originalSource: string): Promise<string> {
    const r = await this.send('Recording.getOriginalSource', { sourceMapUrl, originalSource });
    return r?.contents || '';
  }

  async collectHitCounts(file: string): Promise<Record<number, number>> {
    // This spawns a replay process with profiler — can take 15+ seconds
    const r = await this.sendWithTimeout('Recording.collectHitCounts', { file }, 60000);
    return r?.counts || {};
  }

  private sendWithTimeout(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Not connected'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Request timeout'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v: any) => { clearTimeout(timeout); resolve(v); },
        reject: (e: Error) => { clearTimeout(timeout); reject(e); },
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async readFile(path: string): Promise<string> {
    const r = await this.send('Recording.readFile', { path });
    return r?.contents || '';
  }

  async run(): Promise<{ exitCode: number; stdout: string; messages: ConsoleMessage[] }> {
    return this.send('Recording.run');
  }

  async runToCompletion(): Promise<{ exitCode: number }> {
    return this.sendWithTimeout('Recording.runToCompletion', {}, 60000);
  }

  async stepOver(): Promise<any> {
    return this.send('Debugger.stepOver');
  }

  async stepInto(): Promise<any> {
    return this.send('Debugger.stepInto');
  }

  async setBreakpoint(sourceId: string, line: number): Promise<{ breakpointId: string }> {
    return this.send('Debugger.setBreakpoint', { location: { sourceId, line } });
  }

  async getObjectPreview(objectId: string): Promise<Array<{ name: string; value: unknown; type: string; objectId?: string }>> {
    const r = await this.send('Pause.getObjectPreview', { objectId });
    return r?.properties || [];
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }
}
