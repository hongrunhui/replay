import React from 'react';
import { PauseFrame } from '../protocol';

export function CallStackPanel({ frames }: { frames: PauseFrame[] }) {
  // Filter out internal Node.js frames
  const userFrames = frames.filter(f =>
    !f.functionName?.startsWith('Module.') &&
    f.functionName !== 'executeUserEntryPoint' &&
    f.functionName !== 'wrapModuleLoad'
  );

  return (
    <div className="panel-section">
      <div className="panel-header">⬡ Call Stack ({userFrames.length})</div>
      <div className="panel-body">
        {userFrames.length === 0 && (
          <div style={{ color: '#666', fontSize: 12 }}>Click a line to see call stack</div>
        )}
        {userFrames.map((frame, i) => (
          <div key={i} className={`frame-row ${i === 0 ? 'active' : ''}`}>
            <span className="frame-index">{i}</span>
            <span className="frame-name">{frame.functionName || '(anonymous)'}</span>
            <span className="frame-loc">
              :{(frame.line ?? 0) + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
