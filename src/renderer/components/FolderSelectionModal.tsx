import React, { useState } from 'react';
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
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [useDefaultFolder, setUseDefaultFolder] = useState<boolean>(!!defaultFolder);

  const handleSelectFolder = async () => {
    try {
      const result = await window.electron.selectFolder();
      if (result.success && result.path) {
        setSelectedPath(result.path);
        setUseDefaultFolder(false);
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
    }
  };

  const handleConfirm = () => {
    const folderToUse = useDefaultFolder && defaultFolder ? defaultFolder : selectedPath;
    if (folderToUse) {
      onConfirm(folderToUse);
      setSelectedPath('');
      setUseDefaultFolder(!!defaultFolder);
    }
  };

  const handleCancel = () => {
    setSelectedPath('');
    setUseDefaultFolder(!!defaultFolder);
    onCancel();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Select Project Folder</h2>
        <p>Choose a folder for this conversation. The folder cannot be changed later.</p>

        {defaultFolder && (
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="radio"
                checked={useDefaultFolder}
                onChange={() => {
                  setUseDefaultFolder(true);
                  setSelectedPath('');
                }}
              />
              <span>Use current folder: <strong>{defaultFolder.split('/').pop() || defaultFolder}</strong></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
              <input
                type="radio"
                checked={!useDefaultFolder}
                onChange={() => setUseDefaultFolder(false)}
              />
              <span>Choose a different folder</span>
            </label>
          </div>
        )}

        {(!defaultFolder || !useDefaultFolder) && (
          <>
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
          </>
        )}

        <div className="modal-actions">
          <button className="cancel-btn" onClick={handleCancel}>
            Cancel
          </button>
          <button
            className="confirm-btn"
            onClick={handleConfirm}
            disabled={!useDefaultFolder && !selectedPath}
          >
            Create Chat
          </button>
        </div>
      </div>
    </div>
  );
};

export default FolderSelectionModal;
