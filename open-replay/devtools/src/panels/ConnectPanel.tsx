import React, { useState } from 'react';

export function ConnectPanel({ onConnect }: { onConnect: (url: string) => void }) {
  const [url, setUrl] = useState('ws://localhost:1234');

  return (
    <div className="connect-panel">
      <h2>Open Replay DevTools</h2>
      <p className="hint">
        Start a replay server first:<br />
        <code>openreplay replay &lt;uuid&gt; --server --port 1234</code>
      </p>
      <input
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="ws://localhost:1234"
        onKeyDown={e => e.key === 'Enter' && onConnect(url)}
      />
      <button onClick={() => onConnect(url)}>Connect</button>
    </div>
  );
}
