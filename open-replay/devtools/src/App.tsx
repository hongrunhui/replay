import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ReplayClient, PauseFrame, ConsoleMessage, SourceInfo, RecordingInfo, NetworkRequest } from './protocol';
import { SourcePanel } from './panels/SourcePanel';
import { SidePanel } from './panels/SidePanel';
import { DebugPanel } from './panels/DebugPanel';
import { TimelineBar } from './panels/TimelineBar';
import { ConsolePanel } from './panels/ConsolePanel';
import { NetworkPanel } from './panels/NetworkPanel';
import { ConnectPanel } from './panels/ConnectPanel';
import { KeyboardShortcuts } from './panels/KeyboardShortcuts';
import { Step } from './panels/FrameStepsPanel';
import { parseSourceMap, mapHitCountsToOriginal, SourceMapData, OriginalPosition } from './sourcemap';
import './styles.css';

export type SourceView = 'compiled' | 'original';

type OpenFile = {
  path: string;
  content: string;
};

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
  sourceView: SourceView;
  sourceMap: SourceMapData | null;
  sourceMapLineMapping: Map<number, OriginalPosition> | null;
  originalSources: string[];
  originalSourceCode: string;
  originalSourceName: string;
  originalHitCounts: Record<number, number>;
  focusRange: { start: number; end: number } | null;
  sourceMapLoading: boolean;
  sourceMapError: string | null;
  networkRequests: NetworkRequest[];
  // Layout state
  bottomTab: 'console' | 'network' | 'search';
  openFiles: OpenFile[];
  activeFile: string;
  sidePanelCollapsed: boolean;
  debugPanelCollapsed: boolean;
  bottomPanelHeight: number;
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
    focusRange: null,
    sourceMapLoading: false,
    sourceMapError: null,
    networkRequests: [],
    bottomTab: 'console',
    openFiles: [],
    activeFile: '',
    sidePanelCollapsed: false,
    debugPanelCollapsed: false,
    bottomPanelHeight: 200,
  });

  const client = clientRef.current;
  const sourceFileRef = useRef(state.sourceFile);
  sourceFileRef.current = state.sourceFile;

  // ---- Source map helpers ----
  const loadSourceMapForFile = useCallback(async (filePath: string) => {
    setState(s => ({ ...s, sourceMapLoading: true, sourceMapError: null }));
    try {
      const rawMap = await client.getSourceMap(filePath);
      if (rawMap && rawMap.sources && rawMap.sources.length > 0) {
        const mapping = parseSourceMap(rawMap as SourceMapData);
        setState(s => ({
          ...s, sourceMap: rawMap as SourceMapData, sourceMapLineMapping: mapping,
          originalSources: rawMap.sources, originalSourceCode: '', originalSourceName: '',
          sourceView: 'compiled', originalHitCounts: {}, sourceMapLoading: false, sourceMapError: null,
        }));
        return { map: rawMap as SourceMapData, mapping };
      }
    } catch (err: any) {
      setState(s => ({
        ...s, sourceMap: null, sourceMapLineMapping: null, originalSources: [],
        originalSourceCode: '', originalSourceName: '', sourceView: 'compiled',
        originalHitCounts: {}, sourceMapLoading: false, sourceMapError: `Failed to load source map: ${err?.message || String(err)}`,
      }));
      return null;
    }
    setState(s => ({
      ...s, sourceMap: null, sourceMapLineMapping: null, originalSources: [],
      originalSourceCode: '', originalSourceName: '', sourceView: 'compiled',
      originalHitCounts: {}, sourceMapLoading: false, sourceMapError: null,
    }));
    return null;
  }, [client]);

  const loadOriginalSource = useCallback(async (sourceName: string) => {
    setState(s => ({ ...s, sourceMapLoading: true, sourceMapError: null }));
    try {
      const sourceFile = sourceFileRef.current;
      const contents = await client.getOriginalSource(sourceFile, sourceName);
      if (contents) {
        setState(s => ({
          ...s, originalSourceCode: contents, originalSourceName: sourceName,
          sourceView: 'original', totalLines: contents.split('\n').length,
          originalHitCounts: s.sourceMapLineMapping ? mapHitCountsToOriginal(s.hitCounts, s.sourceMapLineMapping, sourceName) : {},
          sourceMapLoading: false, sourceMapError: null,
        }));
      } else {
        setState(s => ({ ...s, sourceMapLoading: false, sourceMapError: `Original source "${sourceName}" is empty or could not be loaded` }));
      }
    } catch (err: any) {
      setState(s => ({ ...s, sourceMapLoading: false, sourceMapError: `Failed to load original source "${sourceName}": ${err?.message || String(err)}` }));
    }
  }, [client]);

  const switchToCompiled = useCallback(() => {
    setState(s => ({ ...s, sourceView: 'compiled', totalLines: s.sourceCode ? s.sourceCode.split('\n').length : 0 }));
  }, []);

  const setFocusRange = useCallback((range: { start: number; end: number } | null) => {
    setState(s => ({ ...s, focusRange: range }));
  }, []);

  // ---- File tab management ----
  const addOpenFile = useCallback((path: string, content: string) => {
    setState(s => {
      const exists = s.openFiles.find(f => f.path === path);
      if (exists) {
        // Update content and switch to it
        return {
          ...s,
          openFiles: s.openFiles.map(f => f.path === path ? { ...f, content } : f),
          activeFile: path,
        };
      }
      return {
        ...s,
        openFiles: [...s.openFiles, { path, content }],
        activeFile: path,
      };
    });
  }, []);

  const switchFile = useCallback((path: string) => {
    setState(s => {
      const file = s.openFiles.find(f => f.path === path);
      if (!file) return s;
      return {
        ...s,
        activeFile: path,
        sourceCode: file.content,
        sourceFile: path,
        totalLines: file.content.split('\n').length,
        sourceView: 'compiled',
        sourceMap: null, sourceMapLineMapping: null, originalSources: [],
        originalSourceCode: '', originalSourceName: '', originalHitCounts: {},
      };
    });
  }, []);

  const closeFile = useCallback((path: string) => {
    setState(s => {
      const newFiles = s.openFiles.filter(f => f.path !== path);
      let newActive = s.activeFile;
      let newCode = s.sourceCode;
      let newSourceFile = s.sourceFile;
      if (s.activeFile === path) {
        if (newFiles.length > 0) {
          const last = newFiles[newFiles.length - 1];
          newActive = last.path;
          newCode = last.content;
          newSourceFile = last.path;
        } else {
          newActive = '';
          newCode = '';
          newSourceFile = '';
        }
      }
      return {
        ...s,
        openFiles: newFiles,
        activeFile: newActive,
        sourceCode: newCode,
        sourceFile: newSourceFile,
        totalLines: newCode ? newCode.split('\n').length : 0,
      };
    });
  }, []);

  // ---- Connection ----
  const connect = useCallback(async (url: string) => {
    try {
      setState(s => ({ ...s, status: 'Connecting...', loading: true }));
      await client.connect(url);
      client.onDisconnect = () => setState(s => ({ ...s, connected: false, status: 'Disconnected' }));

      const info = await client.getDescription();
      const sources = await client.getSources();

      const scriptPath = (info as any).scriptPath || (info as any).recordingPath || '';
      let sourceCode = '';
      let sourceFile = '';
      if (scriptPath) {
        try { sourceCode = await client.readFile(scriptPath); sourceFile = scriptPath; } catch {}
      }

      const totalEvents = (info as any).totalEvents || (info as any).eventCount || 0;

      const openFiles: OpenFile[] = [];
      if (sourceCode && sourceFile) {
        openFiles.push({ path: sourceFile, content: sourceCode });
      }

      setState(s => ({
        ...s, connected: true, sources, loading: false,
        sourceCode, sourceFile,
        totalLines: sourceCode ? sourceCode.split('\n').length : 0,
        status: `Connected: ${info.title || scriptPath.split('/').pop()} -- collecting hit counts...`,
        recordingInfo: info, totalEvents,
        openFiles, activeFile: sourceFile,
      }));

      if (scriptPath) loadSourceMapForFile(scriptPath).catch(() => {});

      if (scriptPath) {
        client.collectHitCounts(scriptPath).then(counts => {
          setState(s => ({
            ...s, hitCounts: counts,
            status: s.status.replace(' -- collecting hit counts...', ''),
            originalHitCounts: s.sourceMapLineMapping && s.originalSourceName
              ? mapHitCountsToOriginal(counts, s.sourceMapLineMapping, s.originalSourceName) : {},
          }));
        }).catch(err => console.error('[devtools] Hit count collection failed:', err));
      }

      client.findNetworkRequests().then(requests => {
        setState(s => ({ ...s, networkRequests: requests }));
      }).catch(err => console.error('[devtools] Network request fetch failed:', err));
    } catch (e: any) {
      setState(s => ({ ...s, status: `Error: ${e.message}`, loading: false }));
    }
  }, [client, loadSourceMapForFile]);

  // ---- Load source file ----
  const loadSource = useCallback(async (filePath: string) => {
    try {
      let contents = '';
      try { contents = await client.readFile(filePath); } catch {}
      if (!contents) {
        try {
          const sources = await client.getSources();
          const match = sources.find(s => s.url === filePath || s.sourceId === filePath);
          if (match) contents = await client.getSourceContents(match.sourceId);
        } catch {}
      }
      if (contents) {
        addOpenFile(filePath, contents);
        setState(prev => ({
          ...prev, sourceCode: contents, sourceFile: filePath,
          totalLines: contents.split('\n').length,
          sourceView: 'compiled', sourceMap: null, sourceMapLineMapping: null,
          originalSources: [], originalSourceCode: '', originalSourceName: '', originalHitCounts: {},
        }));
        loadSourceMapForFile(filePath).catch(() => {});
      }
    } catch {}
  }, [client, loadSourceMapForFile, addOpenFile]);

  // ---- Jump to line ----
  const jumpToLine = useCallback(async (line: number) => {
    if (!client.connected) return;
    const file = sourceFileRef.current;
    if (!file) return;
    setState(s => ({ ...s, loading: true, status: `Jumping to line ${line + 1}...` }));
    try {
      const result = await client.runToLine(file, line);
      if (result.paused && result.frames?.length) {
        const topFrame = result.frames[0];
        let vars: Record<string, unknown> = {};
        try {
          const scopes = await client.getScope(topFrame.frameId);
          for (const scope of scopes) for (const binding of scope.bindings) vars[binding.name] = binding.value;
        } catch {}
        const consoleOutput = (result as any).console || [];
        setState(s => ({
          ...s, currentLine: topFrame.line, frames: result.frames!, variables: vars,
          consoleMessages: consoleOutput, loading: false, status: `Paused at line ${topFrame.line + 1}`,
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
      if (bp.has(line)) bp.delete(line); else bp.add(line);
      return { ...s, breakpoints: bp };
    });
  }, []);

  const stepForward = useCallback(() => {
    if (state.currentLine !== null) jumpToLine(state.currentLine + 1);
  }, [state.currentLine, jumpToLine]);

  const stepBackward = useCallback(() => {
    if (state.currentLine !== null && state.currentLine > 0) jumpToLine(state.currentLine - 1);
  }, [state.currentLine, jumpToLine]);

  const jumpToStart = useCallback(() => jumpToLine(0), [jumpToLine]);

  const selectFrame = useCallback(async (frame: PauseFrame) => {
    if (!frame.url) return;
    const filePath = frame.url.replace(/^file:\/\//, '');
    const currentFile = sourceFileRef.current;
    if (filePath && filePath !== currentFile) {
      try {
        let contents = '';
        try { contents = await client.readFile(filePath); } catch {
          const sources = await client.getSources();
          const match = sources.find(s => s.url === frame.url);
          if (match) contents = await client.getSourceContents(match.sourceId);
        }
        if (contents) {
          addOpenFile(filePath, contents);
          setState(prev => ({
            ...prev, sourceCode: contents, sourceFile: filePath,
            totalLines: contents.split('\n').length, currentLine: frame.line,
          }));
          return;
        }
      } catch {}
    }
    setState(prev => ({ ...prev, currentLine: frame.line }));
  }, [client, addOpenFile]);

  const runToCompletion = useCallback(async () => {
    if (!client.connected) return;
    setState(s => ({ ...s, loading: true, status: 'Running to completion...' }));
    try {
      const result = await client.run();
      const messages: ConsoleMessage[] = result.messages || [];
      if (messages.length === 0 && result.stdout) {
        const lines = result.stdout.split('\n').filter((l: string) => l.length > 0);
        for (let i = 0; i < lines.length; i++) {
          messages.push({ messageId: `run-${i}`, level: 'log', text: lines[i] });
        }
      }
      setState(s => ({
        ...s, loading: false, consoleMessages: messages, currentLine: null,
        frames: [], variables: {},
        status: `Completed (exit code: ${result.exitCode ?? 0}, ${messages.length} message${messages.length !== 1 ? 's' : ''})`,
      }));
    } catch (e: any) {
      setState(s => ({ ...s, loading: false, status: `Error: ${e.message}` }));
    }
  }, [client]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'F8' && !e.shiftKey) {
        e.preventDefault();
        if (state.connected && state.currentLine !== null && !state.loading) stepForward();
        return;
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        if (state.connected && state.currentLine !== null && !state.loading) stepForward();
        return;
      }
      if (e.key === 'F8' && e.shiftKey) {
        e.preventDefault();
        if (state.connected && state.currentLine !== null && state.currentLine > 0 && !state.loading) stepBackward();
        return;
      }
      if (e.key === 'Escape') {
        document.dispatchEvent(new CustomEvent('openreplay-clear-hover'));
        return;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.connected, state.currentLine, state.loading, stepForward, stepBackward]);

  // ---- Computed display values ----
  const displayCode = state.sourceView === 'original' && state.originalSourceCode
    ? state.originalSourceCode : state.sourceCode;
  const rawHitCounts = state.sourceView === 'original' && state.originalSourceCode
    ? state.originalHitCounts : state.hitCounts;
  const displayHitCounts = state.focusRange
    ? Object.fromEntries(Object.entries(rawHitCounts).filter(([line]) => {
        const l = Number(line);
        return l >= state.focusRange!.start && l <= state.focusRange!.end;
      }))
    : rawHitCounts;
  const displayFileName = state.sourceView === 'original' && state.originalSourceName
    ? state.originalSourceName : state.sourceFile;

  const frameSteps: Step[] = Object.entries(displayHitCounts)
    .map(([line]) => ({ line: +line, column: 0, kind: 'step' as const }))
    .sort((a, b) => a.line - b.line);

  // ---- Bottom panel resize ----
  const bottomPanelRef = useRef<HTMLDivElement>(null);
  const handleBottomResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = state.bottomPanelHeight;
    const onMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newHeight = Math.max(80, Math.min(600, startHeight + delta));
      setState(s => ({ ...s, bottomPanelHeight: newHeight }));
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [state.bottomPanelHeight]);

  // ---- Recording info for header ----
  const scriptName = state.recordingInfo
    ? ((state.recordingInfo as any).scriptPath?.split('/').pop() || state.recordingInfo.title || 'Unknown')
    : '';

  if (!state.connected) {
    return (
      <div className="devtools-app">
        <ConnectPanel onConnect={connect} />
      </div>
    );
  }

  return (
    <div className="devtools-app">
      {/* Header */}
      <div className="header">
        <div className="header-logo">
          <div className="header-logo-icon">OR</div>
          <span className="header-logo-text">Open Replay</span>
        </div>

        <div className="header-separator" />

        <div className="header-recording-info">
          {scriptName && (
            <div className="header-info-item">
              <span className="header-info-label">Script</span>
              <span className="header-info-value" title={(state.recordingInfo as any)?.scriptPath || ''}>{scriptName}</span>
            </div>
          )}
          {state.totalEvents > 0 && (
            <div className="header-info-item">
              <span className="header-info-label">Events</span>
              <span className="header-info-value">{state.totalEvents.toLocaleString()}</span>
            </div>
          )}
          {state.recordingInfo?.recordingPath && (
            <div className="header-info-item">
              <span className="header-info-label">Recording</span>
              <span className="header-info-value" title={state.recordingInfo.recordingPath}>
                {state.recordingInfo.recordingPath.split('/').pop()}
              </span>
            </div>
          )}
        </div>

        <span className={`header-status ${state.loading ? 'loading' : ''}`}>
          {state.status}
        </span>

        <div className="header-actions">
          {state.debugPanelCollapsed && (
            <button className="panel-toggle-btn" onClick={() => setState(s => ({ ...s, debugPanelCollapsed: false }))}
              title="Show debugger">
              {'\u25C0'}
            </button>
          )}
          <KeyboardShortcuts />
        </div>
      </div>

      {/* Side Panel */}
      <SidePanel
        sources={state.sources}
        currentFile={state.sourceFile}
        onSelectFile={loadSource}
        breakpoints={state.breakpoints}
        onToggleBreakpoint={toggleBreakpoint}
        consoleMessages={state.consoleMessages}
        onJumpToLine={jumpToLine}
        collapsed={state.sidePanelCollapsed}
        onToggleCollapse={() => setState(s => ({ ...s, sidePanelCollapsed: !s.sidePanelCollapsed }))}
      />

      {/* Main Area */}
      <div className="main-area">
        {/* Source file header with sourcemap controls */}
        {state.sourceFile && (
          <div className="source-file-header">
            <span className="source-file-path">
              {displayFileName}
              {state.sourceView === 'original' && state.originalSourceName && (
                <span className="original-source-badge">
                  {' '}(original: {state.originalSourceName.split('/').pop()})
                </span>
              )}
            </span>
            {state.sourceMapLoading && (
              <span className="sourcemap-status loading">Loading source map...</span>
            )}
            {state.sourceMapError && (
              <span className="sourcemap-status error" title={state.sourceMapError}>
                {state.sourceMapError}
              </span>
            )}
            {!state.sourceMapLoading && !state.sourceMapError && state.originalSources.length > 0 && (
              <div className="source-view-tabs">
                <button
                  className={`source-view-tab ${state.sourceView === 'compiled' ? 'active' : ''}`}
                  onClick={switchToCompiled}
                >Compiled</button>
                {state.originalSources.length === 1 ? (
                  <button
                    className={`source-view-tab ${state.sourceView === 'original' ? 'active' : ''}`}
                    onClick={() => loadOriginalSource(state.originalSources[0])}
                  >Original ({state.originalSources[0].split('/').pop()})</button>
                ) : (
                  <select
                    className={`source-view-select ${state.sourceView === 'original' ? 'active' : ''}`}
                    value={state.sourceView === 'original' ? state.originalSourceName : ''}
                    onChange={(e) => { if (e.target.value) loadOriginalSource(e.target.value); }}
                  >
                    <option value="">Original ({state.originalSources.length} sources)...</option>
                    {state.originalSources.map(src => (
                      <option key={src} value={src}>{src.split('/').pop()}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        )}

        {/* Source Panel with file tabs */}
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
          openFiles={state.openFiles}
          activeFile={state.activeFile}
          onSwitchFile={switchFile}
          onCloseFile={closeFile}
        />

        {/* Bottom Panel */}
        <div className="bottom-panel" ref={bottomPanelRef} style={{ height: state.bottomPanelHeight }}>
          <div className="bottom-panel-resize" onMouseDown={handleBottomResize} />
          <div className="bottom-tab-bar">
            <button
              className={`bottom-tab-btn ${state.bottomTab === 'console' ? 'active' : ''}`}
              onClick={() => setState(s => ({ ...s, bottomTab: 'console' }))}
            >Console</button>
            <button
              className={`bottom-tab-btn ${state.bottomTab === 'network' ? 'active' : ''}`}
              onClick={() => setState(s => ({ ...s, bottomTab: 'network' }))}
            >Network</button>
          </div>
          <div className="bottom-panel-content">
            {state.bottomTab === 'console' ? (
              <ConsolePanel messages={state.consoleMessages} onJumpToLine={jumpToLine} />
            ) : (
              <NetworkPanel requests={state.networkRequests} />
            )}
          </div>
        </div>
      </div>

      {/* Debug Panel (Right) */}
      <DebugPanel
        frames={state.frames}
        onSelectFrame={selectFrame}
        variables={state.variables}
        evaluate={evaluate}
        frameId={state.frames[0]?.frameId}
        paused={state.frames.length > 0}
        frameSteps={frameSteps}
        currentLine={state.currentLine}
        onJumpToStep={jumpToLine}
        collapsed={state.debugPanelCollapsed}
        onToggleCollapse={() => setState(s => ({ ...s, debugPanelCollapsed: !s.debugPanelCollapsed }))}
      />

      {/* Timeline Bar */}
      <TimelineBar
        currentLine={state.currentLine}
        totalLines={state.totalLines}
        loading={state.loading}
        onJumpToLine={jumpToLine}
        onStepForward={stepForward}
        onStepBackward={stepBackward}
        onJumpToStart={jumpToStart}
        onRunToCompletion={runToCompletion}
        focusRange={state.focusRange}
        onSetFocusRange={setFocusRange}
        consoleMessages={state.consoleMessages}
      />
    </div>
  );
}
