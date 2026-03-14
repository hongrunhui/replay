import React from 'react';
import { PauseFrame } from '../protocol';

export function CallStackPanel({ frames }: { frames: PauseFrame[] }) {
  return (
    <div className="panel-section">
      <div className="panel-header">Call Stack</div>
      <div className="panel-body">
        {frames.length === 0 && (
          <div style={{ color: '#666', fontSize: 12 }}>Not paused</div>
        )}
        {frames.map((frame, i) => (
          <div key={i} className={`frame-row ${i === 0 ? 'active' : ''}`}>
            <span className="frame-name">{frame.functionName || '(anonymous)'}</span>
            <span className="frame-loc">
              {frame.url ? frame.url.split('/').pop() : ''}:{(frame.line ?? 0) + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
