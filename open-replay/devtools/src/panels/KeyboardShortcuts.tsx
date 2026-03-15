import React, { useState, useEffect } from 'react';

const SHORTCUTS = [
  { keys: 'F8', description: 'Step forward' },
  { keys: 'Shift+F8', description: 'Step backward' },
  { keys: 'Ctrl+Enter', description: 'Step forward (alt)' },
  { keys: 'Ctrl+F / Cmd+F', description: 'Search in source' },
  { keys: 'Enter', description: 'Next search match' },
  { keys: 'Shift+Enter', description: 'Previous search match' },
  { keys: 'Escape', description: 'Close search / Clear tooltip' },
  { keys: '?', description: 'Toggle this help' },
];

export function KeyboardShortcuts() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only trigger on '?' when not in an input/textarea
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setVisible(v => !v);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!visible) {
    return (
      <button
        className="shortcuts-help-btn"
        onClick={() => setVisible(true)}
        title="Keyboard shortcuts (?)"
      >
        ?
      </button>
    );
  }

  return (
    <>
      <div className="shortcuts-overlay" onClick={() => setVisible(false)} />
      <div className="shortcuts-modal">
        <div className="shortcuts-modal-header">
          <span>Keyboard Shortcuts</span>
          <button className="shortcuts-close-btn" onClick={() => setVisible(false)}>&#x2715;</button>
        </div>
        <div className="shortcuts-modal-body">
          {SHORTCUTS.map(({ keys, description }) => (
            <div key={keys} className="shortcut-row">
              <span className="shortcut-keys">
                {keys.split('+').map((k, i) => (
                  <span key={i}>
                    {i > 0 && <span className="shortcut-plus">+</span>}
                    <kbd className="shortcut-kbd">{k.trim()}</kbd>
                  </span>
                ))}
              </span>
              <span className="shortcut-desc">{description}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
