import React from 'react';

export type Step = {
  line: number;
  column: number;
  kind: 'step' | 'call' | 'return';
};

type Props = {
  steps: Step[];
  currentLine: number | null;
  onJumpToStep: (line: number) => void;
};

export function FrameStepsPanel({ steps, currentLine, onJumpToStep }: Props) {
  if (steps.length === 0) {
    return (
      <div className="panel-section">
        <div className="panel-header">Frame Steps</div>
        <div className="panel-body">
          <span style={{ color: '#666', fontSize: 12 }}>No steps available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-section">
      <div className="panel-header">Frame Steps ({steps.length})</div>
      <div className="panel-body frame-steps-body">
        {steps.map((step, i) => {
          const isCurrent = currentLine !== null && step.line === currentLine;
          return (
            <div
              key={i}
              className={`frame-step-row ${isCurrent ? 'active' : ''}`}
              onClick={() => onJumpToStep(step.line)}
            >
              <span className="frame-step-icon">
                {step.kind === 'call' ? '\u2192' : step.kind === 'return' ? '\u2190' : '\u2022'}
              </span>
              <span className="frame-step-line">Line {step.line + 1}</span>
              <span className="frame-step-kind">{step.kind}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
