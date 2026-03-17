import React, { useState, useMemo } from 'react';
import { SourceInfo, ConsoleMessage } from '../protocol';

type SideTab = 'files' | 'debug' | 'events';

type Props = {
  sources: SourceInfo[];
  currentFile: string;
  onSelectFile: (filePath: string) => void;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  consoleMessages: ConsoleMessage[];
  onJumpToLine: (line: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

// ---- File Tree types and helpers ----
type TreeNode = {
  name: string;
  fullPath: string;
  isFile: boolean;
  children: TreeNode[];
};

function buildTree(sources: SourceInfo[]): TreeNode[] {
  const root: TreeNode = { name: '', fullPath: '', isFile: false, children: [] };
  for (const src of sources) {
    const url = src.url || src.sourceId;
    const parts = url.replace(/^(file:\/\/|\/)+/, '').split('/').filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = current.children.find(c => c.name === part);
      if (!child) {
        child = { name: part, fullPath: isLast ? url : parts.slice(0, i + 1).join('/'), isFile: isLast, children: [] };
        current.children.push(child);
      }
      if (isLast) { child.isFile = true; child.fullPath = url; }
      current = child;
    }
  }
  function collapse(node: TreeNode): TreeNode {
    node.children = node.children.map(collapse);
    if (!node.isFile && node.children.length === 1 && !node.children[0].isFile) {
      const child = node.children[0];
      return { name: node.name ? `${node.name}/${child.name}` : child.name, fullPath: child.fullPath, isFile: child.isFile, children: child.children };
    }
    return node;
  }
  function sortTree(nodes: TreeNode[]): TreeNode[] {
    return nodes.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    }).map(n => ({ ...n, children: sortTree(n.children) }));
  }
  return sortTree(collapse(root).children);
}

function TreeItem({ node, depth, currentFile, onSelect }: {
  node: TreeNode; depth: number; currentFile: string; onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(depth < 2);
  const isActive = node.isFile && node.fullPath === currentFile;

  if (node.isFile) {
    return (
      <div
        className={`source-tree-file ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onSelect(node.fullPath)}
        title={node.fullPath}
      >
        <span className="source-tree-icon">{'\uD83D\uDCC4'}</span>
        {node.name}
      </div>
    );
  }

  return (
    <div>
      <div className="source-tree-dir" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => setExpanded(!expanded)}>
        <span className="source-tree-arrow">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="source-tree-icon">{expanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1'}</span>
        {node.name}
      </div>
      {expanded && node.children.map((child, i) => (
        <TreeItem key={child.fullPath + i} node={child} depth={depth + 1} currentFile={currentFile} onSelect={onSelect} />
      ))}
    </div>
  );
}

// ---- Main SidePanel ----
export function SidePanel({
  sources, currentFile, onSelectFile,
  breakpoints, onToggleBreakpoint,
  consoleMessages, onJumpToLine,
  collapsed, onToggleCollapse,
}: Props) {
  const [activeTab, setActiveTab] = useState<SideTab>('files');
  const tree = useMemo(() => buildTree(sources), [sources]);

  // Debug tab sections
  const [bpOpen, setBpOpen] = useState(true);

  const bpList = useMemo(() => Array.from(breakpoints).sort((a, b) => a - b), [breakpoints]);

  if (collapsed) {
    return (
      <div className="side-panel collapsed">
        <div className="side-panel-toggle" onClick={onToggleCollapse}>
          {'\u25B6'}
        </div>
      </div>
    );
  }

  return (
    <div className="side-panel">
      <div className="side-panel-tabs">
        <button
          className={`side-panel-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          Files
        </button>
        <button
          className={`side-panel-tab ${activeTab === 'debug' ? 'active' : ''}`}
          onClick={() => setActiveTab('debug')}
        >
          Debug
        </button>
        <button
          className={`side-panel-tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          Events
        </button>
        <button
          className="panel-toggle-btn"
          onClick={onToggleCollapse}
          title="Collapse panel"
          style={{ margin: '4px 4px 4px 0' }}
        >
          {'\u25C0'}
        </button>
      </div>

      <div className="side-panel-content">
        {activeTab === 'files' && (
          <div className="source-tree-panel">
            <div className="source-tree-body">
              {sources.length === 0 ? (
                <div className="panel-empty" style={{ padding: 8 }}>No sources available</div>
              ) : (
                tree.map((node, i) => (
                  <TreeItem key={node.fullPath + i} node={node} depth={0} currentFile={currentFile} onSelect={onSelectFile} />
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'debug' && (
          <div>
            <div className="debug-section-header" onClick={() => setBpOpen(!bpOpen)}>
              <span className={`debug-section-arrow ${bpOpen ? 'open' : ''}`}>{'\u25B6'}</span>
              Breakpoints ({bpList.length})
            </div>
            {bpOpen && (
              <div style={{ padding: '4px 0' }}>
                {bpList.length === 0 ? (
                  <div className="panel-empty" style={{ padding: '4px 10px' }}>No breakpoints set</div>
                ) : (
                  bpList.map(line => (
                    <div key={line} className="breakpoint-item" onClick={() => onJumpToLine(line)}>
                      <span className="breakpoint-dot" />
                      <span>Line {line + 1}</span>
                      <button
                        className="watch-remove"
                        onClick={(e) => { e.stopPropagation(); onToggleBreakpoint(line); }}
                        title="Remove breakpoint"
                      >
                        x
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'events' && (
          <div style={{ padding: '4px 0' }}>
            {consoleMessages.length === 0 ? (
              <div className="panel-empty" style={{ padding: '4px 10px' }}>No events yet</div>
            ) : (
              consoleMessages.map((msg, i) => (
                <div
                  key={i}
                  className="event-item"
                  onClick={() => { if (msg.line != null) onJumpToLine(msg.line); }}
                  title={msg.line != null ? `Jump to line ${msg.line + 1}` : undefined}
                >
                  <span className={`event-icon ${msg.level}`} />
                  <span className="event-text">{msg.text}</span>
                  {msg.line != null && <span className="event-line">:{msg.line + 1}</span>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
