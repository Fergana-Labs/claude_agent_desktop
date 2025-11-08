import React, { useState } from 'react';
import './SettingsModal.css';
import GeneralSettingsTab from './tabs/GeneralSettingsTab';
import McpSettingsTab from './tabs/McpSettingsTab';
import SystemPromptTab from './tabs/SystemPromptTab';

type SettingsTab = 'general' | 'mcps' | 'systemPrompt';

interface SettingsModalProps {
  onClose: () => void;
  initialTab?: SettingsTab;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, initialTab = 'general' }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const handleOverlayClick = (e: React.MouseEvent) => {
    // Close modal if clicking on the overlay background
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="settings-modal-overlay" onClick={handleOverlayClick}>
      <div className="settings-modal-content">
        <div className="settings-modal-header">
          <h2>Settings</h2>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button
            className={`settings-tab ${activeTab === 'mcps' ? 'active' : ''}`}
            onClick={() => setActiveTab('mcps')}
          >
            MCPs
          </button>
          <button
            className={`settings-tab ${activeTab === 'systemPrompt' ? 'active' : ''}`}
            onClick={() => setActiveTab('systemPrompt')}
          >
            System Prompt
          </button>
        </div>

        <div className="settings-tab-content">
          {activeTab === 'general' && <GeneralSettingsTab />}
          {activeTab === 'mcps' && <McpSettingsTab />}
          {activeTab === 'systemPrompt' && <SystemPromptTab />}
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
