import React, { useState, useEffect } from 'react';
import './McpSettings.css';

interface McpServer {
  type?: 'stdio' | 'http' | 'sse' | 'sdk';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  name?: string;
}

interface McpConfig {
  [key: string]: McpServer;
}

const McpSettings: React.FC = () => {
  const [config, setConfig] = useState<McpConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [newServerName, setNewServerName] = useState('');
  const [newServer, setNewServer] = useState<McpServer>({ type: 'stdio' });

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

      // Validate before saving
      const validateResult = await window.electron.mcpValidateConfig(config);
      if (!validateResult.success && validateResult.errors.length > 0) {
        setError(`Validation errors:\n${validateResult.errors.join('\n')}`);
        return;
      }

      const result = await window.electron.mcpSaveConfig(config);
      if (result.success) {
        setSuccessMessage('Configuration saved successfully! Restart conversations to apply changes.');
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

  const addServer = () => {
    if (!newServerName.trim()) {
      setError('Server name cannot be empty');
      return;
    }

    if (config[newServerName]) {
      setError('Server with this name already exists');
      return;
    }

    setConfig({
      ...config,
      [newServerName]: { ...newServer }
    });

    // Reset form
    setNewServerName('');
    setNewServer({ type: 'stdio' });
    setError(null);
    setSuccessMessage('Server added. Remember to save your changes!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const deleteServer = (name: string) => {
    const newConfig = { ...config };
    delete newConfig[name];
    setConfig(newConfig);
    setSuccessMessage('Server removed. Remember to save your changes!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const updateServer = (name: string, updates: Partial<McpServer>) => {
    setConfig({
      ...config,
      [name]: { ...config[name], ...updates }
    });
  };

  const renderServerForm = (server: McpServer, onChange: (updates: Partial<McpServer>) => void, isNew: boolean = false) => {
    const serverType = server.type || 'stdio';

    return (
      <div className="server-form">
        <div className="form-group">
          <label>Server Type:</label>
          <select
            value={serverType}
            onChange={(e) => onChange({ type: e.target.value as any })}
          >
            <option value="stdio">Stdio (Local Process)</option>
            <option value="http">HTTP (Remote)</option>
            <option value="sse">SSE (Server-Sent Events)</option>
          </select>
        </div>

        {serverType === 'stdio' && (
          <>
            <div className="form-group">
              <label>Command:</label>
              <input
                type="text"
                value={server.command || ''}
                onChange={(e) => onChange({ command: e.target.value })}
                placeholder="e.g., npx"
              />
            </div>

            <div className="form-group">
              <label>Arguments (one per line):</label>
              <textarea
                value={(server.args || []).join('\n')}
                onChange={(e) => onChange({ args: e.target.value.split('\n').filter(a => a.trim()) })}
                placeholder="e.g., -y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/directory"
                rows={4}
              />
            </div>
          </>
        )}

        {(serverType === 'http' || serverType === 'sse') && (
          <>
            <div className="form-group">
              <label>URL:</label>
              <input
                type="text"
                value={server.url || ''}
                onChange={(e) => onChange({ url: e.target.value })}
                placeholder="https://api.example.com/mcp"
              />
            </div>

            <div className="form-group">
              <label>Headers (JSON format):</label>
              <textarea
                value={JSON.stringify(server.headers || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const headers = JSON.parse(e.target.value);
                    onChange({ headers });
                  } catch {
                    // Ignore invalid JSON during typing
                  }
                }}
                placeholder='{\n  "Authorization": "Bearer ${API_TOKEN}"\n}'
                rows={4}
              />
            </div>
          </>
        )}

        <div className="form-group">
          <label>Environment Variables (JSON format):</label>
          <textarea
            value={JSON.stringify(server.env || {}, null, 2)}
            onChange={(e) => {
              try {
                const env = JSON.parse(e.target.value);
                onChange({ env });
              } catch {
                // Ignore invalid JSON during typing
              }
            }}
            placeholder='{\n  "API_KEY": "${API_KEY}",\n  "VAR": "${VAR:-default}"\n}'
            rows={4}
          />
          <small className="form-hint">
            Use $&#123;VAR&#125; for environment variables, $&#123;VAR:-default&#125; for defaults
          </small>
        </div>

        {!isNew && (
          <div className="form-actions">
            <button className="done-btn" onClick={() => setEditingServer(null)}>
              Done
            </button>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="mcp-settings">
        <div className="loading">Loading MCP configuration...</div>
      </div>
    );
  }

  return (
    <div className="mcp-settings">
      <div className="settings-header">
        <h1>MCP Server Configuration</h1>
        <p>Configure Model Context Protocol servers to extend Claude's capabilities.</p>
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
        <h2>Configured Servers</h2>

        {Object.keys(config).length === 0 ? (
          <div className="empty-state">
            <p>No MCP servers configured yet.</p>
            <p>Add your first server below to get started!</p>
          </div>
        ) : (
          Object.entries(config).map(([name, server]) => (
            <div key={name} className="server-item">
              <div className="server-header">
                <h3>{name}</h3>
                <div className="server-type-badge">{server.type || 'stdio'}</div>
                <div className="server-actions">
                  <button
                    className="edit-btn"
                    onClick={() => setEditingServer(editingServer === name ? null : name)}
                  >
                    {editingServer === name ? 'Collapse' : 'Edit'}
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => deleteServer(name)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {editingServer === name && (
                <div className="server-details">
                  {renderServerForm(server, (updates) => updateServer(name, updates))}
                </div>
              )}

              {editingServer !== name && (
                <div className="server-summary">
                  {server.command && <div><strong>Command:</strong> {server.command}</div>}
                  {server.url && <div><strong>URL:</strong> {server.url}</div>}
                  {server.args && server.args.length > 0 && (
                    <div><strong>Args:</strong> {server.args.length} argument(s)</div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="add-server-section">
        <h2>Add New Server</h2>

        <div className="form-group">
          <label>Server Name:</label>
          <input
            type="text"
            value={newServerName}
            onChange={(e) => setNewServerName(e.target.value)}
            placeholder="e.g., github, postgres, filesystem"
          />
        </div>

        {renderServerForm(newServer, (updates) => setNewServer({ ...newServer, ...updates }), true)}

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
          After saving changes, you'll need to restart your conversations for the new configuration to take effect.
        </p>
        <p>
          Configuration is stored in <code>.mcp.json</code> in your project root.
        </p>
      </div>
    </div>
  );
};

export default McpSettings;
