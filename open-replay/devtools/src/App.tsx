import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ReplayClient, PauseFrame, ConsoleMessage, SourceInfo, RecordingInfo } from './protocol';
import { SourcePanel } from './panels/SourcePanel';
import { SourceTreePanel } from './panels/SourceTreePanel';
import { ControlBar } from './panels/ControlBar';
import { VariablesPanel } from './panels/VariablesPanel';
import { CallStackPanel } from './panels/CallStackPanel';
import { ConsolePanel } from './panels/ConsolePanel';
import { ConnectPanel } from './panels/ConnectPanel';
import { RecordingInfoBar } from './panels/RecordingInfoBar';
import { parseSourceMap, mapHitCountsToOriginal, SourceMapData, OriginalPosition } from './sourcemap';
import './styles.css';

export type SourceView = 'compiled' | 'original';

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
  recordingInfo: RecordingInfo | null;
  totalEvents: number;
  // SourceMap state
  sourceView: SourceView;
  sourceMap: SourceMapData | null;
  sourceMapLineMapping: Map<number, OriginalPosition> | null;
  originalSources: string[];
  originalSourceCode: string;
  originalSourceName: string;
  originalHitCounts: Record<number, number>;
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
    recordingInfo: null,
    totalEvents: 0,
    sourceView: 'compiled',
    sourceMap: null,
    sourceMapLineMapping: null,
    originalSources: [],
    originalSourceCode: '',
    originalSourceName: '',
    originalHitCounts: {},
  });

  const client = clientRef.current;

  // Use ref to avoid stale closure for sourceFile
  const sourceFileRef = useRef(state.sourceFile);
  sourceFileRef.current = state.sourceFile;

  // Helper: probe for sourcemap and update state
  const loadSourceMapForFile = useCallback(async (filePath: string) => {
    try {
      const rawMap = await client.getSourceMap(filePath);
      if (rawMap && rawMap.sources && rawMap.sources.length > 0) {
        const mapping = parseSourceMap(rawMap as SourceMapData);
        console.log('[devtools] SourceMap loaded:', rawMap.sources.length, 'original sources,', mapping.size, 'line mappings');
        setState(s => ({
          ...s,
          sourceMap: rawMap as SourceMapData,
          sourceMapLineMapping: mapping,
          originalSources: rawMap.sources,
          originalSourceCode: '',
          originalSourceName: '',
          sourceView: 'compiled',
          originalHitCounts: {},
        }));
        return { map: rawMap as SourceMapData, mapping };
      }
    } catch (err) {
      console.log('[devtools] No sourcemap for', filePath);
    }
    // Clear sourcemap state if none found
    setState(s => ({
      ...s,
      sourceMap: null,
      sourceMapLineMapping: null,
      originalSources: [],
      originalSourceCode: '',
      originalSourceName: '',
      sourceView: 'compiled',
      originalHitCounts: {},
    }));
    return null;
  }, [client]);

  // Load an original source from the sourcemap
  const loadOriginalSource = useCallback(async (sourceName: string) => {
    try {
      const sourceFile = sourceFileRef.current;
      const contents = await client.getOriginalSource(sourceFile, sourceName);
      if (contents) {
        setState(s => ({
          ...s,
          originalSourceCode: contents,
          originalSourceName: sourceName,
          sourceView: 'original',
          totalLines: contents.split('\n').length,
          originalHitCounts: s.sourceMapLineMapping
            ? mapHitCountsToOriginal(s.hitCounts, s.sourceMapLineMapping, sourceName)
            : {},
        }));
      }
    } catch (err) {
      console.error('[devtools] Failed to load original source:', err);
    }
  }, [client]);

  const switchToCompiled = useCallback(() => {
    setState(s => ({
      ...s,
      sourceView: 'compiled',
      totalLines: s.sourceCode ? s.sourceCode.split('\n').length : 0,
    }));
  }, []);

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

      // Extract total events from info if available
      const totalEvents = (info as any).totalEvents || (info as any).eventCount || 0;

      setState(s => ({
        ...s, connected: true, sources, loading: false,
        sourceCode, sourceFile,
        totalLines: sourceCode ? sourceCode.split('\n').length : 0,
        status: `Connected: ${info.title || scriptPath.split('/').pop()} -- collecting hit counts...`,
        recordingInfo: info,
        totalEvents,
      }));

      // Probe for sourcemap in background
      if (scriptPath) {
        loadSourceMapForFile(scriptPath).catch(() => {});
      }

      // Collect line execution counts in background
      if (scriptPath) {
        console.log('[devtools] Collecting hit counts for:', scriptPath);
        client.collectHitCounts(scriptPath).then(counts => {
          console.log('[devtools] Hit counts received:', Object.keys(counts).length, 'lines');
          setState(s => ({
            ...s,
            hitCounts: counts,
            status: s.status.replace(' -- collecting hit counts...', ''),
            originalHitCounts: s.sourceMapLineMapping && s.originalSourceName
              ? mapHitCountsToOriginal(counts, s.sourceMapLineMapping, s.originalSourceName)
              : {},
          }));
        }).catch(err => {
          console.error('[devtools] Hit count collection failed:', err);
        });
      }
    } catch (e: any) {
      setState(s => ({ ...s, status: `Error: ${e.message}`, loading: false }));
    }
  }, [client, loadSourceMapForFile]);

  const loadSource = useCallback(async (filePath: string) => {
    try {
      let contents = '';
      // Try reading as a local file path first
      try {
        contents = await client.readFile(filePath);
      } catch {}
      // Fallback: try getSourceContents using sourceId lookup
      if (!contents) {
        try {
          const sources = await client.getSources();
          const match = sources.find(s => s.url === filePath || s.sourceId === filePath);
          if (match) {
            contents = await client.getSourceContents(match.sourceId);
          }
        } catch {}
      }
      if (contents) {
        setState(prev => ({
          ...prev,
          sourceCode: contents,
          sourceFile: filePath,
          totalLines: contents.split('\n').length,
          // Reset sourcemap state when switching files
          sourceView: 'compiled',
          sourceMap: null,
          sourceMapLineMapping: null,
          originalSources: [],
          originalSourceCode: '',
          originalSourceName: '',
          originalHitCounts: {},
        }));
        // Probe for sourcemap on the new file
        loadSourceMapForFile(filePath).catch(() => {});
      }
    } catch {}
  }, [client, loadSourceMapForFile]);

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

  // Handle clicking a call stack frame — load that file and scroll to line
  const selectFrame = useCallback(async (frame: PauseFrame) => {
    if (!frame.url) return;
    // Resolve file path from URL (strip file:// prefix)
    const filePath = frame.url.replace(/^file:\/\//, '');
    const currentFile = sourceFileRef.current;
    // If it's a different file, load it
    if (filePath && filePath !== currentFile) {
      try {
        let contents = '';
        try {
          contents = await client.readFile(filePath);
        } catch {
          // Fallback: try getSourceContents with the URL as sourceId
          const sources = await client.getSources();
          const match = sources.find(s => s.url === frame.url);
          if (match) {
            contents = await client.getSourceContents(match.sourceId);
          }
        }
        if (contents) {
          setState(prev => ({
            ...prev,
            sourceCode: contents,
            sourceFile: filePath,
            totalLines: contents.split('\n').length,
            currentLine: frame.line,
          }));
          return;
        }
      } catch {}
    }
    // Same file or load failed — just highlight the line
    setState(prev => ({ ...prev, currentLine: frame.line }));
  }, [client]);

  // Run to completion: run the replay to the end and collect all console output
  const runToCompletion = useCallback(async () => {
    if (!client.connected) return;
    setState(s => ({ ...s, loading: true, status: 'Running to completion...' }));
    try {
      const result = await client.run();
      const messages: ConsoleMessage[] = result.messages || [];
      // If the server returned stdout as text, convert to console messages
      if (messages.length === 0 && result.stdout) {
        const lines = result.stdout.split('\n').filter((l: string) => l.length > 0);
        for (let i = 0; i < lines.length; i++) {
          messages.push({
            messageId: `run-${i}`,
            level: 'log',
            text: lines[i],
          });
        }
      }
      setState(s => ({
        ...s,
        loading: false,
        consoleMessages: messages,
        currentLine: null,
        frames: [],
        variables: {},
        status: `Completed (exit code: ${result.exitCode ?? 0}, ${messages.length} message${messages.length !== 1 ? 's' : ''})`,
      }));
    } catch (e: any) {
      setState(s => ({ ...s, loading: false, status: `Error: ${e.message}` }));
    }
  }, [client]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // F8 or Ctrl+Enter: step forward
      if (e.key === 'F8' && !e.shiftKey) {
        e.preventDefault();
        if (state.connected && state.currentLine !== null && !state.loading) {
          stepForward();
        }
        return;
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        if (state.connected && state.currentLine !== null && !state.loading) {
          stepForward();
        }
        return;
      }
      // Shift+F8: step backward
      if (e.key === 'F8' && e.shiftKey) {
        e.preventDefault();
        if (state.connected && state.currentLine !== null && state.currentLine > 0 && !state.loading) {
          stepBackward();
        }
        return;
      }
      // Escape: clear hover tooltip (handled by dispatching a custom event)
      if (e.key === 'Escape') {
        document.dispatchEvent(new CustomEvent('openreplay-clear-hover'));
        return;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.connected, state.currentLine, state.loading, stepForward, stepBackward]);

  // Determine which code and hit counts to display based on source view
  const displayCode = state.sourceView === 'original' && state.originalSourceCode
    ? state.originalSourceCode
    : state.sourceCode;
  const displayHitCounts = state.sourceView === 'original' && state.originalSourceCode
    ? state.originalHitCounts
    : state.hitCounts;
  const displayFileName = state.sourceView === 'original' && state.originalSourceName
    ? state.originalSourceName
    : state.sourceFile;

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
          <RecordingInfoBar info={state.recordingInfo} totalEvents={state.totalEvents} />
          <ControlBar
            currentLine={state.currentLine}
            totalLines={state.totalLines}
            loading={state.loading}
            onJumpToLine={jumpToLine}
            onStepForward={stepForward}
            onStepBackward={stepBackward}
            onJumpToStart={jumpToStart}
            onRunToCompletion={runToCompletion}
          />
          <div className="panels">
            <div className="source-tree-container">
              <SourceTreePanel
                sources={state.sources}
                currentFile={state.sourceFile}
                onSelectFile={loadSource}
              />
            </div>
            <div className="panel-left">
              {state.sourceFile && (
                <div className="source-file-header">
                  <span className="source-file-path">{displayFileName}</span>
                  {state.originalSources.length > 0 && (
                    <div className="source-view-tabs">
                      <button
                        className={`source-view-tab ${state.sourceView === 'compiled' ? 'active' : ''}`}
                        onClick={switchToCompiled}
                      >
                        Compiled
                      </button>
                      {state.originalSources.length === 1 ? (
                        <button
                          className={`source-view-tab ${state.sourceView === 'original' ? 'active' : ''}`}
                          onClick={() => loadOriginalSource(state.originalSources[0])}
                        >
                          Original
                        </button>
                      ) : (
                        <select
                          className={`source-view-select ${state.sourceView === 'original' ? 'active' : ''}`}
                          value={state.sourceView === 'original' ? state.originalSourceName : ''}
                          onChange={(e) => {
                            if (e.target.value) loadOriginalSource(e.target.value);
                          }}
                        >
                          <option value="">Original...</option>
                          {state.originalSources.map(src => (
                            <option key={src} value={src}>{src.split('/').pop()}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )}
              <SourcePanel
                code={displayCode}
                currentLine={state.currentLine}
                breakpoints={state.breakpoints}
                hitCounts={displayHitCounts}
                onToggleBreakpoint={toggleBreakpoint}
                onClickLine={jumpToLine}
                onLoadFile={loadSource}
                sourceFile={state.sourceFile}
                evaluate={state.frames.length > 0 ? evaluate : undefined}
              />
            </div>
            <div className="panel-right">
              <CallStackPanel frames={state.frames} onSelectFrame={selectFrame} />
              <VariablesPanel
                variables={state.variables}
                evaluate={evaluate}
                frameId={state.frames[0]?.frameId}
              />
              <ConsolePanel messages={state.consoleMessages} onJumpToLine={jumpToLine} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
