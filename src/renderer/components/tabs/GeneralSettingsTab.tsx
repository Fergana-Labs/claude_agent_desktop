import React, { useState, useEffect } from 'react';
import './GeneralSettingsTab.css';

type ModelType = 'sonnet' | 'opus' | 'haiku';
type ThemeType = 'dark' | 'light';

const GeneralSettingsTab: React.FC = () => {
  const [selectedModel, setSelectedModel] = useState<ModelType>('sonnet');
  const [hideBypassWarning, setHideBypassWarning] = useState(false);
  const [additionalDirectories, setAdditionalDirectories] = useState<string[]>([]);
  const [theme, setTheme] = useState<ThemeType>('dark');
  const [audioEnabled, setAudioEnabled] = useState(true);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedModel = localStorage.getItem('selectedModel') as ModelType | null;
    if (savedModel && ['sonnet', 'opus', 'haiku'].includes(savedModel)) {
      setSelectedModel(savedModel);
    }

    const savedHideWarning = localStorage.getItem('hideAutoAcceptWarning');
    setHideBypassWarning(savedHideWarning === 'true');

    const savedDirs = localStorage.getItem('additionalDirectories');
    if (savedDirs) {
      try {
        const dirs = JSON.parse(savedDirs);
        if (Array.isArray(dirs)) {
          setAdditionalDirectories(dirs);
        }
      } catch (e) {
        console.error('Failed to parse additionalDirectories:', e);
      }
    }

    const savedTheme = localStorage.getItem('theme') as ThemeType | null;
    if (savedTheme && ['dark', 'light'].includes(savedTheme)) {
      setTheme(savedTheme);
      applyTheme(savedTheme);
    }

    const savedAudio = localStorage.getItem('audioNotificationsEnabled');
    setAudioEnabled(savedAudio !== 'false'); // Default to true if not set
  }, []);

  const applyTheme = (newTheme: ThemeType) => {
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  const handleModelChange = (model: ModelType) => {
    setSelectedModel(model);
    localStorage.setItem('selectedModel', model);

    // Notify main process of settings change
    window.electron.updateAppSettings({ model }).catch(err => {
      console.error('Failed to update app settings:', err);
    });
  };

  const handleBypassWarningToggle = () => {
    const newValue = !hideBypassWarning;
    setHideBypassWarning(newValue);
    localStorage.setItem('hideAutoAcceptWarning', newValue.toString());
  };

  const handleAddDirectory = async () => {
    try {
      const result = await window.electron.selectFolder();
      if (result && result.success && result.path) {
        if (!additionalDirectories.includes(result.path)) {
          const newDirs = [...additionalDirectories, result.path];
          setAdditionalDirectories(newDirs);
          localStorage.setItem('additionalDirectories', JSON.stringify(newDirs));

          // Notify main process of settings change
          window.electron.updateAppSettings({ additionalDirectories: newDirs }).catch(err => {
            console.error('Failed to update app settings:', err);
          });
        }
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  const handleRemoveDirectory = (dir: string) => {
    const newDirs = additionalDirectories.filter(d => d !== dir);
    setAdditionalDirectories(newDirs);
    localStorage.setItem('additionalDirectories', JSON.stringify(newDirs));

    // Notify main process of settings change
    window.electron.updateAppSettings({ additionalDirectories: newDirs }).catch(err => {
      console.error('Failed to update app settings:', err);
    });
  };

  const handleThemeChange = (newTheme: ThemeType) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
  };

  const handleAudioToggle = () => {
    const newValue = !audioEnabled;
    setAudioEnabled(newValue);
    localStorage.setItem('audioNotificationsEnabled', newValue.toString());
  };

  return (
    <div className="general-settings-tab">
      <div className="settings-section">
        <h3>Model Selection</h3>
        <p className="settings-description">Choose which Claude model to use for conversations</p>
        <div className="setting-item">
          <label htmlFor="model-select">Model:</label>
          <select
            id="model-select"
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value as ModelType)}
            className="settings-select"
          >
            <option value="sonnet">Claude 3.5 Sonnet</option>
            <option value="opus">Claude 3 Opus</option>
            <option value="haiku">Claude 3 Haiku</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3>Permissions</h3>
        <p className="settings-description">Configure permission and warning settings</p>
        <div className="setting-item checkbox-item">
          <label>
            <input
              type="checkbox"
              checked={hideBypassWarning}
              onChange={handleBypassWarningToggle}
            />
            <span>Don't show bypass permissions warning</span>
          </label>
          <p className="setting-help">
            Hides the warning modal when enabling "Auto-Accept All" mode
          </p>
        </div>
      </div>

      <div className="settings-section">
        <h3>Additional Directories</h3>
        <p className="settings-description">
          Grant Claude access to additional folders beyond the project folder
        </p>
        <div className="setting-item">
          <div className="directories-list">
            {additionalDirectories.length === 0 ? (
              <div className="no-directories">No additional directories configured</div>
            ) : (
              additionalDirectories.map((dir, index) => (
                <div key={index} className="directory-item">
                  <span className="directory-path">{dir}</span>
                  <button
                    className="remove-directory-btn"
                    onClick={() => handleRemoveDirectory(dir)}
                    aria-label="Remove directory"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
          <button className="add-directory-btn" onClick={handleAddDirectory}>
            + Add Directory
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3>Appearance</h3>
        <p className="settings-description">Customize the visual theme</p>
        <div className="setting-item">
          <label>Theme:</label>
          <div className="theme-selector">
            <button
              className={`theme-btn ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => handleThemeChange('dark')}
            >
              Dark
            </button>
            <button
              className={`theme-btn ${theme === 'light' ? 'active' : ''}`}
              onClick={() => handleThemeChange('light')}
            >
              Light
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Notifications</h3>
        <p className="settings-description">Configure audio and visual notifications</p>
        <div className="setting-item checkbox-item">
          <label>
            <input
              type="checkbox"
              checked={audioEnabled}
              onChange={handleAudioToggle}
            />
            <span>Enable audio notification sounds</span>
          </label>
          <p className="setting-help">
            Play a sound when processing completes or permission is requested
          </p>
        </div>
      </div>
    </div>
  );
};

export default GeneralSettingsTab;
