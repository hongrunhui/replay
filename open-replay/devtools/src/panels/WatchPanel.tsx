import React, { useState, useEffect, useCallback, useRef } from 'react';

type WatchEntry = {
  id: number;
  expression: string;
  value: string;
  error: boolean;
};

type Props = {
  evaluate: (expr: string) => Promise<string>;
  paused: boolean;  // whether we're at a pause point
};

let nextWatchId = 1;

export function WatchPanel({ evaluate, paused }: Props) {
  const [watches, setWatches] = useState<WatchEntry[]>([]);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-evaluate all watches when pause state changes (new frame)
  useEffect(() => {
    if (!paused) return;
    refreshAll();
  }, [paused]);

  const refreshAll = useCallback(async () => {
    if (watches.length === 0) return;
    const updated = await Promise.all(
      watches.map(async (w) => {
        try {
          const result = await evaluate(w.expression);
          const isError = result.startsWith('Error:');
          return { ...w, value: result, error: isError };
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
      try {
        value = await evaluate(expr);
        error = value.startsWith('Error:');
      } catch (e: any) {
        value = `Error: ${e.message}`;
        error = true;
      }
    }

    setWatches(prev => [...prev, {
      id: nextWatchId++,
      expression: expr,
      value,
      error,
    }]);
  }, [input, evaluate, paused]);

  const removeWatch = useCallback((id: number) => {
    setWatches(prev => prev.filter(w => w.id !== id));
  }, []);

  return (
    <div className="panel-section">
      <div className="panel-header watch-header">
        <span>Watch</span>
        <button
          className="watch-refresh-btn"
          onClick={refreshAll}
          title="Refresh all watches"
          disabled={!paused}
        >
          Refresh
        </button>
      </div>
      <div className="panel-body">
        {watches.length === 0 && (
          <div style={{ color: '#666', fontSize: 12 }}>Add expressions to watch</div>
        )}
        {watches.map(w => (
          <div key={w.id} className="watch-row">
            <span className="watch-expr" title={w.expression}>{w.expression}</span>
            <span className="watch-eq">=</span>
            <span className={`watch-value ${w.error ? 'watch-error' : ''}`}>{w.value}</span>
            <button
              className="watch-remove"
              onClick={() => removeWatch(w.id)}
              title="Remove"
            >
              x
            </button>
          </div>
        ))}
        <div className="watch-input">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Add watch expression..."
            onKeyDown={e => {
              if (e.key === 'Enter') addWatch();
            }}
          />
          <button onClick={addWatch} title="Add watch">+</button>
        </div>
      </div>
    </div>
  );
}
