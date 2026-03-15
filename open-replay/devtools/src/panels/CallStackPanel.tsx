import React from 'react';
import { PauseFrame } from '../protocol';

type CallStackPanelProps = {
  frames: PauseFrame[];
  onSelectFrame?: (frame: PauseFrame) => void;
};

function extractFileName(url?: string): string {
  if (!url) return '';
  // Strip file:// prefix and extract just the filename
  const cleaned = url.replace(/^file:\/\//, '');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || '';
}

export function CallStackPanel({ frames, onSelectFrame }: CallStackPanelProps) {
  // Filter out internal Node.js frames
  const userFrames = frames.filter(f =>
    !f.functionName?.startsWith('Module.') &&
    f.functionName !== 'executeUserEntryPoint' &&
    f.functionName !== 'wrapModuleLoad'
  );

  return (
    <div className="panel-section">
      <div className="panel-header">Call Stack ({userFrames.length})</div>
      <div className="panel-body">
        {userFrames.length === 0 && (
          <div style={{ color: '#666', fontSize: 12 }}>Click a line to see call stack</div>
        )}
        {userFrames.map((frame, i) => {
          const fileName = extractFileName(frame.url);
          return (
            <div
              key={i}
              className={`frame-row ${i === 0 ? 'active' : ''}`}
              onClick={() => onSelectFrame?.(frame)}
              title={frame.url ? `${frame.url}:${(frame.line ?? 0) + 1}` : undefined}
            >
              <span className="frame-index">{i}</span>
              <span className="frame-name">{frame.functionName || '(anonymous)'}</span>
              {fileName && <span className="frame-file">{fileName}</span>}
              <span className="frame-loc">
                :{(frame.line ?? 0) + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
