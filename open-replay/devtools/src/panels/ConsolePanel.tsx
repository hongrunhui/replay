import React from 'react';
import { ConsoleMessage } from '../protocol';

export function ConsolePanel({ messages }: { messages: ConsoleMessage[] }) {
  return (
    <div className="panel-section">
      <div className="panel-header">Console ({messages.length})</div>
      <div className="panel-body">
        {messages.length === 0 && (
          <div style={{ color: '#666', fontSize: 12 }}>No console output yet</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`console-msg ${msg.level}`}>
            {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
}
