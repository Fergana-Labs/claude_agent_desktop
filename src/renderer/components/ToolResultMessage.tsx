import React, { useState } from 'react';
import { Message } from '../types';

interface ToolResultMessageProps {
  message: Message;
}

export const ToolResultMessage: React.FC<ToolResultMessageProps> = ({ message }) => {
  const [expanded, setExpanded] = useState(false);
  const metadata = message.metadata || {};
  const toolName = metadata.toolName || 'Tool';
  const result = metadata.result || {};
  const hasError = metadata.error || result.error;

  // Format summary
  const getSummary = (): string => {
    if (hasError) {
      return `Error in ${toolName}`;
    }

    // For Read tool
    if (result.lines || result.lineCount) {
      const lines = result.lineCount || (Array.isArray(result.lines) ? result.lines.length : 0);
      return `Read ${lines} lines`;
    }

    // For Write/Edit tools
    if (toolName.toLowerCase().includes('write') || toolName.toLowerCase().includes('edit')) {
      return `${toolName} completed`;
    }

    // For Bash commands
    if (result.stdout || result.stderr) {
      const outputLength = (result.stdout?.length || 0) + (result.stderr?.length || 0);
      return `Command completed (${outputLength} chars)`;
    }

    // For Grep/Glob
    if (result.matches) {
      const count = Array.isArray(result.matches) ? result.matches.length : 0;
      return `Found ${count} matches`;
    }

    // Generic
    return `${toolName} completed`;
  };

  return (
    <div className={`tool-message tool-result-message ${hasError ? 'has-error' : ''}`}>
      <div className="tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon">⎿</span>
        <span className="tool-summary">{getSummary()}</span>
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="tool-details">
          {hasError && (
            <div className="tool-detail-section error-section">
              <strong>Error:</strong>
              <pre className="error-content">{metadata.error || result.error}</pre>
            </div>
          )}
          {result.stdout && (
            <div className="tool-detail-section">
              <strong>Output:</strong>
              <pre className="output-content">{result.stdout}</pre>
            </div>
          )}
          {result.stderr && (
            <div className="tool-detail-section">
              <strong>Error Output:</strong>
              <pre className="error-content">{result.stderr}</pre>
            </div>
          )}
          {result.lines && Array.isArray(result.lines) && (
            <div className="tool-detail-section">
              <strong>Content:</strong>
              <pre className="output-content">{result.lines.join('\n')}</pre>
            </div>
          )}
          {result.matches && Array.isArray(result.matches) && (
            <div className="tool-detail-section">
              <strong>Matches:</strong>
              <pre className="output-content">{result.matches.join('\n')}</pre>
            </div>
          )}
          {message.content && message.content.trim() && (
            <div className="tool-detail-section">
              <strong>Details:</strong>
              <div className="content">{message.content}</div>
            </div>
          )}
          {!hasError && !result.stdout && !result.stderr && !result.lines && !result.matches && !message.content && (
            <div className="tool-detail-section">
              <pre className="output-content">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
