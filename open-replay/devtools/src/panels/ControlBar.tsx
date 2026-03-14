import React from 'react';

type Props = {
  currentLine: number | null;
  totalLines: number;
  loading: boolean;
  onJumpToLine: (line: number) => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onJumpToStart: () => void;
};

export function ControlBar({
  currentLine, totalLines, loading,
  onJumpToLine, onStepForward, onStepBackward, onJumpToStart,
}: Props) {
  return (
    <div className="control-bar">
      <button onClick={onJumpToStart} disabled={loading} title="Jump to start">
        ⏮
      </button>
      <button onClick={onStepBackward} disabled={loading || currentLine === null || currentLine <= 0} title="Step back">
        ◀
      </button>
      <button onClick={onStepForward} disabled={loading || currentLine === null} title="Step forward">
        ▶
      </button>

      <div className="timeline">
        <span className="timeline-label">
          {loading ? '⏳ Loading...' : currentLine !== null ? `📍 Line ${currentLine + 1}` : '⏸ Not paused'}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(totalLines - 1, 1)}
          value={currentLine ?? 0}
          onChange={e => !loading && onJumpToLine(Number(e.target.value))}
          disabled={loading || totalLines === 0}
        />
        <span className="timeline-label" style={{ textAlign: 'right' }}>
          {totalLines > 0 ? `${totalLines} lines` : ''}
        </span>
      </div>
    </div>
  );
}
