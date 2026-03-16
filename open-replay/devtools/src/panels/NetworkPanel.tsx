import React, { useState, useMemo } from 'react';
import { NetworkRequest } from '../protocol';

type NetworkFilter = 'all' | 'xhr' | 'fetch' | 'other';

type NetworkPanelProps = {
  requests: NetworkRequest[];
  onSelectRequest?: (req: NetworkRequest) => void;
};

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'net-status-2xx';
  if (status >= 300 && status < 400) return 'net-status-3xx';
  if (status >= 400 && status < 500) return 'net-status-4xx';
  if (status >= 500) return 'net-status-5xx';
  return '';
}

function methodClass(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return 'net-method-get';
    case 'POST': return 'net-method-post';
    case 'PUT': return 'net-method-put';
    case 'DELETE': return 'net-method-delete';
    case 'PATCH': return 'net-method-patch';
    default: return '';
  }
}

export function NetworkPanel({ requests, onSelectRequest }: NetworkPanelProps) {
  const [filter, setFilter] = useState<NetworkFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter(r => r.type === filter);
  }, [requests, filter]);

  const counts = useMemo(() => {
    const c = { all: requests.length, xhr: 0, fetch: 0, other: 0 };
    for (const r of requests) {
      if (r.type === 'xhr') c.xhr++;
      else if (r.type === 'fetch') c.fetch++;
      else c.other++;
    }
    return c;
  }, [requests]);

  const handleSelect = (req: NetworkRequest) => {
    setSelectedId(req.id === selectedId ? null : req.id);
    onSelectRequest?.(req);
  };

  return (
    <div className="panel-section" style={{ flex: 1 }}>
      <div className="panel-header console-header">
        <span>Network ({filtered.length})</span>
        <div className="console-filters">
          {(['all', 'xhr', 'fetch', 'other'] as NetworkFilter[]).map(level => (
            <button
              key={level}
              className={`console-filter-btn ${filter === level ? 'active' : ''}`}
              onClick={() => setFilter(level)}
            >
              {level === 'all' ? 'All' : level.toUpperCase()}
              {counts[level] > 0 && <span className="console-filter-count">{counts[level]}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body" style={{ maxHeight: 'none', flex: 1, padding: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ color: '#666', fontSize: 12, padding: '16px 12px', textAlign: 'center' }}>
            No network requests captured
          </div>
        ) : (
          <table className="net-table">
            <thead>
              <tr>
                <th className="net-th" style={{ width: 60 }}>Method</th>
                <th className="net-th">URL</th>
                <th className="net-th" style={{ width: 60 }}>Status</th>
                <th className="net-th" style={{ width: 80 }}>Duration</th>
                <th className="net-th" style={{ width: 70 }}>Size</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((req) => (
                <tr
                  key={req.id}
                  className={`net-row ${selectedId === req.id ? 'net-row-selected' : ''}`}
                  onClick={() => handleSelect(req)}
                >
                  <td className="net-td">
                    <span className={`net-method-badge ${methodClass(req.method)}`}>
                      {req.method}
                    </span>
                  </td>
                  <td className="net-td net-url" title={req.url}>{req.url}</td>
                  <td className="net-td">
                    <span className={`net-status ${statusClass(req.status)}`}>
                      {req.status} {req.statusText}
                    </span>
                  </td>
                  <td className="net-td net-duration">{formatDuration(req.duration)}</td>
                  <td className="net-td net-size">{formatSize(req.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
