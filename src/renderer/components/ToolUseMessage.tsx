import React, { useState } from 'react';
import { Message } from '../types';

interface ToolUseMessageProps {
  message: Message;
}

export const ToolUseMessage: React.FC<ToolUseMessageProps> = ({ message }) => {
  const [expanded, setExpanded] = useState(false);
  const metadata = message.metadata || {};
  const toolName = metadata.toolName || 'Tool';
  const input = metadata.input || {};

  // Get tool icon
  const getToolIcon = (tool: string) => {
    if (tool.toLowerCase().includes('read')) return '⏺';
    if (tool.toLowerCase().includes('write')) return '✎';
    if (tool.toLowerCase().includes('edit')) return '✎';
    if (tool.toLowerCase().includes('bash')) return '▶';
    if (tool.toLowerCase().includes('grep')) return '🔍';
    if (tool.toLowerCase().includes('glob')) return '📁';
    return '🔧';
  };

  // Extract file path if present
  const getFilePath = (input: any): string | null => {
    if (input.file_path) return input.file_path;
    if (input.path) return input.path;
    if (input.notebook_path) return input.notebook_path;
    return null;
  };

  const filePath = getFilePath(input);

  // Format tool summary
  const getSummary = (): string => {
    if (filePath) {
      const fileName = filePath.split('/').pop();
      return `${toolName}(${fileName})`;
    }
    if (input.command) {
      const commandPreview = input.command.length > 50
        ? input.command.substring(0, 50) + '...'
        : input.command;
      return `${toolName}: ${commandPreview}`;
    }
    if (input.pattern) {
      return `${toolName}("${input.pattern}")`;
    }
    return toolName;
  };

  const handleFileClick = (path: string) => {
    window.electron.openFile(path);
  };

  return (
    <div className="tool-message tool-use-message">
      <div className="tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon">{getToolIcon(toolName)}</span>
        <span className="tool-summary">{getSummary()}</span>
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="tool-details">
          <div className="tool-detail-section">
            <strong>Tool:</strong> {toolName}
          </div>
          {filePath && (
            <div className="tool-detail-section">
              <strong>File:</strong>{' '}
              <span className="file-link" onClick={() => handleFileClick(filePath)}>
                {filePath}
              </span>
            </div>
          )}
          {Object.keys(input).length > 0 && (
            <div className="tool-detail-section">
              <strong>Parameters:</strong>
              <pre className="tool-input">{JSON.stringify(input, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
