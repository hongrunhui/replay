import React, { useState, useMemo } from 'react';
import { ConsoleMessage } from '../protocol';

const LEVEL_ICONS: Record<string, string> = {
  log: '\u203A',
  info: '\u2139',
  warn: '\u26A0',
  error: '\u2715',
};

type LogFilter = 'all' | 'log' | 'warn' | 'error';

type ConsolePanelProps = {
  messages: ConsoleMessage[];
  onJumpToLine?: (line: number) => void;
};

export function ConsolePanel({ messages, onJumpToLine }: ConsolePanelProps) {
  const [filter, setFilter] = useState<LogFilter>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return messages;
    if (filter === 'log') return messages.filter(m => m.level === 'log' || m.level === 'info');
    return messages.filter(m => m.level === filter);
  }, [messages, filter]);

  const counts = useMemo(() => {
    const c = { all: messages.length, log: 0, warn: 0, error: 0 };
    for (const m of messages) {
      if (m.level === 'log' || m.level === 'info') c.log++;
      else if (m.level === 'warn') c.warn++;
      else if (m.level === 'error') c.error++;
    }
    return c;
  }, [messages]);

  return (
    <div className="panel-section" style={{ flex: 1 }}>
      <div className="panel-header console-header">
        <span>Console ({filtered.length})</span>
        <div className="console-filters">
          {(['all', 'log', 'warn', 'error'] as LogFilter[]).map(level => (
            <button
              key={level}
              className={`console-filter-btn ${filter === level ? 'active' : ''} ${level}`}
              onClick={() => setFilter(level)}
            >
              {level === 'all' ? 'All' : level.charAt(0).toUpperCase() + level.slice(1)}
              {counts[level] > 0 && <span className="console-filter-count">{counts[level]}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body" style={{ maxHeight: 'none', flex: 1 }}>
        {filtered.length === 0 && (
          <div style={{ color: '#666', fontSize: 12, padding: '8px 0' }}>
            {messages.length === 0
              ? 'Click a line or run to completion to see console output'
              : `No ${filter} messages`}
          </div>
        )}
        {filtered.map((msg, i) => (
          <div
            key={i}
            className={`console-msg ${msg.level}${msg.line != null ? ' console-clickable' : ''}`}
            onClick={() => { if (msg.line != null && onJumpToLine) onJumpToLine(msg.line); }}
            title={msg.line != null ? `Jump to line ${msg.line + 1}` : undefined}
          >
            <span className="console-icon">{LEVEL_ICONS[msg.level] || '\u203A'}</span>
            <span className="console-text">{msg.text}</span>
            {msg.line != null && (
              <span className="console-line-link">:{msg.line + 1}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
