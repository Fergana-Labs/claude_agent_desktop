import React, { useState } from 'react';
import { Message } from '../types';

interface ErrorMessageProps {
  message: Message;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ message }) => {
  const [expanded, setExpanded] = useState(false);
  const metadata = message.metadata || {};

  const getSummary = (): string => {
    const errorType = metadata.errorType || 'Error';
    const preview = message.content.substring(0, 60);
    return `${errorType}: ${preview.length < message.content.length ? preview + '...' : preview}`;
  };

  return (
    <div className="tool-message error-message">
      <div className="tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon">⚠</span>
        <span className="tool-summary">{getSummary()}</span>
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="tool-details">
          <div className="error-detail-section">
            <pre className="error-content">{message.content}</pre>
            {metadata.stack && (
              <div className="stack-trace">
                <strong>Stack Trace:</strong>
                <pre>{metadata.stack}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
