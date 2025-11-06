import React, { useState, useEffect } from 'react';
import './FolderSelectionModal.css';

interface FolderSelectionModalProps {
  isOpen: boolean;
  onConfirm: (folderPath: string) => void;
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

  // Update selectedPath when defaultFolder changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPath(defaultFolder || '');
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
      onConfirm(selectedPath);
      setSelectedPath(defaultFolder || '');
    }
  };

  const handleCancel = () => {
    setSelectedPath(defaultFolder || '');
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
