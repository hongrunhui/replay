import React from 'react';
import { RecordingInfo } from '../protocol';

type Props = {
  info: RecordingInfo | null;
  totalEvents?: number;
};

export function RecordingInfoBar({ info, totalEvents }: Props) {
  if (!info) return null;

  const scriptName = (info as any).scriptPath
    ? (info as any).scriptPath.split('/').pop()
    : info.title || 'Unknown';

  const timestamp = info.timestamp
    ? new Date(info.timestamp).toLocaleString()
    : '';

  return (
    <div className="recording-info-bar">
      <div className="recording-info-item">
        <span className="recording-info-label">Script</span>
        <span className="recording-info-value" title={(info as any).scriptPath || info.title}>
          {scriptName}
        </span>
      </div>
      {info.recordingPath && (
        <div className="recording-info-item">
          <span className="recording-info-label">Recording</span>
          <span className="recording-info-value" title={info.recordingPath}>
            {info.recordingPath.split('/').pop()}
          </span>
        </div>
      )}
      {timestamp && (
        <div className="recording-info-item">
          <span className="recording-info-label">Recorded</span>
          <span className="recording-info-value">{timestamp}</span>
        </div>
      )}
      {totalEvents != null && totalEvents > 0 && (
        <div className="recording-info-item">
          <span className="recording-info-label">Events</span>
          <span className="recording-info-value">{totalEvents.toLocaleString()}</span>
        </div>
      )}
      {info.buildId && (
        <div className="recording-info-item">
          <span className="recording-info-label">Build</span>
          <span className="recording-info-value">{info.buildId}</span>
        </div>
      )}
    </div>
  );
}
