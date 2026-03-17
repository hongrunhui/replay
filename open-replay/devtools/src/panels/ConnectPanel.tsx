import React, { useState, useEffect } from 'react';

export function ConnectPanel({ onConnect }: { onConnect: (url: string) => void }) {
  const autoUrl = `ws://${window.location.host}`;
  const [url, setUrl] = useState(autoUrl);
  const [autoConnecting, setAutoConnecting] = useState(true);

  useEffect(() => {
    setAutoConnecting(true);
    onConnect(autoUrl);
  }, []);

  return (
    <div className="connect-panel">
      <div className="connect-panel-logo">
        <div className="connect-panel-logo-icon">OR</div>
        <div className="connect-panel-logo-text">Open Replay</div>
      </div>

      {autoConnecting ? (
        <p className="connecting-spinner">Connecting to {autoUrl}...</p>
      ) : (
        <>
          <p className="hint">
            Could not auto-connect. Enter the server address:
          </p>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="ws://localhost:1234"
            onKeyDown={e => e.key === 'Enter' && onConnect(url)}
          />
          <button onClick={() => onConnect(url)}>Connect</button>
        </>
      )}
      <p className="hint" style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
        Start a replay server with: openreplay replay &lt;recording-id&gt;
      </p>
    </div>
  );
}
