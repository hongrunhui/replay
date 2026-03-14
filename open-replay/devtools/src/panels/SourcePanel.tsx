import React, { useState, useEffect, useRef } from 'react';

type Props = {
  code: string;
  currentLine: number | null;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  onClickLine: (line: number) => void;
  onLoadFile: (path: string) => void;
  sourceFile: string;
};

export function SourcePanel({ code, currentLine, breakpoints, onToggleBreakpoint, onClickLine, onLoadFile, sourceFile }: Props) {
  const [filePath, setFilePath] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = code ? code.split('\n') : [];

  // Auto-scroll to current line
  useEffect(() => {
    if (currentLine !== null && scrollRef.current) {
      const el = scrollRef.current.children[currentLine] as HTMLElement;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [currentLine]);

  return (
    <>
      <div className="file-input">
        <input
          value={filePath || sourceFile}
          onChange={e => setFilePath(e.target.value)}
          placeholder="Enter script file path..."
          onKeyDown={e => e.key === 'Enter' && onLoadFile(filePath)}
        />
        <button onClick={() => onLoadFile(filePath)}>Load</button>
      </div>
      <div className="source-panel" ref={scrollRef}>
        {lines.length === 0 ? (
          <div style={{ padding: 20, color: '#666' }}>
            No source loaded. Enter the script file path above, or the source will be loaded
            automatically when you jump to a line.
          </div>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className={`source-line ${i === currentLine ? 'current' : ''} ${breakpoints.has(i) ? 'breakpoint' : ''}`}
            >
              <div
                className="line-gutter"
                onClick={(e) => { e.stopPropagation(); onToggleBreakpoint(i); }}
                title={breakpoints.has(i) ? 'Remove breakpoint' : 'Set breakpoint'}
              >
                {breakpoints.has(i) ? '●' : ''} {i + 1}
              </div>
              <div
                className="line-content"
                onClick={() => onClickLine(i)}
                title={`Click to jump to line ${i + 1}`}
              >
                {line || ' '}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
