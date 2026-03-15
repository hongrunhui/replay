import React, { useEffect, useRef, useState, useCallback } from 'react';

type Props = {
  code: string;
  currentLine: number | null;
  breakpoints: Set<number>;
  hitCounts: Record<number, number>;
  onToggleBreakpoint: (line: number) => void;
  onClickLine: (line: number) => void;
  onLoadFile: (path: string) => void;
  sourceFile: string;
  evaluate?: (expr: string) => Promise<string>;
};

// Simple JS syntax highlighting
function highlightLine(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const regex = /(\/\/.*$|'[^']*'|"[^"]*"|`[^`]*`|\b(const|let|var|function|return|if|else|for|while|new|try|catch|throw|typeof|import|export|from|async|await|class|extends|true|false|null|undefined|console|require|Math|Date|JSON|process|setTimeout|Promise|Array|Object|Error|crypto|fs|path|http)\b|\b\d+\.?\d*\b)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex)
      parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    const val = match[0];
    let cls = '';
    if (val.startsWith('//')) cls = 'hl-comment';
    else if (val.startsWith("'") || val.startsWith('"') || val.startsWith('`')) cls = 'hl-string';
    else if (/^\d/.test(val)) cls = 'hl-number';
    else cls = 'hl-keyword';
    parts.push(<span key={`h${match.index}`} className={cls}>{val}</span>);
    lastIndex = match.index + val.length;
  }
  if (lastIndex < text.length)
    parts.push(<span key={`e${lastIndex}`}>{text.slice(lastIndex)}</span>);
  return parts.length ? parts : [<span key="empty">{text || ' '}</span>];
}

// Extract word under mouse from code text
function getWordAt(text: string, offset: number): string | null {
  const before = text.slice(0, offset).match(/[\w.]*$/)?.[0] || '';
  const after = text.slice(offset).match(/^[\w.]*/)?.[0] || '';
  const word = before + after;
  return word.length > 0 ? word : null;
}

export function SourcePanel({ code, currentLine, breakpoints, hitCounts, onToggleBreakpoint, onClickLine, evaluate, sourceFile }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string; value: string } | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>();
  const lines = code ? code.split('\n') : [];

  useEffect(() => {
    if (currentLine !== null && scrollRef.current) {
      const lineEl = scrollRef.current.querySelector(`[data-line="${currentLine}"]`) as HTMLElement;
      lineEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [currentLine]);

  const handleMouseOver = useCallback((e: React.MouseEvent, lineText: string) => {
    if (!evaluate) return;
    const target = e.target as HTMLElement;
    if (!target.closest('.line-content')) return;

    // Get approximate character position
    const rect = target.getBoundingClientRect();
    const charWidth = 8; // approximate monospace char width
    const offsetInEl = e.clientX - rect.left;
    const charIndex = Math.floor(offsetInEl / charWidth);

    const word = getWordAt(lineText, charIndex);
    if (!word || word.length < 1 || /^\d+$/.test(word)) return;
    // Skip keywords
    if (/^(const|let|var|function|return|if|else|for|while|new|try|catch|throw|typeof|import|export|from|async|await|true|false|null|undefined|class)$/.test(word)) return;

    clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(async () => {
      try {
        const value = await evaluate(word);
        if (value && value !== 'undefined' && !value.startsWith('Error:')) {
          setHover({ x: e.clientX, y: e.clientY - 40, text: word, value });
        }
      } catch {}
    }, 400);
  }, [evaluate]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimeout.current);
    setHover(null);
  }, []);

  // Listen for Escape key to clear hover tooltip
  useEffect(() => {
    function onClearHover() {
      clearTimeout(hoverTimeout.current);
      setHover(null);
    }
    document.addEventListener('openreplay-clear-hover', onClearHover);
    return () => document.removeEventListener('openreplay-clear-hover', onClearHover);
  }, []);

  if (lines.length === 0) {
    return (
      <div className="source-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#888', lineHeight: 2, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🔍</div>
          <div style={{ color: '#569cd6', fontSize: 16, marginBottom: 12 }}>How to use</div>
          <div>1. Click any <b>line number</b> to time-travel</div>
          <div>2. Use ◀ ▶ to step backward / forward</div>
          <div>3. <b>Hover</b> on a variable to preview its value</div>
          <div>4. Evaluate expressions in the Variables panel</div>
        </div>
      </div>
    );
  }

  return (
    <div className="source-panel" ref={scrollRef} onMouseLeave={handleMouseLeave}>
      {/* Hover tooltip */}
      {hover && (
        <div className="hover-tooltip" style={{ left: hover.x, top: hover.y }}>
          <span className="hover-name">{hover.text}</span>
          <span className="hover-eq">=</span>
          <span className="hover-value">{hover.value}</span>
        </div>
      )}

      {lines.map((line, i) => (
        <div
          key={i}
          data-line={i}
          className={`source-line ${i === currentLine ? 'current' : ''} ${breakpoints.has(i) ? 'breakpoint' : ''}`}
          onClick={() => onClickLine(i)}
        >
          <div className="line-gutter">
            {hitCounts[i] != null && hitCounts[i] > 0 ? (
              <span className="hit-count" title={`Executed ${hitCounts[i]} time(s)`}>{hitCounts[i]}</span>
            ) : (
              <span className="hit-count-empty"></span>
            )}
            {breakpoints.has(i)
              ? <span className="bp-icon" onClick={(e) => { e.stopPropagation(); onToggleBreakpoint(i); }}>●</span>
              : <span className="bp-icon-empty"></span>}
            <span className="line-num">{i + 1}</span>
          </div>
          <div
            className="line-content"
            onMouseMove={(e) => handleMouseOver(e, line)}
          >
            {highlightLine(line)}
          </div>
        </div>
      ))}
    </div>
  );
}
