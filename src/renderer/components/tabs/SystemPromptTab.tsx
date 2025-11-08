import React, { useState, useEffect } from 'react';
import './SystemPromptTab.css';

type SystemPromptMode = 'append' | 'custom';

const SystemPromptTab: React.FC = () => {
  const [mode, setMode] = useState<SystemPromptMode>('append');
  const [promptText, setPromptText] = useState('');

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedMode = localStorage.getItem('systemPromptMode') as SystemPromptMode | null;
    if (savedMode && ['append', 'custom'].includes(savedMode)) {
      setMode(savedMode);
    }

    const savedPrompt = localStorage.getItem('customSystemPrompt');
    if (savedPrompt) {
      setPromptText(savedPrompt);
    }
  }, []);

  const handleModeChange = (newMode: SystemPromptMode) => {
    setMode(newMode);
    localStorage.setItem('systemPromptMode', newMode);

    // Notify main process of settings change
    window.electron.updateAppSettings({
      systemPromptMode: newMode,
      customSystemPrompt: promptText
    }).catch(err => {
      console.error('Failed to update app settings:', err);
    });
  };

  const handlePromptChange = (text: string) => {
    setPromptText(text);
    localStorage.setItem('customSystemPrompt', text);

    // Notify main process of settings change
    window.electron.updateAppSettings({
      systemPromptMode: mode,
      customSystemPrompt: text
    }).catch(err => {
      console.error('Failed to update app settings:', err);
    });
  };

  return (
    <div className="system-prompt-tab">
      <div className="tab-description">
        <p>
          Configure how Claude's system prompt is set for conversations. Choose between appending
          custom instructions to the default Claude Code prompt, or providing a completely custom prompt.
        </p>
      </div>

      <div className="prompt-mode-section">
        <h3>Prompt Mode</h3>
        <div className="mode-options">
          <label className={`mode-option ${mode === 'append' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="promptMode"
              value="append"
              checked={mode === 'append'}
              onChange={() => handleModeChange('append')}
            />
            <div className="mode-option-content">
              <div className="mode-option-header">
                <strong>Append to Claude Code</strong>
                <span className="mode-badge recommended">Recommended</span>
              </div>
              <p className="mode-description">
                Adds your custom instructions to the end of Claude Code's default system prompt.
                Preserves all built-in tool instructions and safety features while adding your customizations.
              </p>
            </div>
          </label>

          <label className={`mode-option ${mode === 'custom' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="promptMode"
              value="custom"
              checked={mode === 'custom'}
              onChange={() => handleModeChange('custom')}
            />
            <div className="mode-option-content">
              <div className="mode-option-header">
                <strong>Custom System Prompt</strong>
                <span className="mode-badge advanced">Advanced</span>
              </div>
              <p className="mode-description">
                Completely replaces the default system prompt with your own. You'll need to include
                all necessary tool instructions manually. Only use if you know what you're doing.
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="prompt-editor-section">
        <h3>
          {mode === 'append' ? 'Additional Instructions' : 'Custom System Prompt'}
        </h3>
        <p className="editor-help">
          {mode === 'append'
            ? 'Enter custom instructions to append to the default Claude Code system prompt. For example, coding standards, formatting preferences, or domain-specific knowledge.'
            : 'Enter your complete system prompt. This will replace all default instructions, so make sure to include any tool usage instructions you need.'}
        </p>
        <textarea
          className="prompt-editor"
          value={promptText}
          onChange={(e) => handlePromptChange(e.target.value)}
          placeholder={
            mode === 'append'
              ? 'Example: Always include detailed docstrings and type hints in Python code. Follow PEP 8 style guidelines strictly.'
              : 'Enter your complete system prompt here...'
          }
          rows={12}
        />
        <div className="character-count">
          {promptText.length} characters
        </div>
      </div>

      {mode === 'append' && (
        <div className="info-box">
          <h4>How Append Mode Works</h4>
          <p>
            Your instructions will be added to the end of the default Claude Code system prompt like this:
          </p>
          <div className="prompt-preview">
            <div className="prompt-preview-section">
              <span className="preview-label">Default Claude Code Prompt</span>
              <div className="preview-content dimmed">
                [Claude Code's default system prompt with tool instructions, code guidelines, etc.]
              </div>
            </div>
            <div className="prompt-preview-divider">+</div>
            <div className="prompt-preview-section">
              <span className="preview-label">Your Custom Instructions</span>
              <div className="preview-content">
                {promptText || <span className="preview-placeholder">Your custom instructions will appear here...</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === 'custom' && (
        <div className="warning-box">
          <h4>⚠️ Warning: Custom Mode</h4>
          <p>
            Using a custom system prompt means you're responsible for defining all behavior, including:
          </p>
          <ul>
            <li>Tool usage instructions and permissions</li>
            <li>Code formatting and style guidelines</li>
            <li>Safety and security considerations</li>
            <li>Response tone and communication style</li>
          </ul>
          <p>
            <strong>Most users should use Append mode instead.</strong> Only use Custom mode if you have
            specific requirements and understand the implications.
          </p>
        </div>
      )}

      <div className="settings-note">
        <p>
          <strong>Note:</strong> System prompt changes will apply to new conversations only.
          Existing conversations will continue to use the prompt they were started with.
        </p>
      </div>
    </div>
  );
};

export default SystemPromptTab;
