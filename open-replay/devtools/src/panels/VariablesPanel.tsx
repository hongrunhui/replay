import React, { useState, useCallback } from 'react';

type VarEntry = { name: string; value: unknown; type?: string; objectId?: string; className?: string; description?: string; subtype?: string };

type Props = {
  variables: Record<string, unknown>;
  evaluate: (expr: string) => Promise<string>;
  frameId?: string;
  onExpandObject?: (objectId: string) => Promise<VarEntry[]>;
};

/** Format the header for an object based on its className / subtype */
function formatObjectHeader(value: unknown, type?: string, className?: string, description?: string, subtype?: string): React.ReactNode {
  // Array: show "Array(N)"
  if (className === 'Array' || subtype === 'array') {
    const label = description || (typeof value === 'string' ? value : 'Array');
    return <span className="var-type-object var-obj-header">{label}</span>;
  }
  // Map
  if (className === 'Map') {
    const label = description || 'Map';
    return <span className="var-type-object var-obj-header">{label}</span>;
  }
  // Set
  if (className === 'Set') {
    const label = description || 'Set';
    return <span className="var-type-object var-obj-header">{label}</span>;
  }
  // Date
  if (className === 'Date' || subtype === 'date') {
    const label = description || (typeof value === 'string' ? value : 'Date');
    return <span className="var-type-date">{label}</span>;
  }
  // RegExp
  if (className === 'RegExp' || subtype === 'regexp') {
    const label = description || (typeof value === 'string' ? value : '/…/');
    return <span className="var-type-regexp">{label}</span>;
  }
  // Error
  if (className === 'Error' || subtype === 'error' || (className && className.endsWith('Error'))) {
    const label = description || (typeof value === 'string' ? value : className || 'Error');
    return <span className="var-type-error">{label}</span>;
  }
  // Function
  if (type === 'function') {
    if (typeof value === 'string') {
      // Show first line, truncated
      const firstLine = value.split('\n')[0].slice(0, 80);
      return <span className="var-type-function">{firstLine}</span>;
    }
    const name = description || className || '';
    return <span className="var-type-function">f {name}()</span>;
  }
  return null;
}

function formatValue(value: unknown, type?: string, className?: string, description?: string, subtype?: string): React.ReactNode {
  if (value === null) return <span className="var-type-undefined">null</span>;
  if (value === undefined) return <span className="var-type-undefined">undefined</span>;

  // Check for enhanced object types first
  const objHeader = formatObjectHeader(value, type, className, description, subtype);
  if (objHeader) return objHeader;

  if (type === 'function') {
    const text = typeof value === 'string' ? value.split('\n')[0].slice(0, 60) : 'f()';
    return <span className="var-type-function">{text}</span>;
  }
  if (type === 'object') {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return <span className="var-type-object">{text}</span>;
  }
  if (typeof value === 'string') return <span className="var-type-string">"{value}"</span>;
  if (typeof value === 'number') return <span className="var-type-number">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="var-type-boolean">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function VarRow({ name, value, type, objectId, className: objClassName, description, subtype, depth = 0, onExpand }: {
  name: string; value: unknown; type?: string; objectId?: string;
  className?: string; description?: string; subtype?: string;
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

  // For arrays, format child keys as indices
  const isArray = objClassName === 'Array' || subtype === 'array';
  // For Map, show key->value
  const isMap = objClassName === 'Map';
  // For Set, show entries
  const isSet = objClassName === 'Set';

  return (
    <>
      <div className="var-row" style={{ paddingLeft: depth * 16 }}>
        {isExpandable ? (
          <span className="var-expand" onClick={toggle}>{expanded ? '\u25BC' : '\u25B6'}</span>
        ) : (
          <span className="var-expand-empty"></span>
        )}
        <span className="var-name">{name}</span>
        <span className="var-eq">:</span>
        <span className="var-value-container">
          {formatValue(value, type, objClassName, description, subtype)}
        </span>
      </div>
      {expanded && children.map((child, i) => {
        // Decorate child display name for containers
        let childName = child.name;
        if (isArray && /^\d+$/.test(child.name)) {
          childName = `[${child.name}]`;
        }
        if (isMap && child.name === '[[Entries]]') {
          childName = '[[Entries]]';
        }
        if (isSet && child.name === '[[Entries]]') {
          childName = '[[Entries]]';
        }

        return (
          <VarRow
            key={`${name}.${child.name}.${i}`}
            name={childName}
            value={child.value}
            type={child.type}
            objectId={child.objectId}
            className={child.className}
            description={child.description}
            subtype={child.subtype}
            depth={depth + 1}
            onExpand={onExpand}
          />
        );
      })}
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
      <div className="panel-header">Variables</div>
      <div className="panel-body">
        {entries.length === 0 && !frameId && (
          <div style={{ color: '#666', fontSize: 12 }}>Click a line to see variables</div>
        )}
        {entries.map(([name, rawVal]) => {
          // Support enhanced variable objects from protocol
          const val = rawVal as any;
          const isEnhanced = val && typeof val === 'object' && ('__type' in val || '__className' in val || '__objectId' in val);
          if (isEnhanced) {
            return (
              <VarRow
                key={name}
                name={name}
                value={val.__description || val.__value || val}
                type={val.__type || typeof val}
                objectId={val.__objectId}
                className={val.__className}
                description={val.__description}
                subtype={val.__subtype}
                onExpand={onExpandObject}
              />
            );
          }
          return (
            <VarRow
              key={name}
              name={name}
              value={rawVal}
              type={typeof rawVal}
              onExpand={onExpandObject}
            />
          );
        })}

        <div className="eval-input">
          <input
            value={expr}
            onChange={e => setExpr(e.target.value)}
            placeholder="Evaluate expression..."
            onKeyDown={e => e.key === 'Enter' && onEval()}
          />
          <button onClick={onEval}>Eval</button>
        </div>
        {evalResults.map((r, i) => (
          <div key={i}>
            <div style={{ fontSize: 11, color: '#666' }}>&gt; {r.expr}</div>
            <div className="eval-result">{r.result}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
