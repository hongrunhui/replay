import React, { useMemo } from 'react';
import { SourceInfo } from '../protocol';

type Props = {
  sources: SourceInfo[];
  currentFile: string;
  onSelectFile: (filePath: string) => void;
};

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
        child = {
          name: part,
          fullPath: isLast ? url : parts.slice(0, i + 1).join('/'),
          isFile: isLast,
          children: [],
        };
        current.children.push(child);
      }
      if (isLast) {
        child.isFile = true;
        child.fullPath = url;
      }
      current = child;
    }
  }

  // Collapse single-child directories
  function collapse(node: TreeNode): TreeNode {
    node.children = node.children.map(collapse);
    if (!node.isFile && node.children.length === 1 && !node.children[0].isFile) {
      const child = node.children[0];
      return {
        name: node.name ? `${node.name}/${child.name}` : child.name,
        fullPath: child.fullPath,
        isFile: child.isFile,
        children: child.children,
      };
    }
    return node;
  }

  const collapsed = collapse(root);
  // Sort: directories first, then files, alphabetically
  function sortTree(nodes: TreeNode[]): TreeNode[] {
    return nodes.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    }).map(n => ({ ...n, children: sortTree(n.children) }));
  }

  return sortTree(collapsed.children);
}

function TreeItem({ node, depth, currentFile, onSelect }: {
  node: TreeNode;
  depth: number;
  currentFile: string;
  onSelect: (path: string) => void;
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
        <span className="source-tree-icon">&#x1F4C4;</span>
        {node.name}
      </div>
    );
  }

  return (
    <div>
      <div
        className="source-tree-dir"
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="source-tree-arrow">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="source-tree-icon">{expanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1'}</span>
        {node.name}
      </div>
      {expanded && node.children.map((child, i) => (
        <TreeItem
          key={child.fullPath + i}
          node={child}
          depth={depth + 1}
          currentFile={currentFile}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function SourceTreePanel({ sources, currentFile, onSelectFile }: Props) {
  const tree = useMemo(() => buildTree(sources), [sources]);

  if (sources.length === 0) {
    return (
      <div className="source-tree-panel">
        <div className="panel-header">Files</div>
        <div className="source-tree-body">
          <div style={{ color: '#666', fontSize: 11, padding: 8 }}>No sources available</div>
        </div>
      </div>
    );
  }

  return (
    <div className="source-tree-panel">
      <div className="panel-header">Files ({sources.length})</div>
      <div className="source-tree-body">
        {tree.map((node, i) => (
          <TreeItem
            key={node.fullPath + i}
            node={node}
            depth={0}
            currentFile={currentFile}
            onSelect={onSelectFile}
          />
        ))}
      </div>
    </div>
  );
}
