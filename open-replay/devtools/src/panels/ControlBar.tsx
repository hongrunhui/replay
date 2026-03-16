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

export function ControlBar({
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
      // Exit focus mode
      setFocusMode(false);
      onSetFocusRange(null);
    } else {
      // Enter focus mode with default range
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
      // Clamp jump to focus range
      const clamped = Math.max(focusRange.start, Math.min(focusRange.end, line));
      onJumpToLine(clamped);
    } else {
      onJumpToLine(line);
    }
  }, [focusRange, onJumpToLine]);

  // Compute marker positions for console messages
  const logMarkers: number[] = [];
  const errorMarkers: number[] = [];
  for (const msg of consoleMessages) {
    if (msg.line !== undefined && msg.line !== null) {
      if (msg.level === 'error') {
        errorMarkers.push(msg.line);
      } else {
        logMarkers.push(msg.line);
      }
    }
  }

  return (
    <div className="control-bar">
      <button onClick={onJumpToStart} disabled={loading} title="Jump to start">
        &#x23EE;
      </button>
      <button onClick={onStepBackward} disabled={loading || currentLine === null || currentLine <= 0} title="Step back (Shift+F8)">
        &#x25C0;
      </button>
      <button onClick={onStepForward} disabled={loading || currentLine === null} title="Step forward (F8 / Ctrl+Enter)">
        &#x25B6;
      </button>
      <button
        onClick={onRunToCompletion}
        disabled={loading}
        title="Run to completion"
        className="run-to-completion-btn"
      >
        &#x23ED; Run
      </button>
      <button
        onClick={toggleFocusMode}
        className={`focus-btn ${focusMode ? 'focus-active' : ''}`}
        title={focusMode ? 'Clear focus range' : 'Enable focus mode'}
      >
        {focusMode ? '\u2716 Focus' : '\u25CE Focus'}
      </button>

      <div className={`timeline ${focusMode ? 'focus-range' : ''}`}>
        <span className="timeline-label">
          {loading ? (
            <span className="timeline-loading">Loading...</span>
          ) : focusMode && focusRange ? (
            `Focus: Line ${focusRange.start + 1} - ${focusRange.end + 1}`
          ) : currentLine !== null ? (
            `Line ${currentLine + 1}`
          ) : (
            'Not paused'
          )}
        </span>

        <div className="timeline-track">
          {/* Progress indicator during loading */}
          {loading && <div className="timeline-progress" />}

          {/* Focus range highlight */}
          {focusMode && (
            <div
              className="timeline-focus-highlight"
              style={{
                left: `${(rangeStart / maxLine) * 100}%`,
                width: `${((rangeEnd - rangeStart) / maxLine) * 100}%`,
              }}
            />
          )}

          {/* Console message markers */}
          {logMarkers.map((line, i) => (
            <div
              key={`log-${i}`}
              className="timeline-marker timeline-marker-log"
              style={{ left: `${(line / maxLine) * 100}%` }}
              title={`console.log at line ${line + 1}`}
              onClick={() => handleJump(line)}
            />
          ))}

          {/* Error markers */}
          {errorMarkers.map((line, i) => (
            <div
              key={`err-${i}`}
              className="timeline-marker timeline-marker-error"
              style={{ left: `${(line / maxLine) * 100}%` }}
              title={`Error at line ${line + 1}`}
              onClick={() => handleJump(line)}
            />
          ))}

          {focusMode ? (
            <>
              <input
                type="range"
                className="range-start"
                min={0}
                max={maxLine}
                value={rangeStart}
                onChange={e => handleRangeStartChange(Number(e.target.value))}
                disabled={loading || totalLines === 0}
              />
              <input
                type="range"
                className="range-end"
                min={0}
                max={maxLine}
                value={rangeEnd}
                onChange={e => handleRangeEndChange(Number(e.target.value))}
                disabled={loading || totalLines === 0}
              />
            </>
          ) : (
            <input
              type="range"
              min={0}
              max={maxLine}
              value={currentLine ?? 0}
              onChange={e => !loading && handleJump(Number(e.target.value))}
              disabled={loading || totalLines === 0}
            />
          )}
        </div>

        <span className="timeline-label" style={{ textAlign: 'right' }}>
          {totalLines > 0 ? `${totalLines} lines` : ''}
        </span>
      </div>
    </div>
  );
}
