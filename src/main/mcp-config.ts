import fs from 'fs/promises';
import path from 'path';
import { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export class McpConfigLoader {
  private configPath: string;
  private cachedConfig: Record<string, McpServerConfig> | null = null;

  constructor(projectPath: string) {
    this.configPath = path.join(projectPath, '.mcp.json');
  }

  /**
   * Load MCP configuration from .mcp.json file
   * Returns empty object if file doesn't exist
   */
  async load(): Promise<Record<string, McpServerConfig>> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      const config: McpConfigFile = JSON.parse(raw);

      // Validate basic structure
      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        console.warn('[McpConfig] Invalid .mcp.json structure, using empty config');
        return {};
      }

      // Expand environment variables in the config
      const expanded = this.expandEnvVars(config.mcpServers);

      // Cache the config
      this.cachedConfig = expanded;

      return expanded;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.cachedConfig = {};
        return {};
      }

      console.error('[McpConfig] Error loading .mcp.json:', error);
      throw new Error(`Failed to load MCP configuration: ${error.message}`);
    }
  }

  /**
   * Save MCP configuration to .mcp.json file
   */
  async save(servers: Record<string, McpServerConfig>): Promise<void> {
    try {
      const config: McpConfigFile = { mcpServers: servers };
      const json = JSON.stringify(config, null, 2);

      await fs.writeFile(this.configPath, json, 'utf-8');

      // Update cache
      this.cachedConfig = servers;
    } catch (error: any) {
      console.error('[McpConfig] Error saving .mcp.json:', error);
      throw new Error(`Failed to save MCP configuration: ${error.message}`);
    }
  }

  /**
   * Get cached configuration without reading file
   */
  getCached(): Record<string, McpServerConfig> | null {
    return this.cachedConfig;
  }

  /**
   * Expand environment variables in configuration
   * Supports ${VAR} and ${VAR:-default} syntax
   */
  private expandEnvVars(config: any): any {
    if (typeof config === 'string') {
      return this.expandEnvVarString(config);
    }

    if (Array.isArray(config)) {
      return config.map(item => this.expandEnvVars(item));
    }

    if (config !== null && typeof config === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(config)) {
        result[key] = this.expandEnvVars(value);
      }
      return result;
    }

    return config;
  }

  /**
   * Expand environment variables in a string
   * Supports:
   * - ${VAR} - replace with env var or empty string
   * - ${VAR:-default} - replace with env var or default value
   */
  private expandEnvVarString(str: string): string {
    return str.replace(/\$\{([^}:]+)(:-([^}]*))?\}/g, (match, varName, _, defaultValue) => {
      const envValue = process.env[varName];

      if (envValue !== undefined) {
        return envValue;
      }

      if (defaultValue !== undefined) {
        return defaultValue;
      }

      // No value and no default, return empty string
      console.warn(`[McpConfig] Environment variable ${varName} not found, using empty string`);
      return '';
    });
  }

  /**
   * Validate MCP server configuration
   * Returns array of validation errors, empty if valid
   */
  validateConfig(servers: Record<string, McpServerConfig>): string[] {
    const errors: string[] = [];

    for (const [name, config] of Object.entries(servers)) {
      // Validate server name
      if (!name || typeof name !== 'string') {
        errors.push('Server name must be a non-empty string');
        continue;
      }

      // Check for valid config object
      if (!config || typeof config !== 'object') {
        errors.push(`Server "${name}": Invalid configuration object`);
        continue;
      }

      // Type-specific validation
      const serverType = (config as any).type || 'stdio';

      switch (serverType) {
        case 'stdio':
          if (!(config as any).command) {
            errors.push(`Server "${name}": stdio type requires "command" field`);
          }
          break;

        case 'http':
        case 'sse':
          if (!(config as any).url) {
            errors.push(`Server "${name}": ${serverType} type requires "url" field`);
          } else {
            try {
              new URL((config as any).url);
            } catch {
              errors.push(`Server "${name}": Invalid URL format`);
            }
          }
          break;

        case 'sdk':
          if (!(config as any).name) {
            errors.push(`Server "${name}": sdk type requires "name" field`);
          }
          if (!(config as any).instance) {
            errors.push(`Server "${name}": sdk type requires "instance" field`);
          }
          break;

        default:
          errors.push(`Server "${name}": Unknown server type "${serverType}"`);
      }
    }

    return errors;
  }

  /**
   * Check if .mcp.json file exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }
}
