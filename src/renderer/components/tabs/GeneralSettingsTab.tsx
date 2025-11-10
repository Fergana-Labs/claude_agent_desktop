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

  // API Key state
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState('');
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);

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
    const initialTheme = (savedTheme && ['dark', 'light'].includes(savedTheme)) ? savedTheme : 'dark';
    setTheme(initialTheme);
    applyTheme(initialTheme);

    const savedAudio = localStorage.getItem('audioNotificationsEnabled');
    setAudioEnabled(savedAudio !== 'false'); // Default to true if not set

    // Load API key status
    loadApiKeyStatus();
  }, []);

  const loadApiKeyStatus = async () => {
    try {
      const result = await window.electron.getApiKeyStatus();
      setHasApiKey(result.hasApiKey);
      // If API key is set, show placeholder dots (will fetch real key when user clicks Show)
      if (result.hasApiKey) {
        setApiKey('••••••••••••••••••••');
        setShowApiKey(false); // Always start with hidden
      }
    } catch (error) {
      console.error('Failed to load API key status:', error);
    }
  };

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

  const handleSaveApiKey = async () => {
    // Don't save if it's just the placeholder
    if (apiKey === '••••••••••••••••••••' || !apiKey.trim()) {
      return;
    }

    setApiKeyError('');
    setIsSavingApiKey(true);

    try {
      const result = await window.electron.setApiKey(apiKey);

      if (result.success) {
        setHasApiKey(true);
        setApiKey('••••••••••••••••••••'); // Show placeholder after successful save
        setShowApiKey(false);
      } else {
        setApiKeyError(result.error || 'Failed to save API key');
      }
    } catch (error) {
      console.error('Error saving API key:', error);
      setApiKeyError('An unexpected error occurred');
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const handleClearApiKey = async () => {
    if (!confirm('Are you sure you want to delete your API key? You will need to re-enter it to use Claude.')) {
      return;
    }

    try {
      const result = await window.electron.deleteApiKey();

      if (result.success) {
        setHasApiKey(false);
        setApiKey('');
        setApiKeyError('');
      } else {
        setApiKeyError(result.error || 'Failed to delete API key');
      }
    } catch (error) {
      console.error('Error deleting API key:', error);
      setApiKeyError('An unexpected error occurred');
    }
  };

  const handleToggleShowApiKey = async () => {
    if (!showApiKey && hasApiKey) {
      // Fetch the real API key when showing
      try {
        const result = await window.electron.getApiKey();
        if (result.apiKey) {
          setApiKey(result.apiKey);
          setShowApiKey(true);
        }
      } catch (error) {
        console.error('Failed to fetch API key:', error);
        setApiKeyError('Failed to retrieve API key');
      }
    } else {
      // Hide the API key
      setShowApiKey(false);
      if (hasApiKey) {
        setApiKey('••••••••••••••••••••');
      }
    }
  };

  return (
    <div className="general-settings-tab">
      <div className="settings-section">
        <h3>Anthropic API Key</h3>
        <p className="settings-description">
          Your API key is stored securely and encrypted on your device. Get your API key from{' '}
          <a
            href="https://console.anthropic.com/settings/keys"
            className="api-key-help-link"
            onClick={(e) => {
              e.preventDefault();
              window.electron.openFile('https://console.anthropic.com/settings/keys');
            }}
          >
            console.anthropic.com
          </a>
        </p>
        <div className="setting-item">
          <div className={`api-key-status ${hasApiKey ? 'set' : 'not-set'}`}>
            {hasApiKey ? '✓ API Key Set' : '⚠ API Key Not Set'}
          </div>

          <div className="api-key-input-container">
            <div className="api-key-input-wrapper">
              <input
                type={showApiKey ? 'text' : 'password'}
                className="api-key-input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                disabled={isSavingApiKey}
                readOnly={hasApiKey}
              />
              {hasApiKey && (
                <button
                  className="api-key-toggle"
                  onClick={handleToggleShowApiKey}
                  type="button"
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
            <div className="api-key-actions">
              {!hasApiKey && (
                <button
                  className="save-api-key-btn"
                  onClick={handleSaveApiKey}
                  disabled={!apiKey.trim() || isSavingApiKey}
                >
                  {isSavingApiKey ? 'Saving...' : 'Save'}
                </button>
              )}
              {hasApiKey && (
                <button
                  className="clear-api-key-btn"
                  onClick={handleClearApiKey}
                  disabled={isSavingApiKey}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {apiKeyError && (
            <p className="api-key-error">{apiKeyError}</p>
          )}
        </div>
      </div>

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
            <option value="sonnet">Claude Sonnet 4.5</option>
            <option value="opus">Claude Opus 4.1</option>
            <option value="haiku">Claude Haiku 4.5</option>
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
