import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ReplayClient, PauseFrame, ConsoleMessage, SourceInfo } from './protocol';
import { SourcePanel } from './panels/SourcePanel';
import { ControlBar } from './panels/ControlBar';
import { VariablesPanel } from './panels/VariablesPanel';
import { CallStackPanel } from './panels/CallStackPanel';
import { ConsolePanel } from './panels/ConsolePanel';
import { ConnectPanel } from './panels/ConnectPanel';
import './styles.css';

export type AppState = {
  connected: boolean;
  sourceCode: string;
  sourceFile: string;
  sources: SourceInfo[];
  currentLine: number | null;
  frames: PauseFrame[];
  variables: Record<string, unknown>;
  consoleMessages: ConsoleMessage[];
  hitCounts: Record<number, number>;
  breakpoints: Set<number>;
  loading: boolean;
  status: string;
  totalLines: number;
};

export function App() {
  const clientRef = useRef(new ReplayClient());
  const [state, setState] = useState<AppState>({
    connected: false,
    sourceCode: '',
    sourceFile: '',
    sources: [],
    currentLine: null,
    frames: [],
    variables: {},
    consoleMessages: [],
    hitCounts: {},
    breakpoints: new Set(),
    loading: false,
    status: 'Disconnected',
    totalLines: 0,
  });

  const client = clientRef.current;

  const connect = useCallback(async (url: string) => {
    try {
      setState(s => ({ ...s, status: 'Connecting...', loading: true }));
      await client.connect(url);
      client.onDisconnect = () => setState(s => ({ ...s, connected: false, status: 'Disconnected' }));

      const info = await client.getDescription();
      const sources = await client.getSources();

      // Auto-load the recorded script source
      const scriptPath = (info as any).scriptPath || (info as any).recordingPath || '';
      let sourceCode = '';
      let sourceFile = '';
      if (scriptPath) {
        try {
          sourceCode = await client.readFile(scriptPath);
          sourceFile = scriptPath;
        } catch {}
      }

      setState(s => ({
        ...s, connected: true, sources, loading: false,
        sourceCode, sourceFile,
        totalLines: sourceCode ? sourceCode.split('\n').length : 0,
        status: `Connected: ${info.title || scriptPath.split('/').pop()} — collecting hit counts...`,
      }));

      // Collect line execution counts in background
      if (scriptPath) {
        console.log('[devtools] Collecting hit counts for:', scriptPath);
        client.collectHitCounts(scriptPath).then(counts => {
          console.log('[devtools] Hit counts received:', Object.keys(counts).length, 'lines');
          setState(s => ({ ...s, hitCounts: counts, status: s.status.replace(' — collecting hit counts...', '') }));
        }).catch(err => {
          console.error('[devtools] Hit count collection failed:', err);
        });
      }
    } catch (e: any) {
      setState(s => ({ ...s, status: `Error: ${e.message}`, loading: false }));
    }
  }, [client]);

  const loadSource = useCallback(async (filePath: string) => {
    try {
      const contents = await client.readFile(filePath);
      if (contents) {
        setState(prev => ({
          ...prev,
          sourceCode: contents,
          sourceFile: filePath,
          totalLines: contents.split('\n').length,
        }));
      }
    } catch {}
  }, [client]);

  // Use ref to avoid stale closure for sourceFile
  const sourceFileRef = useRef(state.sourceFile);
  sourceFileRef.current = state.sourceFile;

  const jumpToLine = useCallback(async (line: number) => {
    if (!client.connected) return;
    const file = sourceFileRef.current;
    if (!file) { console.warn('No source file'); return; }
    setState(s => ({ ...s, loading: true, status: `Jumping to line ${line + 1}...` }));
    try {
      const result = await client.runToLine(file, line);
      if (result.paused && result.frames?.length) {
        const topFrame = result.frames[0];
        // Get scope variables via CDP
        let vars: Record<string, unknown> = {};
        try {
          const scopes = await client.getScope(topFrame.frameId);
          for (const scope of scopes) {
            for (const binding of scope.bindings) {
              vars[binding.name] = binding.value;
            }
          }
        } catch {}

        // Console output from runToLine = output produced up to this line
        const consoleOutput = (result as any).console || [];

        setState(s => ({
          ...s,
          currentLine: topFrame.line,
          frames: result.frames!,
          variables: vars,
          consoleMessages: consoleOutput,
          loading: false,
          status: `Paused at line ${topFrame.line + 1}`,
        }));
      } else {
        setState(s => ({ ...s, loading: false, status: 'Script completed (breakpoint not hit)' }));
      }
    } catch (e: any) {
      setState(s => ({ ...s, loading: false, status: `Error: ${e.message}` }));
    }
  }, [client]);

  const evaluate = useCallback(async (expression: string): Promise<string> => {
    if (!state.frames[0]) return 'No active frame';
    try {
      const result = await client.evaluateInFrame(state.frames[0].frameId, expression);
      const val = result?.result?.value;
      if (val !== undefined) return typeof val === 'string' ? val : JSON.stringify(val);
      return result?.result?.description || 'undefined';
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }, [client, state.frames]);

  const toggleBreakpoint = useCallback((line: number) => {
    setState(s => {
      const bp = new Set(s.breakpoints);
      if (bp.has(line)) bp.delete(line);
      else bp.add(line);
      return { ...s, breakpoints: bp };
    });
  }, []);

  const stepForward = useCallback(() => {
    if (state.currentLine !== null) {
      jumpToLine(state.currentLine + 1);
    }
  }, [state.currentLine, jumpToLine]);

  const stepBackward = useCallback(() => {
    if (state.currentLine !== null && state.currentLine > 0) {
      jumpToLine(state.currentLine - 1);
    }
  }, [state.currentLine, jumpToLine]);

  const jumpToStart = useCallback(() => jumpToLine(0), [jumpToLine]);

  return (
    <div className="app">
      <div className="toolbar">
        <span className="logo">Open Replay DevTools</span>
        <span className="status">{state.status}</span>
      </div>

      {!state.connected ? (
        <ConnectPanel onConnect={connect} />
      ) : (
        <>
          <ControlBar
            currentLine={state.currentLine}
            totalLines={state.totalLines}
            loading={state.loading}
            onJumpToLine={jumpToLine}
            onStepForward={stepForward}
            onStepBackward={stepBackward}
            onJumpToStart={jumpToStart}
          />
          <div className="panels">
            <div className="panel-left">
              {state.sourceFile && (
                <div style={{ padding: '4px 12px', fontSize: 11, color: '#888', background: '#252526', borderBottom: '1px solid #333' }}>
                  📄 {state.sourceFile}
                </div>
              )}
              <SourcePanel
                code={state.sourceCode}
                currentLine={state.currentLine}
                breakpoints={state.breakpoints}
                hitCounts={state.hitCounts}
                onToggleBreakpoint={toggleBreakpoint}
                onClickLine={jumpToLine}
                onLoadFile={loadSource}
                sourceFile={state.sourceFile}
                evaluate={state.frames.length > 0 ? evaluate : undefined}
              />
            </div>
            <div className="panel-right">
              <CallStackPanel frames={state.frames} />
              <VariablesPanel
                variables={state.variables}
                evaluate={evaluate}
                frameId={state.frames[0]?.frameId}
              />
              <ConsolePanel messages={state.consoleMessages} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
