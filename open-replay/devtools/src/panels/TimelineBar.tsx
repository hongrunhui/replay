import React, { useState, useCallback } from 'react';
import { ConsoleMessage } from '../protocol';

type Props = {
  currentLine: number | null;
  totalLines: number;
  loading: boolean;
  onJumpToLine: (line: number) => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onJumpToStart: () => void;
  onRunToCompletion: () => void;
  focusRange: { start: number; end: number } | null;
  onSetFocusRange: (range: { start: number; end: number } | null) => void;
  consoleMessages: ConsoleMessage[];
};

export function TimelineBar({
  currentLine, totalLines, loading,
  onJumpToLine, onStepForward, onStepBackward, onJumpToStart, onRunToCompletion,
  focusRange, onSetFocusRange, consoleMessages,
}: Props) {
  const [focusMode, setFocusMode] = useState(false);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(Math.max(totalLines - 1, 1));

  const maxLine = Math.max(totalLines - 1, 1);

  const toggleFocusMode = useCallback(() => {
    if (focusMode) {
      setFocusMode(false);
      onSetFocusRange(null);
    } else {
      setFocusMode(true);
      const start = Math.max(0, (currentLine ?? 0) - 10);
      const end = Math.min(maxLine, (currentLine ?? 0) + 10);
      setRangeStart(start);
      setRangeEnd(end);
      onSetFocusRange({ start, end });
    }
  }, [focusMode, currentLine, maxLine, onSetFocusRange]);

  const handleRangeStartChange = useCallback((val: number) => {
    const clamped = Math.min(val, rangeEnd);
    setRangeStart(clamped);
    onSetFocusRange({ start: clamped, end: rangeEnd });
  }, [rangeEnd, onSetFocusRange]);

  const handleRangeEndChange = useCallback((val: number) => {
    const clamped = Math.max(val, rangeStart);
    setRangeEnd(clamped);
    onSetFocusRange({ start: rangeStart, end: clamped });
  }, [rangeStart, onSetFocusRange]);

  const handleJump = useCallback((line: number) => {
    if (focusRange) {
      const clamped = Math.max(focusRange.start, Math.min(focusRange.end, line));
      onJumpToLine(clamped);
    } else {
      onJumpToLine(line);
    }
  }, [focusRange, onJumpToLine]);

  // Compute marker positions
  const logMarkers: number[] = [];
  const errorMarkers: number[] = [];
  for (const msg of consoleMessages) {
    if (msg.line !== undefined && msg.line !== null) {
      if (msg.level === 'error') errorMarkers.push(msg.line);
      else logMarkers.push(msg.line);
    }
  }

  return (
    <div className="timeline-bar">
      {/* Controls */}
      <div className="timeline-controls">
        <button className="timeline-btn" onClick={onJumpToStart} disabled={loading} title="Jump to start">
          {'\u23EE'}
        </button>
        <button className="timeline-btn" onClick={onStepBackward}
          disabled={loading || currentLine === null || currentLine <= 0} title="Step back (Shift+F8)">
          {'\u25C0'}
        </button>
        <button className="timeline-btn" onClick={onStepForward}
          disabled={loading || currentLine === null} title="Step forward (F8)">
          {'\u25B6'}
        </button>
        <button className="timeline-btn run-btn" onClick={onRunToCompletion} disabled={loading}
          title="Run to completion">
          {'\u23ED'} Run
        </button>
        <button className={`timeline-btn focus-btn ${focusMode ? 'focus-active' : ''}`}
          onClick={toggleFocusMode} title={focusMode ? 'Clear focus range' : 'Enable focus mode'}>
          {focusMode ? '\u2716 Focus' : '\u25CE Focus'}
        </button>
      </div>

      {/* Timeline track */}
      <div className="timeline-track-wrapper">
        <span className="timeline-label">
          {loading ? (
            <span className="timeline-loading-text">Loading...</span>
          ) : focusMode && focusRange ? (
            `Focus: L${focusRange.start + 1}-${focusRange.end + 1}`
          ) : currentLine !== null ? (
            `Line ${currentLine + 1}`
          ) : (
            'Not paused'
          )}
        </span>

        <div className="timeline-track">
          {loading && <div className="timeline-progress" />}

          {focusMode && (
            <div className="timeline-focus-highlight" style={{
              left: `${(rangeStart / maxLine) * 100}%`,
              width: `${((rangeEnd - rangeStart) / maxLine) * 100}%`,
            }} />
          )}

          {logMarkers.map((line, i) => (
            <div key={`log-${i}`} className="timeline-marker timeline-marker-log"
              style={{ left: `${(line / maxLine) * 100}%` }}
              title={`console.log at line ${line + 1}`}
              onClick={() => handleJump(line)} />
          ))}

          {errorMarkers.map((line, i) => (
            <div key={`err-${i}`} className="timeline-marker timeline-marker-error"
              style={{ left: `${(line / maxLine) * 100}%` }}
              title={`Error at line ${line + 1}`}
              onClick={() => handleJump(line)} />
          ))}

          {focusMode ? (
            <>
              <input type="range" className="range-start" min={0} max={maxLine} value={rangeStart}
                onChange={e => handleRangeStartChange(Number(e.target.value))} disabled={loading || totalLines === 0} />
              <input type="range" className="range-end" min={0} max={maxLine} value={rangeEnd}
                onChange={e => handleRangeEndChange(Number(e.target.value))} disabled={loading || totalLines === 0} />
            </>
          ) : (
            <input type="range" min={0} max={maxLine} value={currentLine ?? 0}
              onChange={e => !loading && handleJump(Number(e.target.value))} disabled={loading || totalLines === 0} />
          )}
        </div>

        <span className="timeline-label right">
          {totalLines > 0 ? `${totalLines} lines` : ''}
        </span>
      </div>
    </div>
  );
}
