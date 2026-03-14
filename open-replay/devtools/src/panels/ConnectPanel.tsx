import React, { useState, useEffect } from 'react';

export function ConnectPanel({ onConnect }: { onConnect: (url: string) => void }) {
  // Auto-detect: use same host/port as the page was loaded from
  const autoUrl = `ws://${window.location.host}`;
  const [url, setUrl] = useState(autoUrl);
  const [autoConnecting, setAutoConnecting] = useState(true);

  // Auto-connect on mount
  useEffect(() => {
    setAutoConnecting(true);
    onConnect(autoUrl);
  }, []);

  return (
    <div className="connect-panel">
      <h2>Open Replay DevTools</h2>
      {autoConnecting ? (
        <p className="hint">Connecting to {autoUrl}...</p>
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
    </div>
  );
}
