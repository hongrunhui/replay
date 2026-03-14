import React from 'react';
import { ConsoleMessage } from '../protocol';

const LEVEL_ICONS: Record<string, string> = {
  log: '›',
  info: 'ℹ',
  warn: '⚠',
  error: '✕',
};

export function ConsolePanel({ messages }: { messages: ConsoleMessage[] }) {
  return (
    <div className="panel-section" style={{ flex: 1 }}>
      <div className="panel-header">⬡ Console ({messages.length})</div>
      <div className="panel-body" style={{ maxHeight: 'none', flex: 1 }}>
        {messages.length === 0 && (
          <div style={{ color: '#666', fontSize: 12, padding: '8px 0' }}>
            Click a line to see console output up to that point
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`console-msg ${msg.level}`}>
            <span className="console-icon">{LEVEL_ICONS[msg.level] || '›'}</span>
            <span className="console-text">{msg.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
