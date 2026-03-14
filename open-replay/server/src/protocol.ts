// Open Replay — CDP Protocol Handler
//
// Handles Chrome DevTools Protocol messages from the DevTools frontend.
// Routes to the ReplaySession/ReplayEngine for real data where available.

import { ReplaySession, listRecordings } from './session.js';

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
          // stdout contains console output produced up to this line
          const stdout = state.stdout || '';
          const consoleLines = stdout.split('\n').filter((l: string) => l.trim());
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
            console: consoleLines.map((text: string, i: number) => ({
              messageId: `stdout-${i}`,
              level: 'log',
              text,
            })),
          };
        } catch (e: any) {
          return { paused: false, frames: [], error: e.message };
        }
      }

      case 'Recording.runToCompletion': {
        if (engine) {
          const exitCode = await engine.runToCompletion();
          return { exitCode };
        }
        return { exitCode: 0 };
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
          return { counts };
        } catch (e: any) {
          return { counts: {}, error: e.message };
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
      case 'Internal.listRecordings':
        return { recordings: listRecordings() };

      default:
        throw new Error(`Method not implemented: ${method}`);
    }
  }
}
