import React, { useState, useCallback } from 'react';

type Props = {
  variables: Record<string, unknown>;
  evaluate: (expr: string) => Promise<string>;
  frameId?: string;
};

export function VariablesPanel({ variables, evaluate, frameId }: Props) {
  const [expr, setExpr] = useState('');
  const [evalResult, setEvalResult] = useState<string | null>(null);

  const onEval = useCallback(async () => {
    if (!expr.trim()) return;
    const result = await evaluate(expr);
    setEvalResult(result);
  }, [expr, evaluate]);

  const entries = Object.entries(variables);

  return (
    <div className="panel-section">
      <div className="panel-header">Variables</div>
      <div className="panel-body">
        {entries.length === 0 && !frameId && (
          <div style={{ color: '#666', fontSize: 12 }}>Jump to a line to see variables</div>
        )}
        {entries.map(([name, value]) => (
          <div key={name} className="var-row">
            <span className="var-name">{name}:</span>
            <span className="var-value">{formatValue(value)}</span>
          </div>
        ))}

        <div className="eval-input">
          <input
            value={expr}
            onChange={e => setExpr(e.target.value)}
            placeholder="Evaluate expression..."
            onKeyDown={e => e.key === 'Enter' && onEval()}
          />
          <button onClick={onEval}>Eval</button>
        </div>
        {evalResult !== null && (
          <div className="eval-result">&gt; {evalResult}</div>
        )}
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
