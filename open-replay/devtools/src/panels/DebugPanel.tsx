import React, { useState, useCallback } from 'react';
import { PauseFrame } from '../protocol';
import { Step } from './FrameStepsPanel';

type VarEntry = { name: string; value: unknown; type?: string; objectId?: string; className?: string; description?: string; subtype?: string };

type Props = {
  frames: PauseFrame[];
  onSelectFrame: (frame: PauseFrame) => void;
  variables: Record<string, unknown>;
  evaluate: (expr: string) => Promise<string>;
  frameId?: string;
  onExpandObject?: (objectId: string) => Promise<VarEntry[]>;
  paused: boolean;
  frameSteps: Step[];
  currentLine: number | null;
  onJumpToStep: (line: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

// ---- Section state ----
type SectionKey = 'scopes' | 'callstack' | 'watch' | 'framesteps';

// ---- Variable formatting (from VariablesPanel) ----
function formatObjectHeader(value: unknown, type?: string, className?: string, description?: string, subtype?: string): React.ReactNode {
  if (className === 'Array' || subtype === 'array') {
    return <span className="var-type-object var-obj-header">{description || (typeof value === 'string' ? value : 'Array')}</span>;
  }
  if (className === 'Map') return <span className="var-type-object var-obj-header">{description || 'Map'}</span>;
  if (className === 'Set') return <span className="var-type-object var-obj-header">{description || 'Set'}</span>;
  if (className === 'Date' || subtype === 'date') return <span className="var-type-date">{description || (typeof value === 'string' ? value : 'Date')}</span>;
  if (className === 'RegExp' || subtype === 'regexp') return <span className="var-type-regexp">{description || (typeof value === 'string' ? value : '/.../')}</span>;
  if (className === 'Error' || subtype === 'error' || (className && className.endsWith('Error')))
    return <span className="var-type-error">{description || (typeof value === 'string' ? value : className || 'Error')}</span>;
  if (type === 'function') {
    if (typeof value === 'string') return <span className="var-type-function">{value.split('\n')[0].slice(0, 80)}</span>;
    return <span className="var-type-function">f {description || className || ''}()</span>;
  }
  return null;
}

function formatValue(value: unknown, type?: string, className?: string, description?: string, subtype?: string): React.ReactNode {
  if (value === null) return <span className="var-type-undefined">null</span>;
  if (value === undefined) return <span className="var-type-undefined">undefined</span>;
  const objHeader = formatObjectHeader(value, type, className, description, subtype);
  if (objHeader) return objHeader;
  if (type === 'function') return <span className="var-type-function">{typeof value === 'string' ? value.split('\n')[0].slice(0, 60) : 'f()'}</span>;
  if (type === 'object') return <span className="var-type-object">{typeof value === 'string' ? value : JSON.stringify(value)}</span>;
  if (typeof value === 'string') return <span className="var-type-string">"{value}"</span>;
  if (typeof value === 'number') return <span className="var-type-number">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="var-type-boolean">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function VarRow({ name, value, type, objectId, className: objClassName, description, subtype, depth = 0, onExpand }: {
  name: string; value: unknown; type?: string; objectId?: string;
  className?: string; description?: string; subtype?: string;
  depth?: number; onExpand?: (objectId: string) => Promise<VarEntry[]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<VarEntry[]>([]);
  const isExpandable = objectId && (type === 'object' || type === 'function');

  const toggle = async () => {
    if (!isExpandable || !onExpand) return;
    if (!expanded) { const props = await onExpand(objectId!); setChildren(props); }
    setExpanded(!expanded);
  };

  const isArray = objClassName === 'Array' || subtype === 'array';

  return (
    <>
      <div className="var-row" style={{ paddingLeft: depth * 16 }}>
        {isExpandable ? (
          <span className="var-expand" onClick={toggle}>{expanded ? '\u25BC' : '\u25B6'}</span>
        ) : (
          <span className="var-expand-empty" />
        )}
        <span className="var-name">{name}</span>
        <span className="var-eq">:</span>
        <span className="var-value-container">{formatValue(value, type, objClassName, description, subtype)}</span>
      </div>
      {expanded && children.map((child, i) => {
        let childName = child.name;
        if (isArray && /^\d+$/.test(child.name)) childName = `[${child.name}]`;
        return (
          <VarRow key={`${name}.${child.name}.${i}`} name={childName} value={child.value} type={child.type}
            objectId={child.objectId} className={child.className} description={child.description}
            subtype={child.subtype} depth={depth + 1} onExpand={onExpand} />
        );
      })}
    </>
  );
}

function extractFileName(url?: string): string {
  if (!url) return '';
  const cleaned = url.replace(/^file:\/\//, '');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || '';
}

// ---- Watch sub-component ----
let nextWatchId = 1;
type WatchEntry = { id: number; expression: string; value: string; error: boolean };

function WatchSection({ evaluate, paused }: { evaluate: (expr: string) => Promise<string>; paused: boolean }) {
  const [watches, setWatches] = useState<WatchEntry[]>([]);
  const [input, setInput] = useState('');

  const refreshAll = useCallback(async () => {
    if (watches.length === 0) return;
    const updated = await Promise.all(
      watches.map(async (w) => {
        try {
          const result = await evaluate(w.expression);
          return { ...w, value: result, error: result.startsWith('Error:') };
        } catch (e: any) {
          return { ...w, value: `Error: ${e.message}`, error: true };
        }
      })
    );
    setWatches(updated);
  }, [watches, evaluate]);

  const addWatch = useCallback(async () => {
    const expr = input.trim();
    if (!expr) return;
    setInput('');
    let value = '<not paused>';
    let error = false;
    if (paused) {
      try { value = await evaluate(expr); error = value.startsWith('Error:'); }
      catch (e: any) { value = `Error: ${e.message}`; error = true; }
    }
    setWatches(prev => [...prev, { id: nextWatchId++, expression: expr, value, error }]);
  }, [input, evaluate, paused]);

  return (
    <div>
      {watches.length === 0 && <div className="panel-empty">Add expressions to watch</div>}
      {watches.map(w => (
        <div key={w.id} className="watch-row">
          <span className="watch-expr" title={w.expression}>{w.expression}</span>
          <span className="watch-eq">=</span>
          <span className={`watch-value ${w.error ? 'watch-error' : ''}`}>{w.value}</span>
          <button className="watch-remove" onClick={() => setWatches(prev => prev.filter(x => x.id !== w.id))} title="Remove">x</button>
        </div>
      ))}
      <div className="watch-input">
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Add watch expression..."
          onKeyDown={e => { if (e.key === 'Enter') addWatch(); }} />
        <button onClick={addWatch} title="Add watch">+</button>
      </div>
      {watches.length > 0 && (
        <button className="watch-refresh-btn" onClick={refreshAll} disabled={!paused} style={{ marginTop: 4 }}>
          Refresh All
        </button>
      )}
    </div>
  );
}

// ---- Main DebugPanel ----
export function DebugPanel({
  frames, onSelectFrame, variables, evaluate, frameId, onExpandObject,
  paused, frameSteps, currentLine, onJumpToStep,
  collapsed, onToggleCollapse,
}: Props) {
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    scopes: true, callstack: true, watch: true, framesteps: false,
  });

  const toggle = (key: SectionKey) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const userFrames = frames.filter(f =>
    !f.functionName?.startsWith('Module.') &&
    f.functionName !== 'executeUserEntryPoint' &&
    f.functionName !== 'wrapModuleLoad'
  );

  const entries = Object.entries(variables);

  // Evaluate input
  const [expr, setExpr] = useState('');
  const [evalResults, setEvalResults] = useState<Array<{ expr: string; result: string }>>([]);
  const onEval = useCallback(async () => {
    if (!expr.trim()) return;
    const result = await evaluate(expr);
    setEvalResults(prev => [...prev, { expr, result }]);
    setExpr('');
  }, [expr, evaluate]);

  if (collapsed) {
    return (
      <div className="debug-panel collapsed" />
    );
  }

  return (
    <div className="debug-panel">
      {/* Toggle button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 4px 0' }}>
        <button className="panel-toggle-btn" onClick={onToggleCollapse} title="Collapse debugger">
          {'\u25B6'}
        </button>
      </div>

      {/* Scopes / Variables */}
      <div className="debug-panel-section">
        <div className="debug-panel-header" onClick={() => toggle('scopes')}>
          <span className={`debug-panel-arrow ${openSections.scopes ? 'open' : ''}`}>{'\u25B6'}</span>
          <span className="debug-panel-header-text">Scopes</span>
          {entries.length > 0 && <span className="debug-panel-header-badge">{entries.length}</span>}
        </div>
        {openSections.scopes && (
          <div className="debug-panel-body">
            {entries.length === 0 && !frameId && <div className="panel-empty">Click a line to see variables</div>}
            {entries.map(([name, rawVal]) => {
              const val = rawVal as any;
              const isEnhanced = val && typeof val === 'object' && ('__type' in val || '__className' in val || '__objectId' in val);
              if (isEnhanced) {
                return (
                  <VarRow key={name} name={name} value={val.__description || val.__value || val}
                    type={val.__type || typeof val} objectId={val.__objectId} className={val.__className}
                    description={val.__description} subtype={val.__subtype} onExpand={onExpandObject} />
                );
              }
              return <VarRow key={name} name={name} value={rawVal} type={typeof rawVal} onExpand={onExpandObject} />;
            })}
            <div className="eval-input">
              <input value={expr} onChange={e => setExpr(e.target.value)} placeholder="Evaluate expression..."
                onKeyDown={e => e.key === 'Enter' && onEval()} />
              <button onClick={onEval}>Eval</button>
            </div>
            {evalResults.map((r, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, color: '#666' }}>&gt; {r.expr}</div>
                <div className="eval-result">{r.result}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Call Stack */}
      <div className="debug-panel-section">
        <div className="debug-panel-header" onClick={() => toggle('callstack')}>
          <span className={`debug-panel-arrow ${openSections.callstack ? 'open' : ''}`}>{'\u25B6'}</span>
          <span className="debug-panel-header-text">Call Stack</span>
          {userFrames.length > 0 && <span className="debug-panel-header-badge">{userFrames.length}</span>}
        </div>
        {openSections.callstack && (
          <div className="debug-panel-body">
            {userFrames.length === 0 && <div className="panel-empty">Click a line to see call stack</div>}
            {userFrames.map((frame, i) => {
              const fileName = extractFileName(frame.url);
              return (
                <div key={i} className={`frame-row ${i === 0 ? 'active' : ''}`}
                  onClick={() => onSelectFrame(frame)}
                  title={frame.url ? `${frame.url}:${(frame.line ?? 0) + 1}` : undefined}>
                  <span className="frame-index">{i}</span>
                  <span className="frame-name">{frame.functionName || '(anonymous)'}</span>
                  {fileName && <span className="frame-file">{fileName}</span>}
                  <span className="frame-loc">:{(frame.line ?? 0) + 1}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Watch Expressions */}
      <div className="debug-panel-section">
        <div className="debug-panel-header" onClick={() => toggle('watch')}>
          <span className={`debug-panel-arrow ${openSections.watch ? 'open' : ''}`}>{'\u25B6'}</span>
          <span className="debug-panel-header-text">Watch</span>
        </div>
        {openSections.watch && (
          <div className="debug-panel-body">
            <WatchSection evaluate={evaluate} paused={paused} />
          </div>
        )}
      </div>

      {/* Frame Steps */}
      <div className="debug-panel-section">
        <div className="debug-panel-header" onClick={() => toggle('framesteps')}>
          <span className={`debug-panel-arrow ${openSections.framesteps ? 'open' : ''}`}>{'\u25B6'}</span>
          <span className="debug-panel-header-text">Frame Steps</span>
          {frameSteps.length > 0 && <span className="debug-panel-header-badge">{frameSteps.length}</span>}
        </div>
        {openSections.framesteps && (
          <div className="debug-panel-body frame-steps-body">
            {frameSteps.length === 0 ? (
              <div className="panel-empty">No steps available</div>
            ) : (
              frameSteps.map((step, i) => {
                const isCurrent = currentLine !== null && step.line === currentLine;
                return (
                  <div key={i} className={`frame-step-row ${isCurrent ? 'active' : ''}`} onClick={() => onJumpToStep(step.line)}>
                    <span className="frame-step-icon">
                      {step.kind === 'call' ? '\u2192' : step.kind === 'return' ? '\u2190' : '\u2022'}
                    </span>
                    <span className="frame-step-line">Line {step.line + 1}</span>
                    <span className="frame-step-kind">{step.kind}</span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
