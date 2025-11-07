import React, { useState, useEffect } from 'react';
import './FolderSelectionModal.css';

interface FolderSelectionModalProps {
  isOpen: boolean;
  onConfirm: (folderPath: string, mode?: string) => void;
  onCancel: () => void;
  defaultFolder?: string;
}

const FolderSelectionModal: React.FC<FolderSelectionModalProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  defaultFolder,
}) => {
  const [selectedPath, setSelectedPath] = useState<string>(defaultFolder || '');
  const [selectedMode, setSelectedMode] = useState<string>('default');

  // Update selectedPath and reset mode when defaultFolder changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPath(defaultFolder || '');
      setSelectedMode('default');
    }
  }, [isOpen, defaultFolder]);

  const handleSelectFolder = async () => {
    try {
      const result = await window.electron.selectFolder();
      if (result.success && result.path) {
        setSelectedPath(result.path);
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
    }
  };

  const handleConfirm = () => {
    if (selectedPath) {
      onConfirm(selectedPath, selectedMode);
      setSelectedPath(defaultFolder || '');
      setSelectedMode('default');
    }
  };

  const handleCancel = () => {
    setSelectedPath(defaultFolder || '');
    setSelectedMode('default');
    onCancel();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Select Project Folder</h2>
        <p>Choose a folder for this conversation. The folder cannot be changed later.</p>

        <div className="folder-display">
          {selectedPath ? (
            <div className="selected-path">
              <span className="path-label">Selected:</span>
              <span className="path-value">{selectedPath}</span>
            </div>
          ) : (
            <div className="no-selection">No folder selected</div>
          )}
        </div>

        <button className="select-folder-btn" onClick={handleSelectFolder}>
          Browse...
        </button>

        <div className="mode-selection">
          <label htmlFor="permission-mode">Permission Mode:</label>
          <select
            id="permission-mode"
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value)}
            className="mode-select"
          >
            <option value="default">Ask for Permissions</option>
            <option value="acceptEdits">Accept Edits Only</option>
            <option value="bypassPermissions">Auto-Accept All</option>
            <option value="plan">Plan Mode</option>
          </select>
        </div>

        <div className="modal-actions">
          <button className="cancel-btn" onClick={handleCancel}>
            Cancel
          </button>
          <button
            className="confirm-btn"
            onClick={handleConfirm}
            disabled={!selectedPath}
          >
            Create Chat
          </button>
        </div>
      </div>
    </div>
  );
};

export default FolderSelectionModal;
