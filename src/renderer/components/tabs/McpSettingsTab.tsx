import React, { useState, useEffect } from 'react';
import './McpSettingsTab.css';

interface McpServer {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

interface McpConfig {
  [key: string]: McpServer;
}

interface ServerConnectionStatus {
  [key: string]: 'idle' | 'connecting' | 'connected' | 'failed';
}

const McpSettingsTab: React.FC = () => {
  const [config, setConfig] = useState<McpConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [editingServers, setEditingServers] = useState<Set<string>>(new Set());
  const [connectionStatus, setConnectionStatus] = useState<ServerConnectionStatus>({});

  // New server form state
  const [newServerName, setNewServerName] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerOAuthClient, setNewServerOAuthClient] = useState('');
  const [newServerOAuthSecret, setNewServerOAuthSecret] = useState('');
  const [showNewServerAdvanced, setShowNewServerAdvanced] = useState(false);

  // Load MCP configuration on mount
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await window.electron.mcpGetConfig();
      if (result.success) {
        setConfig(result.config || {});
      } else {
        setError(result.error || 'Failed to load configuration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      const result = await window.electron.mcpSaveConfig(config);
      if (result.success) {
        // Trigger reload after successful save
        const reloadResult = await window.electron.mcpReloadConfig();
        if (reloadResult.success) {
          setSuccessMessage(reloadResult.message || 'Configuration saved and reloaded successfully!');
        } else {
          setSuccessMessage('Configuration saved, but reload failed: ' + reloadResult.error);
        }
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setError(result.error || 'Failed to save configuration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (serverName: string) => {
    setConnectionStatus(prev => ({ ...prev, [serverName]: 'connecting' }));
    setError(null);

    try {
      const server = config[serverName];

      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(server.headers || {})
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'claude-desktop',
              version: '1.0.0'
            }
          }
        })
      });

      if (response.status >= 200 && response.status < 500) {
        try {
          const data = await response.json();
          if (data.jsonrpc === '2.0') {
            setConnectionStatus(prev => ({ ...prev, [serverName]: 'connected' }));
            setSuccessMessage(`✓ Server is reachable at ${server.url}`);
          } else {
            setConnectionStatus(prev => ({ ...prev, [serverName]: 'connected' }));
            setSuccessMessage(`✓ Server is reachable (Note: may require additional auth for full MCP protocol)`);
          }
        } catch {
          setConnectionStatus(prev => ({ ...prev, [serverName]: 'connected' }));
          setSuccessMessage(`✓ Server is reachable at ${server.url}`);
        }
      } else {
        setConnectionStatus(prev => ({ ...prev, [serverName]: 'failed' }));
        setError(`Server returned ${response.status}. This may be due to browser limitations. Try saving and using in conversation.`);
      }

      setTimeout(() => {
        setConnectionStatus(prev => ({ ...prev, [serverName]: 'idle' }));
        setTimeout(() => setSuccessMessage(null), 2000);
      }, 3000);
    } catch (err: any) {
      setConnectionStatus(prev => ({ ...prev, [serverName]: 'failed' }));
      setError(`Cannot reach ${config[serverName].url}. Check the URL or try saving anyway - the SDK may still connect successfully.`);

      setTimeout(() => {
        setConnectionStatus(prev => ({ ...prev, [serverName]: 'idle' }));
      }, 3000);
    }
  };

  const addServer = () => {
    if (!newServerName.trim()) {
      setError('Server name cannot be empty');
      return;
    }

    if (!newServerUrl.trim()) {
      setError('Server URL cannot be empty');
      return;
    }

    if (config[newServerName]) {
      setError('Server with this name already exists');
      return;
    }

    try {
      new URL(newServerUrl);
    } catch {
      setError('Invalid URL format');
      return;
    }

    const headers: Record<string, string> = {};

    if (newServerOAuthClient && newServerOAuthSecret) {
      headers['X-OAuth-Client-ID'] = newServerOAuthClient;
      headers['X-OAuth-Client-Secret'] = newServerOAuthSecret;
    }

    const newServer: McpServer = {
      type: 'http',
      url: newServerUrl,
      ...(Object.keys(headers).length > 0 && { headers })
    };

    setConfig({
      ...config,
      [newServerName]: newServer
    });

    setNewServerName('');
    setNewServerUrl('');
    setNewServerOAuthClient('');
    setNewServerOAuthSecret('');
    setShowNewServerAdvanced(false);
    setError(null);
    setSuccessMessage('Server added. Remember to save your changes!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const deleteServer = (name: string) => {
    const newConfig = { ...config };
    delete newConfig[name];
    setConfig(newConfig);

    setEditingServers(prev => {
      const newSet = new Set(prev);
      newSet.delete(name);
      return newSet;
    });

    setSuccessMessage('Server removed. Remember to save your changes!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const toggleEditing = (serverName: string) => {
    setEditingServers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverName)) {
        newSet.delete(serverName);
      } else {
        newSet.add(serverName);
      }
      return newSet;
    });
  };

  const updateServerUrl = (serverName: string, newUrl: string) => {
    setConfig({
      ...config,
      [serverName]: {
        ...config[serverName],
        url: newUrl
      }
    });
  };

  const toggleAdvanced = (serverName: string) => {
    setExpandedServers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverName)) {
        newSet.delete(serverName);
      } else {
        newSet.add(serverName);
      }
      return newSet;
    });
  };

  const updateServerOAuth = (serverName: string, clientId: string, clientSecret: string) => {
    const server = config[serverName];
    const headers = { ...(server.headers || {}) };

    if (clientId) {
      headers['X-OAuth-Client-ID'] = clientId;
    } else {
      delete headers['X-OAuth-Client-ID'];
    }

    if (clientSecret) {
      headers['X-OAuth-Client-Secret'] = clientSecret;
    } else {
      delete headers['X-OAuth-Client-Secret'];
    }

    setConfig({
      ...config,
      [serverName]: {
        ...server,
        headers: Object.keys(headers).length > 0 ? headers : undefined
      }
    });
  };

  const getConnectionStatusIcon = (status: string) => {
    switch (status) {
      case 'connecting':
        return '⏳';
      case 'connected':
        return '✅';
      case 'failed':
        return '❌';
      default:
        return '';
    }
  };

  if (loading) {
    return (
      <div className="mcp-settings-tab">
        <div className="loading">Loading MCP configuration...</div>
      </div>
    );
  }

  return (
    <div className="mcp-settings-tab">
      <div className="tab-description">
        <p>Connect to remote Model Context Protocol servers to extend Claude's capabilities.</p>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)} className="dismiss-btn">✕</button>
        </div>
      )}

      {successMessage && (
        <div className="success-message">
          {successMessage}
          <button onClick={() => setSuccessMessage(null)} className="dismiss-btn">✕</button>
        </div>
      )}

      <div className="server-list">
        <h3>Connected Servers</h3>

        {Object.keys(config).length === 0 ? (
          <div className="empty-state">
            <p>No MCP servers configured yet.</p>
            <p>Add your first remote server below to get started!</p>
          </div>
        ) : (
          Object.entries(config).map(([name, server]) => {
            const isExpanded = expandedServers.has(name);
            const isEditing = editingServers.has(name);
            const status = connectionStatus[name] || 'idle';
            const oauthClient = server.headers?.['X-OAuth-Client-ID'] || '';
            const oauthSecret = server.headers?.['X-OAuth-Client-Secret'] || '';

            return (
              <div key={name} className="server-item">
                <div className="server-header">
                  <div className="server-main-info">
                    <h4>{name}</h4>
                    {isEditing ? (
                      <div className="form-group" style={{ marginTop: '0.5rem' }}>
                        <input
                          type="text"
                          value={server.url}
                          onChange={(e) => updateServerUrl(name, e.target.value)}
                          placeholder="https://api.example.com/mcp"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <div className="server-url">{server.url}</div>
                    )}
                  </div>
                  <div className="server-actions">
                    {status !== 'idle' && (
                      <span className="connection-status">
                        {getConnectionStatusIcon(status)}
                      </span>
                    )}
                    <button
                      className="edit-btn"
                      onClick={() => toggleEditing(name)}
                    >
                      {isEditing ? 'Done' : 'Edit'}
                    </button>
                    <button
                      className="test-btn"
                      onClick={() => testConnection(name)}
                      disabled={status === 'connecting'}
                      title="Browser-based connectivity check (may not work due to CORS/auth)"
                    >
                      {status === 'connecting' ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      className="mcp-delete-btn"
                      onClick={() => deleteServer(name)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="advanced-section">
                  <button
                    className="accordion-toggle"
                    onClick={() => toggleAdvanced(name)}
                  >
                    <span className={`accordion-icon ${isExpanded ? 'expanded' : ''}`}>▶</span>
                    Advanced (OAuth)
                  </button>

                  {isExpanded && (
                    <div className="advanced-content">
                      <div className="form-group">
                        <label>OAuth Client ID:</label>
                        <input
                          type="text"
                          value={oauthClient}
                          onChange={(e) => updateServerOAuth(name, e.target.value, oauthSecret)}
                          placeholder="Enter OAuth Client ID"
                        />
                      </div>

                      <div className="form-group">
                        <label>OAuth Client Secret:</label>
                        <input
                          type="password"
                          value={oauthSecret}
                          onChange={(e) => updateServerOAuth(name, oauthClient, e.target.value)}
                          placeholder="Enter OAuth Client Secret"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="add-server-section">
        <h3>Add New Remote Server</h3>

        <div className="form-group">
          <label>Server Name:</label>
          <input
            type="text"
            value={newServerName}
            onChange={(e) => setNewServerName(e.target.value)}
            placeholder="e.g., my-api-server"
          />
        </div>

        <div className="form-group">
          <label>Remote MCP URL:</label>
          <input
            type="text"
            value={newServerUrl}
            onChange={(e) => setNewServerUrl(e.target.value)}
            placeholder="https://api.example.com/mcp"
          />
        </div>

        <div className="advanced-section">
          <button
            className="accordion-toggle"
            onClick={() => setShowNewServerAdvanced(!showNewServerAdvanced)}
            type="button"
          >
            <span className={`accordion-icon ${showNewServerAdvanced ? 'expanded' : ''}`}>▶</span>
            Advanced (OAuth)
          </button>

          {showNewServerAdvanced && (
            <div className="advanced-content">
              <div className="form-group">
                <label>OAuth Client ID:</label>
                <input
                  type="text"
                  value={newServerOAuthClient}
                  onChange={(e) => setNewServerOAuthClient(e.target.value)}
                  placeholder="Enter OAuth Client ID (optional)"
                />
              </div>

              <div className="form-group">
                <label>OAuth Client Secret:</label>
                <input
                  type="password"
                  value={newServerOAuthSecret}
                  onChange={(e) => setNewServerOAuthSecret(e.target.value)}
                  placeholder="Enter OAuth Client Secret (optional)"
                />
              </div>
            </div>
          )}
        </div>

        <button className="add-btn" onClick={addServer}>
          Add Server
        </button>
      </div>

      <div className="settings-actions">
        <button className="save-btn" onClick={saveConfig} disabled={saving}>
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
        <button className="reload-btn" onClick={loadConfig}>
          Reload
        </button>
      </div>

      <div className="settings-info">
        <h3>About MCP Servers</h3>
        <p>
          MCP (Model Context Protocol) servers provide additional tools and capabilities to Claude.
          Configuration is stored in <code>.mcp.json</code> in your project root.
        </p>
        <p>
          <strong>Important:</strong> Existing conversations won't be updated with new MCP servers.
          You'll need to <strong>start a new conversation</strong> (Cmd+T) to use newly configured servers.
        </p>
        <div className="info-callout">
          <strong>⚠️ About Connection Testing</strong>
          <p>
            The "Test Connection" button may fail due to browser limitations (CORS, auth, headers), but this doesn't mean the server won't work - just save and try it in a new conversation.
          </p>
        </div>
      </div>
    </div>
  );
};

export default McpSettingsTab;
