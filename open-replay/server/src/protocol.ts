// Open Replay — CDP Protocol Handler
//
// Handles Chrome DevTools Protocol messages from the DevTools frontend.
// Routes to the ReplaySession/ReplayEngine for real data where available.

import { ReplaySession, listRecordings } from './session.js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

interface CDPMessage {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface CDPResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export class CDPProtocolHandler {
  private session: ReplaySession;

  constructor(session: ReplaySession) {
    this.session = session;
  }

  async handleMessage(message: CDPMessage): Promise<CDPResponse> {
    const { id, method, params } = message;
    try {
      const result = await this.dispatch(method, params || {});
      return { id, result };
    } catch (err: any) {
      return { id, error: { code: -32603, message: err.message || 'Internal error' } };
    }
  }

  private async dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const engine = this.session.engine;

    switch (method) {
      // --- Session ---
      case 'Session.createSession':
        return { sessionId: this.session.id };

      case 'Session.releaseSession':
        await this.session.destroy();
        return {};

      // --- Recording ---
      case 'Recording.getDescription':
        return this.session.getDescription();

      case 'Recording.getSources':
        return { sources: this.session.getSources() };

      // Read a local file by path (for loading script source in DevTools UI)
      case 'Recording.readFile': {
        const filePath = params.path as string;
        try {
          const { readFileSync } = await import('node:fs');
          const contents = readFileSync(filePath, 'utf8');
          return { contents, contentType: 'text/javascript' };
        } catch (e: any) {
          return { contents: '', error: e.message };
        }
      }

      case 'Recording.getSourceContents': {
        if (engine) {
          try {
            const result = await engine.sendCDP('Debugger.getScriptSource', {
              scriptId: params.sourceId,
            }) as any;
            return { contents: result?.scriptSource || '', contentType: 'text/javascript' };
          } catch { /* fall through */ }
        }
        return { contents: '', contentType: 'text/javascript' };
      }

      // --- Engine control ---
      case 'Recording.startEngine': {
        await this.session.startEngine();
        return { started: true };
      }

      // Run replay without debugger — just execute the script and capture output
      case 'Recording.run': {
        const result = await this.session.runReplay();
        return result;
      }

      case 'Recording.resume': {
        if (engine) await engine.resume();
        return {};
      }

      case 'Recording.stepOver': {
        if (engine) await engine.stepOver();
        return {};
      }

      case 'Recording.stepInto': {
        if (engine) await engine.stepInto();
        return {};
      }

      // Time travel: restart replay and run to a specific line
      case 'Recording.runToLine': {
        const file = params.file as string;
        const line = params.line as number;
        // Ensure engine object exists (don't start it — runToLine does its own start)
        this.session.ensureEngine();
        const eng = this.session.engine;
        if (!eng) throw new Error('Engine not available');
        try {
          const state = await eng.runToLine(file, line);
          if (!state) return { paused: false, frames: [], reason: 'timeout or script ended' };
          const top = state.frames[0];
          // Use CDP console messages (more reliable than stdout buffering)
          const cdpMessages = state.consoleMessages || [];
          // Fallback to stdout if no CDP messages
          let consoleOutput: Array<{ messageId: string; level: string; text: string }>;
          if (cdpMessages.length > 0) {
            consoleOutput = cdpMessages.map((m, i) => ({
              messageId: `cdp-${i}`,
              level: m.level === 'warning' ? 'warn' : m.level,
              text: m.text,
              line: (m as any).line,
            }));
          } else {
            const stdout = state.stdout || '';
            consoleOutput = stdout.split('\n')
              .filter((l: string) => l.trim())
              .map((text: string, i: number) => ({
                messageId: `stdout-${i}`,
                level: 'log',
                text,
              }));
          }
          return {
            paused: true,
            line: top?.lineNumber ?? -1,
            column: top?.columnNumber ?? 0,
            functionName: top?.functionName || '(anonymous)',
            frames: state.frames.map((f: any) => ({
              frameId: f.callFrameId,
              functionName: f.functionName,
              line: f.lineNumber,
              column: f.columnNumber,
              url: f.url,
            })),
            console: consoleOutput,
          };
        } catch (e: any) {
          return { paused: false, frames: [], error: e.message };
        }
      }

      // --- SourceMap support ---
      case 'Recording.getSourceMap': {
        const sourceUrl = params.sourceUrl as string;
        if (!sourceUrl) return { sourceMap: null };
        try {
          // Strategy 1: look for <sourceUrl>.map next to the source
          const mapPath = sourceUrl + '.map';
          if (existsSync(mapPath)) {
            const raw = readFileSync(mapPath, 'utf8');
            return { sourceMap: JSON.parse(raw) };
          }
          // Strategy 2: parse //# sourceMappingURL= from the source file
          if (existsSync(sourceUrl)) {
            const src = readFileSync(sourceUrl, 'utf8');
            const match = src.match(/\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)/);
            if (match) {
              const url = match[1];
              const resolved = url.startsWith('/') ? url : join(dirname(sourceUrl), url);
              if (existsSync(resolved)) {
                const raw = readFileSync(resolved, 'utf8');
                return { sourceMap: JSON.parse(raw) };
              }
            }
          }
        } catch { /* fall through */ }
        return { sourceMap: null };
      }

      case 'Recording.getOriginalSource': {
        const sourceMapUrl = params.sourceMapUrl as string;
        const originalSource = params.originalSource as string;
        if (!sourceMapUrl || !originalSource) return { contents: '' };
        try {
          if (!existsSync(sourceMapUrl)) return { contents: '' };
          const raw = readFileSync(sourceMapUrl, 'utf8');
          const map = JSON.parse(raw);
          const sources: string[] = map.sources || [];
          const sourcesContent: string[] = map.sourcesContent || [];
          const idx = sources.indexOf(originalSource);
          if (idx >= 0 && idx < sourcesContent.length) {
            return { contents: sourcesContent[idx] };
          }
          // Try matching by basename
          const baseName = originalSource.split('/').pop();
          const idx2 = sources.findIndex(s => s.split('/').pop() === baseName);
          if (idx2 >= 0 && idx2 < sourcesContent.length) {
            return { contents: sourcesContent[idx2] };
          }
        } catch { /* fall through */ }
        return { contents: '' };
      }

      case 'Recording.runToCompletion': {
        const runResult = await this.session.runReplay();
        const consoleMessages = runResult.messages as Array<{ level: string; text: string; timestamp?: number }>;
        return {
          exitCode: runResult.exitCode,
          console: consoleMessages.map((m, i) => ({
            messageId: `msg-${i}`,
            level: m.level,
            text: m.text,
          })),
        };
      }

      // --- Debugger ---
      case 'Debugger.setBreakpoint': {
        if (engine) {
          try {
            const loc = params.location as any;
            const result = await engine.sendCDP('Debugger.setBreakpoint', {
              location: {
                scriptId: loc?.sourceId,
                lineNumber: loc?.line || 0,
                columnNumber: loc?.column || 0,
              },
            }) as any;
            return {
              breakpointId: result?.breakpointId || `bp-${Date.now()}`,
              actualLocation: loc,
            };
          } catch { /* fall through */ }
        }
        const location = params.location as any;
        return {
          breakpointId: `bp-${location?.sourceId}-${location?.line}`,
          actualLocation: location,
        };
      }

      case 'Debugger.removeBreakpoint': {
        if (engine) {
          try {
            await engine.sendCDP('Debugger.removeBreakpoint', {
              breakpointId: params.breakpointId,
            });
          } catch { /* ignore */ }
        }
        return {};
      }

      // --- Pause ---
      case 'Pause.getAllFrames': {
        const pause = this.session.getPauseState();
        if (!pause) return { frames: [], data: {} };
        return {
          frames: pause.frames.map(f => ({
            frameId: f.callFrameId,
            functionName: f.functionName,
            location: {
              sourceId: f.url,
              line: f.lineNumber,
              column: f.columnNumber,
            },
          })),
          data: {},
        };
      }

      case 'Pause.getScope': {
        const pause = this.session.getPauseState();
        if (!pause || !engine) return { scopes: [], data: {} };
        const frameId = params.frameId as string;
        const frame = pause.frames.find(f => f.callFrameId === frameId);
        if (!frame) return { scopes: [], data: {} };

        const scopes: Array<{ type: string; bindings: Array<{ name: string; value: unknown; type: string }> }> = [];
        for (const scope of frame.scopeChain || []) {
          // Skip global scope (too many entries)
          if (scope.type === 'global') continue;
          if (!scope.object?.objectId) continue;
          try {
            const props = await engine.getProperties(scope.object.objectId) as any[];
            const SKIP_VARS = new Set(['exports', 'require', 'module', '__filename', '__dirname', 'arguments']);
            const bindings = props
              .filter((p: any) => p.name && !p.name.startsWith('__') && !SKIP_VARS.has(p.name))
              .map((p: any) => ({
                name: p.name,
                value: p.value?.value ?? p.value?.description ?? 'undefined',
                type: p.value?.type || 'unknown',
              }));
            if (bindings.length > 0) {
              scopes.push({ type: scope.type || 'unknown', bindings });
            }
          } catch { /* ignore */ }
        }
        return { scopes, data: {} };
      }

      case 'Pause.evaluateInFrame': {
        if (!engine) return { result: { value: undefined }, data: {} };
        const frameId = params.frameId as string | undefined;
        const expression = params.expression as string;
        try {
          const result = await engine.evaluate(expression, frameId);
          return { result: result as Record<string, unknown>, data: {} };
        } catch (e: any) {
          return { result: { type: 'error', description: e.message }, data: {} };
        }
      }

      case 'Pause.getObjectPreview': {
        if (!engine) return { data: {} };
        const objectId = params.objectId as string || params.object as string;
        if (!objectId) return { data: {} };
        try {
          const r = await engine.sendCDP('Runtime.getProperties', {
            objectId,
            ownProperties: true,
            generatePreview: true,
          }) as any;
          const properties = (r?.result || []).map((p: any) => ({
            name: p.name,
            value: p.value?.value ?? p.value?.description ?? 'undefined',
            type: p.value?.type || 'unknown',
            subtype: p.value?.subtype,
            objectId: p.value?.objectId,  // for nested expansion
          }));
          return { properties, data: {} };
        } catch {
          return { data: {} };
        }
      }

      // --- Console ---
      case 'Console.findMessages':
        return {
          messages: this.session.getConsoleMessages().map((m, i) => ({
            messageId: `msg-${i}`,
            level: m.level,
            text: m.text,
            timestamp: (m as any).timestamp,
            point: '0',
          })),
        };

      // Collect per-line execution counts by running replay with V8 coverage
      case 'Recording.collectHitCounts': {
        const file = params.file as string;
        this.session.ensureEngine();
        const eng = this.session.engine;
        if (!eng) throw new Error('Engine not available');
        try {
          const counts = await eng.collectHitCounts(file);

          // Warm up checkpoint pool in background (for fast backward jumps later)
          const totalLines = Object.keys(counts).length;
          if (totalLines > 0) {
            const info = await this.session.engine?.getRecordingInfo();
            const scriptPath = info?.header?.scriptPath;
            if (scriptPath) {
              this.session.checkpointPool.warmUp(totalLines, scriptPath).catch(() => {});
            }
          }

          return { counts };
        } catch (e: any) {
          return { counts: {}, error: e.message };
        }
      }

      // Get detailed recording info
      case 'Recording.getRecordingInfo': {
        const desc = this.session.getDescription();
        return desc;
      }

      // Step over (single statement forward)
      case 'Debugger.stepOver': {
        if (engine) {
          await engine.stepOver();
          // Wait for pause event
          await new Promise<void>((resolve) => {
            const h = () => resolve();
            engine!.once('paused', h);
            setTimeout(() => { engine!.off('paused', h); resolve(); }, 5000);
          });
          const pause = engine.getPauseState();
          if (pause) {
            const top = pause.frames[0];
            return {
              paused: true,
              frames: pause.frames.map((f: any) => ({
                frameId: f.callFrameId,
                functionName: f.functionName,
                line: f.lineNumber,
                column: f.columnNumber,
                url: f.url,
              })),
            };
          }
        }
        return { paused: false };
      }

      // Step into
      case 'Debugger.stepInto': {
        if (engine) {
          await engine.stepInto();
          await new Promise<void>((resolve) => {
            const h = () => resolve();
            engine!.once('paused', h);
            setTimeout(() => { engine!.off('paused', h); resolve(); }, 5000);
          });
          const pause = engine.getPauseState();
          if (pause) {
            const top = pause.frames[0];
            return {
              paused: true,
              frames: pause.frames.map((f: any) => ({
                frameId: f.callFrameId,
                functionName: f.functionName,
                line: f.lineNumber,
                column: f.columnNumber,
                url: f.url,
              })),
            };
          }
        }
        return { paused: false };
      }

      // Get specific object property (for lazy loading in variable tree)
      case 'Pause.getObjectProperty': {
        if (!engine) return { result: undefined };
        const objectId = params.objectId as string;
        const propertyName = params.name as string;
        try {
          const r = await engine.sendCDP('Runtime.getProperties', {
            objectId,
            ownProperties: true,
          }) as any;
          const prop = (r?.result || []).find((p: any) => p.name === propertyName);
          if (prop) {
            return {
              result: {
                value: prop.value?.value ?? prop.value?.description ?? 'undefined',
                type: prop.value?.type || 'unknown',
                objectId: prop.value?.objectId,
              },
            };
          }
          return { result: undefined };
        } catch {
          return { result: undefined };
        }
      }

      // --- Analysis (stub — requires V8 progress counter integration) ---
      case 'Analysis.createAnalysis':
        return { analysisId: `analysis-${Date.now()}` };

      case 'Analysis.addLocation':
      case 'Analysis.runAnalysis':
        return {};

      // --- Graphics (not applicable for Node.js) ---
      case 'Graphics.getPaintContents':
        return { data: '' };

      // --- Internal ---
      case 'Recording.listRecordings':
      case 'Internal.listRecordings':
        return { recordings: listRecordings() };

      default:
        throw new Error(`Method not implemented: ${method}`);
    }
  }
}
