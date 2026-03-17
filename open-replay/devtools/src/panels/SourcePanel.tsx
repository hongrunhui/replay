import React, { useEffect, useRef, useState, useCallback } from 'react';

type OpenFile = {
  path: string;
  content: string;
};

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
  // File tabs
  openFiles: OpenFile[];
  activeFile: string;
  onSwitchFile: (path: string) => void;
  onCloseFile: (path: string) => void;
};

// Simple JS syntax highlighting
function highlightLine(text: string, searchTerm?: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const regex = /(\/\/.*$|'[^']*'|"[^"]*"|`[^`]*`|\b(const|let|var|function|return|if|else|for|while|new|try|catch|throw|typeof|import|export|from|async|await|class|extends|true|false|null|undefined|console|require|Math|Date|JSON|process|setTimeout|Promise|Array|Object|Error|crypto|fs|path|http)\b|\b\d+\.?\d*\b)/g;
  let match;
  const tokens: Array<{ start: number; end: number; cls: string }> = [];
  while ((match = regex.exec(text)) !== null) {
    const val = match[0];
    let cls = '';
    if (val.startsWith('//')) cls = 'hl-comment';
    else if (val.startsWith("'") || val.startsWith('"') || val.startsWith('`')) cls = 'hl-string';
    else if (/^\d/.test(val)) cls = 'hl-number';
    else cls = 'hl-keyword';
    tokens.push({ start: match.index, end: match.index + val.length, cls });
  }

  const addSegment = (segment: string, cls: string, keyPrefix: string, startPos: number) => {
    if (!searchTerm || searchTerm.length === 0) {
      parts.push(<span key={`${keyPrefix}${startPos}`} className={cls}>{segment}</span>);
      return;
    }
    const lowerSeg = segment.toLowerCase();
    const lowerSearch = searchTerm.toLowerCase();
    let segPos = 0;
    let searchIdx = lowerSeg.indexOf(lowerSearch, segPos);
    let partIdx = 0;
    while (searchIdx !== -1) {
      if (searchIdx > segPos) {
        parts.push(<span key={`${keyPrefix}${startPos}-${partIdx}a`} className={cls}>{segment.slice(segPos, searchIdx)}</span>);
        partIdx++;
      }
      parts.push(
        <span key={`${keyPrefix}${startPos}-${partIdx}h`} className={`${cls} search-highlight`}>
          {segment.slice(searchIdx, searchIdx + searchTerm.length)}
        </span>
      );
      partIdx++;
      segPos = searchIdx + searchTerm.length;
      searchIdx = lowerSeg.indexOf(lowerSearch, segPos);
    }
    if (segPos < segment.length) {
      parts.push(<span key={`${keyPrefix}${startPos}-${partIdx}e`} className={cls}>{segment.slice(segPos)}</span>);
    }
  };

  let pos = 0;
  for (const token of tokens) {
    if (token.start > pos) addSegment(text.slice(pos, token.start), '', 't', pos);
    addSegment(text.slice(token.start, token.end), token.cls, 'h', token.start);
    pos = token.end;
  }
  if (pos < text.length) addSegment(text.slice(pos), '', 'e', pos);
  if (parts.length === 0) addSegment(text || ' ', '', 'empty', 0);
  return parts;
}

function getWordAt(text: string, offset: number): string | null {
  const before = text.slice(0, offset).match(/[\w.]*$/)?.[0] || '';
  const after = text.slice(offset).match(/^[\w.]*/)?.[0] || '';
  const word = before + after;
  return word.length > 0 ? word : null;
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

export function SourcePanel({
  code, currentLine, breakpoints, hitCounts, onToggleBreakpoint, onClickLine, evaluate, sourceFile,
  openFiles, activeFile, onSwitchFile, onCloseFile,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string; value: string } | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>();
  const lines = code ? code.split('\n') : [];

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchMatches, setSearchMatches] = useState<Array<{ line: number; col: number }>>([]);
  const [currentMatch, setCurrentMatch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!searchTerm || searchTerm.length === 0) { setSearchMatches([]); setCurrentMatch(0); return; }
    const lowerSearch = searchTerm.toLowerCase();
    const matches: Array<{ line: number; col: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      let col = lowerLine.indexOf(lowerSearch);
      while (col !== -1) { matches.push({ line: i, col }); col = lowerLine.indexOf(lowerSearch, col + 1); }
    }
    setSearchMatches(matches);
    setCurrentMatch(matches.length > 0 ? 0 : -1);
  }, [searchTerm, code]);

  useEffect(() => {
    if (currentMatch >= 0 && currentMatch < searchMatches.length && scrollRef.current) {
      const matchLine = searchMatches[currentMatch].line;
      const lineEl = scrollRef.current.querySelector(`[data-line="${matchLine}"]`) as HTMLElement;
      lineEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [currentMatch, searchMatches]);

  const openSearch = useCallback(() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 50); }, []);
  const closeSearch = useCallback(() => { setSearchOpen(false); setSearchTerm(''); setSearchMatches([]); setCurrentMatch(0); }, []);
  const goToNextMatch = useCallback(() => { if (searchMatches.length === 0) return; setCurrentMatch(prev => (prev + 1) % searchMatches.length); }, [searchMatches]);
  const goToPrevMatch = useCallback(() => { if (searchMatches.length === 0) return; setCurrentMatch(prev => (prev - 1 + searchMatches.length) % searchMatches.length); }, [searchMatches]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openSearch(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openSearch]);

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
    const rect = target.getBoundingClientRect();
    const charWidth = 8;
    const offsetInEl = e.clientX - rect.left;
    const charIndex = Math.floor(offsetInEl / charWidth);
    const word = getWordAt(lineText, charIndex);
    if (!word || word.length < 1 || /^\d+$/.test(word)) return;
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

  const handleMouseLeave = useCallback(() => { clearTimeout(hoverTimeout.current); setHover(null); }, []);

  useEffect(() => {
    function onClearHover() { clearTimeout(hoverTimeout.current); setHover(null); }
    document.addEventListener('openreplay-clear-hover', onClearHover);
    return () => document.removeEventListener('openreplay-clear-hover', onClearHover);
  }, []);

  const currentMatchLine = currentMatch >= 0 && currentMatch < searchMatches.length ? searchMatches[currentMatch].line : -1;

  return (
    <div className="source-content-area">
      {/* File tabs */}
      {openFiles.length > 0 && (
        <div className="file-tabs-bar">
          {openFiles.map(f => (
            <button
              key={f.path}
              className={`file-tab ${f.path === activeFile ? 'active' : ''}`}
              onClick={() => onSwitchFile(f.path)}
              title={f.path}
            >
              <span className="file-tab-name">{getFileName(f.path)}</span>
              <button
                className="file-tab-close"
                onClick={(e) => { e.stopPropagation(); onCloseFile(f.path); }}
                title="Close"
              >
                {'\u2715'}
              </button>
            </button>
          ))}
        </div>
      )}

      {/* Source code */}
      {lines.length === 0 ? (
        <div className="source-panel">
          <div className="empty-state">
            <div className="empty-state-title">How to use</div>
            <div>1. Click any <b>line number</b> to time-travel</div>
            <div>2. Use the timeline controls to step backward / forward</div>
            <div>3. <b>Hover</b> on a variable to preview its value</div>
            <div>4. Evaluate expressions in the Scopes panel</div>
            <div>5. Press <b>Ctrl+F</b> to search in source</div>
            <div>6. Press <b>?</b> for keyboard shortcuts</div>
          </div>
        </div>
      ) : (
        <div className="source-panel" ref={scrollRef} onMouseLeave={handleMouseLeave}>
          {searchOpen && (
            <div className="search-bar">
              <input
                ref={searchInputRef}
                className="search-input"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search..."
                onKeyDown={e => {
                  if (e.key === 'Escape') closeSearch();
                  else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); goToPrevMatch(); }
                  else if (e.key === 'Enter') { e.preventDefault(); goToNextMatch(); }
                }}
              />
              <span className="search-count">
                {searchMatches.length > 0 ? `${currentMatch + 1} of ${searchMatches.length}` : searchTerm ? 'No matches' : ''}
              </span>
              <button className="search-nav-btn" onClick={goToPrevMatch} disabled={searchMatches.length === 0} title="Previous (Shift+Enter)">{'\u25B2'}</button>
              <button className="search-nav-btn" onClick={goToNextMatch} disabled={searchMatches.length === 0} title="Next (Enter)">{'\u25BC'}</button>
              <button className="search-close-btn" onClick={closeSearch} title="Close (Escape)">{'\u2715'}</button>
            </div>
          )}

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
              className={`source-line ${i === currentLine ? 'current' : ''} ${breakpoints.has(i) ? 'breakpoint' : ''} ${i === currentMatchLine ? 'search-current-line' : ''}`}
              onClick={() => onClickLine(i)}
            >
              <div className="line-gutter">
                {hitCounts[i] != null && hitCounts[i] > 0 ? (
                  <span className="hit-count" title={`Executed ${hitCounts[i]} time(s)`}>{hitCounts[i]}</span>
                ) : (
                  <span className="hit-count-empty" />
                )}
                {breakpoints.has(i)
                  ? <span className="bp-icon" onClick={(e) => { e.stopPropagation(); onToggleBreakpoint(i); }}>{'\u25CF'}</span>
                  : <span className="bp-icon-empty" />}
                <span className="line-num">{i + 1}</span>
              </div>
              <div className="line-content" onMouseMove={(e) => handleMouseOver(e, line)}>
                {highlightLine(line, searchOpen ? searchTerm : undefined)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
