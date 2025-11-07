import { ipcMain } from 'electron';
import { McpConfigLoader } from './mcp-config.js';
import { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * Register MCP-related IPC handlers
 */
export function registerMcpIpcHandlers(mcpConfigLoader: McpConfigLoader) {
  /**
   * Get current MCP configuration
   */
  ipcMain.handle('mcp:getConfig', async () => {
    try {
      const config = await mcpConfigLoader.load();
      return { success: true, config };
    } catch (error: any) {
      console.error('[mcp:getConfig] Error:', error);
      return { success: false, error: error.message, config: {} };
    }
  });

  /**
   * Save MCP configuration
   */
  ipcMain.handle('mcp:saveConfig', async (event, servers: Record<string, McpServerConfig>) => {
    try {
      // Validate configuration
      const errors = mcpConfigLoader.validateConfig(servers);
      if (errors.length > 0) {
        return {
          success: false,
          error: 'Configuration validation failed',
          validationErrors: errors
        };
      }

      // Save configuration
      await mcpConfigLoader.save(servers);

      return { success: true };
    } catch (error: any) {
      console.error('[mcp:saveConfig] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Validate MCP configuration without saving
   */
  ipcMain.handle('mcp:validateConfig', async (event, servers: Record<string, McpServerConfig>) => {
    try {
      const errors = mcpConfigLoader.validateConfig(servers);
      return {
        success: errors.length === 0,
        errors
      };
    } catch (error: any) {
      console.error('[mcp:validateConfig] Error:', error);
      return { success: false, errors: [error.message] };
    }
  });

  /**
   * Check if .mcp.json file exists
   */
  ipcMain.handle('mcp:fileExists', async () => {
    try {
      const exists = await mcpConfigLoader.exists();
      return { success: true, exists };
    } catch (error: any) {
      console.error('[mcp:fileExists] Error:', error);
      return { success: false, exists: false, error: error.message };
    }
  });

  console.log('[MCP IPC] Handlers registered');
}
