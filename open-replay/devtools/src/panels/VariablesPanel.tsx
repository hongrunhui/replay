import React, { useState, useCallback } from 'react';

type VarEntry = { name: string; value: unknown; type?: string; objectId?: string };

type Props = {
  variables: Record<string, unknown>;
  evaluate: (expr: string) => Promise<string>;
  frameId?: string;
  onExpandObject?: (objectId: string) => Promise<VarEntry[]>;
};

function VarRow({ name, value, type, objectId, depth = 0, onExpand }: {
  name: string; value: unknown; type?: string; objectId?: string;
  depth?: number;
  onExpand?: (objectId: string) => Promise<VarEntry[]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<VarEntry[]>([]);
  const isExpandable = objectId && (type === 'object' || type === 'function');

  const toggle = async () => {
    if (!isExpandable || !onExpand) return;
    if (!expanded) {
      const props = await onExpand(objectId!);
      setChildren(props);
    }
    setExpanded(!expanded);
  };

  return (
    <>
      <div className="var-row" style={{ paddingLeft: depth * 16 }}>
        {isExpandable ? (
          <span className="var-expand" onClick={toggle}>{expanded ? '▼' : '▶'}</span>
        ) : (
          <span className="var-expand-empty"></span>
        )}
        <span className="var-name">{name}</span>
        <span className="var-eq">:</span>
        <span className={`var-value var-type-${type || 'unknown'}`}>
          {formatValue(value, type)}
        </span>
      </div>
      {expanded && children.map((child, i) => (
        <VarRow
          key={`${name}.${child.name}.${i}`}
          name={child.name}
          value={child.value}
          type={child.type}
          objectId={child.objectId}
          depth={depth + 1}
          onExpand={onExpand}
        />
      ))}
    </>
  );
}

export function VariablesPanel({ variables, evaluate, frameId, onExpandObject }: Props) {
  const [expr, setExpr] = useState('');
  const [evalResults, setEvalResults] = useState<Array<{ expr: string; result: string }>>([]);

  const onEval = useCallback(async () => {
    if (!expr.trim()) return;
    const result = await evaluate(expr);
    setEvalResults(prev => [...prev, { expr, result }]);
    setExpr('');
  }, [expr, evaluate]);

  const entries = Object.entries(variables);

  return (
    <div className="panel-section">
      <div className="panel-header">⬡ Variables</div>
      <div className="panel-body">
        {entries.length === 0 && !frameId && (
          <div style={{ color: '#666', fontSize: 12 }}>Click a line to see variables</div>
        )}
        {entries.map(([name, value]) => (
          <VarRow
            key={name}
            name={name}
            value={value}
            type={typeof value}
            onExpand={onExpandObject}
          />
        ))}

        <div className="eval-input">
          <input
            value={expr}
            onChange={e => setExpr(e.target.value)}
            placeholder="› Evaluate expression..."
            onKeyDown={e => e.key === 'Enter' && onEval()}
          />
          <button onClick={onEval}>⏎</button>
        </div>
        {evalResults.map((r, i) => (
          <div key={i}>
            <div style={{ fontSize: 11, color: '#666' }}>› {r.expr}</div>
            <div className="eval-result">{r.result}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatValue(value: unknown, type?: string): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (type === 'function') return typeof value === 'string' ? value.split('\n')[0].slice(0, 60) : 'ƒ()';
  if (type === 'object') return typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}
