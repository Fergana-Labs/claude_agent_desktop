import React, { useState } from 'react';
import { Message } from '../types';

interface ThinkingMessageProps {
  message: Message;
}

export const ThinkingMessage: React.FC<ThinkingMessageProps> = ({ message }) => {
  const [expanded, setExpanded] = useState(false);

  const getSummary = (): string => {
    const preview = message.content.substring(0, 60);
    return preview.length < message.content.length ? preview + '...' : preview;
  };

  return (
    <div className="tool-message thinking-message">
      <div className="tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon">∴</span>
        <span className="tool-summary">{expanded ? 'Thinking...' : `Thinking: ${getSummary()}`}</span>
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="tool-details">
          <div className="thinking-content">{message.content}</div>
        </div>
      )}
    </div>
  );
};
