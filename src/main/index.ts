import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ConversationAgentManager } from './conversation-agent-manager.js';
import { ConversationManager } from './conversation-manager.js';
import { McpConfigLoader } from './mcp-config.js';
import { registerMcpIpcHandlers } from './mcp-ipc.js';
import { ApiKeyManager } from './api-key-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set application name (used in menu bar and About dialog)
// Must be set before app.whenReady() for it to take effect
app.setName('Claude Agent Desktop');

// Set About panel options (macOS)
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: 'Claude Agent Desktop',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: '© 2024 Claude Agent Desktop',
    iconPath: path.join(__dirname, '../../logo.png'),
  });
}

// Fix PATH for Claude Agent SDK to find node
// This is critical for the SDK to spawn child processes
if (process.platform === 'darwin' || process.platform === 'linux') {
  process.env.PATH = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    process.env.PATH || ''
  ].join(':');
} else if (process.platform === 'win32') {
  // Windows paths
  process.env.PATH = [
    'C:\\Program Files\\nodejs',
    process.env.PATH || ''
  ].join(';');
}

let mainWindow: BrowserWindow | null = null;
let agentManager: ConversationAgentManager | null = null;
let conversationManager: ConversationManager | null = null;
let apiKeyManager: ApiKeyManager | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../../logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load from Vite dev server
  // Try loading from Vite first, fall back to built files if unavailable
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // Try common Vite ports
    const tryLoadURL = async () => {
      const ports = [5173, 5174, 5175];
      for (const port of ports) {
        try {
          await mainWindow!.loadURL(`http://localhost:${port}`);
          return;
        } catch (err) {
          // Try next port
        }
      }
      console.error('Failed to load from Vite dev server. Make sure npm run dev:renderer is running.');
    };
    tryLoadURL();
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.whenReady().then(async () => {
  // Set dock icon (macOS)
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, '../../logo.png');
    if (existsSync(iconPath)) {
      app.dock.setIcon(iconPath);
    }
  }

  // Initialize API Key Manager
  apiKeyManager = new ApiKeyManager();

  // Initialize Conversation Manager
  conversationManager = new ConversationManager(
    path.join(app.getPath('userData'), 'conversations.db')
  );

  // Initialize MCP Config Loader
  const projectPath = process.cwd();
  const mcpConfigLoader = new McpConfigLoader(projectPath);
  const mcpServers = await mcpConfigLoader.load();

  // Note: Agent manager will be passed to IPC handlers after initialization

  // Initialize Agent Manager
  const pluginsPath = path.join(__dirname, '../../plugins');

  // Load API key from encrypted storage
  const apiKey = apiKeyManager.getApiKey() || '';

  agentManager = new ConversationAgentManager(
    {
      apiKey: apiKey,
      pluginsPath: pluginsPath,
      mcpServers: mcpServers,
    },
    conversationManager
  );

  // Register MCP IPC handlers with agent manager reference
  registerMcpIpcHandlers(mcpConfigLoader, agentManager);

  // Forward processing events to renderer
  agentManager.on('processing-started', (data: any) => {
    mainWindow?.webContents.send('processing-started', data);
  });

  agentManager.on('processing-complete', (data: any) => {
    mainWindow?.webContents.send('processing-complete', data);
  });

  agentManager.on('clear-permissions', (data: any) => {
    mainWindow?.webContents.send('clear-permissions', data);
  });

  // Forward mode change events to renderer
  agentManager.on('mode-changed', (data: any) => {
    mainWindow?.webContents.send('mode-changed', data);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  // Cleanup all agents before quitting
  if (agentManager) {
    await agentManager.cleanup();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('send-message', async (event, message: string, conversationId: string, attachments?: string[]) => {
  if (!agentManager || !conversationManager || !mainWindow) {
    throw new Error('Services not initialized');
  }

  try {
    if (!conversationId) {
      throw new Error('No conversation ID provided');
    }

    // Verify the conversation exists
    const conversation = await conversationManager.getConversation(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Save user message to the specified conversation
    const messageId = await conversationManager.saveMessage({
      role: 'user',
      content: message,
      attachments,
    }, conversationId);

    // Notify frontend that user message was saved (triggers conversation refresh and sidebar reorder)
    mainWindow?.webContents.send('user-message-saved', { conversationId });

    // Stream Claude's response via the agent manager
    // Track text chunks between events for proper chronological ordering
    let currentTextChunk = '';
    // Anchor timestamp for this assistant reply so all parts (text/thinking/tools) group chronologically
    const replyStartedAt = Date.now();

    // Helper function to save accumulated text chunk
    const saveTextChunk = async () => {
      if (currentTextChunk.trim() && conversationManager) {
        try {
          await conversationManager.saveMessage({
            role: 'assistant',
            content: currentTextChunk,
            messageType: 'assistant',
            timestamp: replyStartedAt,
          }, conversationId);
          mainWindow?.webContents.send('assistant-message-saved', { conversationId });
          currentTextChunk = '';
        } catch (error) {
          console.error('Error saving text chunk:', error);
        }
      }
    };

    await agentManager.sendMessage(conversationId, message, attachments, {
      onToken: (accumulatedText: string) => {
        // Backend now sends the FULL accumulated text, not just deltas
        // So we can use it directly instead of accumulating
        currentTextChunk = accumulatedText;
        mainWindow?.webContents.send('message-token', { token: accumulatedText, conversationId, startedAt: replyStartedAt });
      },
      onResult: async () => {
        // Flush any remaining streamed text at the end of this reply
        await saveTextChunk();
      },
      onThinking: async (thinking: string) => {
        // Save accumulated text before thinking
        await saveTextChunk();

        // Save thinking as a separate message
        if (!conversationManager) return;
        try {
          await conversationManager.saveMessage({
            role: 'assistant',
            content: thinking,
            messageType: 'thinking',
            timestamp: replyStartedAt,
          }, conversationId);
          mainWindow?.webContents.send('message-thinking', { thinking, conversationId });
          mainWindow?.webContents.send('assistant-message-saved', { conversationId });
        } catch (error) {
          console.error('Error saving thinking message:', error);
        }
      },
      onToolUse: async (toolName: string, toolInput: any) => {
        // Save accumulated text before tool use
        await saveTextChunk();

        // Save tool_use as a separate message
        if (!conversationManager) return;
        try {
          await conversationManager.saveMessage({
            role: 'assistant',
            content: `${toolName} started`,
            messageType: 'tool_use',
            metadata: { toolName, input: toolInput },
            timestamp: replyStartedAt,
          }, conversationId);
          mainWindow?.webContents.send('tool-execution', {
            tool: toolName,
            input: toolInput,
            status: 'running',
            conversationId,
          });
          mainWindow?.webContents.send('assistant-message-saved', { conversationId });
        } catch (error) {
          console.error('Error saving tool_use message:', error);
        }
      },
      onToolResult: async (toolName: string, result: any) => {
        // Save accumulated text before tool result
        await saveTextChunk();

        // Save tool_result as a separate message
        if (!conversationManager) return;
        try {
          await conversationManager.saveMessage({
            role: 'assistant',
            content: `${toolName} completed`,
            messageType: 'tool_result',
            metadata: { toolName, result },
            timestamp: replyStartedAt,
          }, conversationId);
          mainWindow?.webContents.send('tool-execution', {
            tool: toolName,
            result,
            status: 'completed',
            conversationId,
          });
          mainWindow?.webContents.send('assistant-message-saved', { conversationId });
        } catch (error) {
          console.error('Error saving tool_result message:', error);
        }
      },
      onPermissionRequest: (request: any) => {
        mainWindow?.webContents.send('permission-request', { ...request, conversationId });
      },
      onPlanApprovalRequest: (request: any) => {
        mainWindow?.webContents.send('plan-approval-request', { ...request, conversationId });
      },
      onInterrupted: async () => {
        // Save any streamed content before interrupting
        await saveTextChunk();
        mainWindow?.webContents.send('message-interrupted', { conversationId });
      },
    });

    // Save any remaining text chunk at the end
    await saveTextChunk();

    // Notify frontend that assistant message was saved (triggers conversation list refresh for activity badges)
    mainWindow?.webContents.send('assistant-message-saved', { conversationId });

    // Update session ID in database if it changed
    const newSessionId = agentManager.getCurrentSessionId(conversationId);
    if (newSessionId && newSessionId !== conversation.sessionId) {
      await conversationManager.updateSessionId(conversationId, newSessionId);
    }

    return { success: true, messageId };
  } catch (error: any) {
    console.error('Error sending message:', error);

    // Check if this is an abort/interrupt error (user pressed ESC)
    const isInterruption = error.name === 'AbortError' ||
                          error.message?.includes('AbortError') ||
                          error.message?.includes('interrupt');

    // Only save non-interruption errors as error messages
    if (!isInterruption) {
      try {
        await conversationManager.saveMessage({
          role: 'assistant',
          content: error.message || 'An error occurred',
          messageType: 'error',
          metadata: {
            errorType: error.name || 'Error',
            stack: error.stack,
          },
        }, conversationId);
        mainWindow?.webContents.send('assistant-message-saved', { conversationId });
      } catch (saveError) {
        console.error('Error saving error message:', saveError);
      }
    }

    throw error;
  }
});

ipcMain.handle('get-conversations', async () => {
  if (!conversationManager) {
    throw new Error('Conversation manager not initialized');
  }
  return await conversationManager.getConversations();
});

ipcMain.handle('search-conversations', async (event, query: string, caseSensitive: boolean) => {
  if (!conversationManager) {
    throw new Error('Conversation manager not initialized');
  }
  return await conversationManager.searchConversations(query, caseSensitive);
});

ipcMain.handle('get-active-conversations', async () => {
  if (!agentManager) {
    return [];
  }
  return agentManager.getActiveConversations();
});

ipcMain.handle('play-notification-sound', async () => {
  shell.beep();
  return { success: true };
});

// Settings management
ipcMain.handle('update-app-settings', async (event, settings: {
  model?: string;
  additionalDirectories?: string[];
  systemPromptMode?: 'append' | 'custom';
  customSystemPrompt?: string;
}) => {
  if (!agentManager) {
    throw new Error('Agent manager not initialized');
  }

  // Build system prompt based on mode
  let systemPrompt: string | { type: 'preset'; preset: 'claude_code'; append: string } | undefined;
  if (settings.customSystemPrompt) {
    if (settings.systemPromptMode === 'append') {
      systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: settings.customSystemPrompt
      };
    } else if (settings.systemPromptMode === 'custom') {
      systemPrompt = settings.customSystemPrompt;
    }
  }

  // Update agent manager with new settings
  agentManager.updateSettings({
    model: settings.model,
    additionalDirectories: settings.additionalDirectories,
    systemPrompt: systemPrompt,
  });

  return { success: true };
});

ipcMain.handle('get-conversation', async (event, conversationId: string, limit?: number, offset?: number) => {
  if (!conversationManager) {
    throw new Error('Services not initialized');
  }

  try {
    // Set this as the active conversation for the conversation manager
    conversationManager.setCurrentConversationId(conversationId);

    // Simply return the conversation - the agent will be created on-demand when needed
    const conversation = await conversationManager.getConversation(conversationId, limit, offset);

    return conversation;
  } catch (error) {
    console.error('Error loading conversation:', error);
    return null;
  }
});

ipcMain.handle('new-conversation-with-folder', async (event, folderPath: string, mode?: string) => {
  if (!conversationManager) {
    throw new Error('Services not initialized');
  }

  // Create new conversation with optional mode
  const conversationId = await conversationManager.newConversation(mode as any);

  // Set as active conversation
  conversationManager.setCurrentConversationId(conversationId);

  // Set the folder path for this conversation
  await conversationManager.updateProjectPath(conversationId, folderPath);

  // Agent will be created on-demand with the correct project path
  return { success: true, conversationId };
});

ipcMain.handle('delete-conversation', async (event, conversationId: string) => {
  if (!conversationManager || !agentManager) {
    throw new Error('Services not initialized');
  }

  // Delete the agent instance for this conversation
  await agentManager.deleteAgent(conversationId);

  // Delete the conversation from database
  await conversationManager.deleteConversation(conversationId);

  return { success: true };
});

ipcMain.handle('fork-conversation', async (event, conversationId: string) => {
  if (!conversationManager) {
    throw new Error('Services not initialized');
  }

  // Fork the conversation (creates new conversation with copied messages and parent session ID)
  const forkedConversation = await conversationManager.forkConversation(conversationId);

  // Send event to refresh the conversations list
  if (mainWindow) {
    mainWindow.webContents.send('user-message-saved');
  }

  return forkedConversation;
});

ipcMain.handle('select-folder', async () => {
  if (!mainWindow) {
    throw new Error('Main window not initialized');
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Project Folder',
    buttonLabel: 'Select Folder',
    message: 'Choose a folder for this conversation'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }

  return { success: false };
});

ipcMain.handle('select-files', async () => {
  if (!mainWindow) {
    throw new Error('Main window not initialized');
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select Files to Attach',
    buttonLabel: 'Attach',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'] },
      { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'doc', 'docx'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, paths: result.filePaths };
  }

  return { success: false, paths: [] };
});

ipcMain.handle('get-project-path', async (event, conversationId: string) => {
  if (!conversationManager) {
    throw new Error('Conversation manager not initialized');
  }

  if (!conversationId) {
    return { path: '' };
  }

  const conversation = await conversationManager.getConversation(conversationId);
  return { path: conversation?.projectPath || '' };
});

ipcMain.handle('check-folder-exists', async (event, folderPath: string) => {
  if (!folderPath) {
    return { exists: false };
  }
  return { exists: existsSync(folderPath) };
});

ipcMain.handle('create-folder', async (event, parentPath: string, folderName: string) => {
  try {
    const newFolderPath = path.join(parentPath, folderName);

    if (existsSync(newFolderPath)) {
      return { success: false, error: 'Folder already exists', path: null };
    }

    mkdirSync(newFolderPath, { recursive: true });
    return { success: true, path: newFolderPath };
  } catch (error) {
    console.error('Error creating folder:', error);
    return { success: false, error: (error as Error).message, path: null };
  }
});

// Open file with system default application
ipcMain.handle('open-file', async (event, filePath: string) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    console.error('Error opening file:', error);
    return { success: false, error: (error as Error).message };
  }
});

// Interrupt message processing
ipcMain.handle('interrupt-message', async (event, conversationId?: string) => {
  try {
    if (!agentManager || !conversationManager) {
      return { success: false, error: 'Services not initialized' };
    }

    // If no conversationId provided, use the current active conversation
    const targetConversationId = conversationId || conversationManager.getCurrentConversationId();
    if (!targetConversationId) {
      return { success: false, error: 'No active conversation to interrupt' };
    }

    // Call interrupt asynchronously without waiting - don't block the IPC response
    // The SDK's interrupt() can hang, so we return success immediately
    agentManager.interrupt(targetConversationId).catch(error => {
      console.error('[interrupt-message] Error:', error);
    });

    return { success: true };
  } catch (error) {
    console.error('[interrupt-message] Error:', error);
    return { success: false, error: String(error) };
  }
});

// Set permission mode
ipcMain.handle('set-mode', async (event, mode: string, conversationId: string) => {
  if (!agentManager || !conversationManager) {
    throw new Error('Services not initialized');
  }

  if (!conversationId) {
    throw new Error('No conversation ID provided');
  }

  // Save mode to database FIRST, so getOrCreateAgent reads the correct mode
  await conversationManager.updateMode(conversationId, mode as any);

  // Update agent mode (will get or create agent for this conversation)
  await agentManager.setMode(conversationId, mode as any);

  return { success: true };
});

// Get current mode
ipcMain.handle('get-mode', async (event, conversationId: string) => {
  if (!conversationManager) {
    throw new Error('Conversation manager not initialized');
  }

  if (!conversationId) {
    throw new Error('No conversation ID provided');
  }

  // Get mode from database for specific conversation
  const conversation = await conversationManager.getConversation(conversationId);
  return { mode: conversation?.mode || 'default' };
});

// Respond to permission request (approve or deny)
ipcMain.handle('respond-to-permission', async (event, data: { requestId: string; approved: boolean; conversationId?: string; updatedInput?: Record<string, unknown> }) => {
  if (!agentManager || !conversationManager) {
    throw new Error('Services not initialized');
  }

  const { requestId, approved, conversationId, updatedInput } = data;

  // If no conversationId provided, use the current active conversation
  const targetConversationId = conversationId || conversationManager.getCurrentConversationId();
  if (!targetConversationId) {
    throw new Error('No active conversation');
  }

  agentManager.respondToPermissionRequest(targetConversationId, requestId, approved, updatedInput);
  return { success: true };
});

// Respond to plan approval request (approve or deny)
ipcMain.handle('respond-to-plan-approval', async (event, data: { requestId: string; approved: boolean; conversationId?: string }) => {
  if (!agentManager || !conversationManager) {
    throw new Error('Services not initialized');
  }

  const { requestId, approved, conversationId } = data;

  // If no conversationId provided, use the current active conversation
  const targetConversationId = conversationId || conversationManager.getCurrentConversationId();
  if (!targetConversationId) {
    throw new Error('No active conversation');
  }

  agentManager.respondToPlanApproval(targetConversationId, requestId, approved);
  return { success: true };
});

// Legacy handlers for backwards compatibility
ipcMain.handle('approve-permission', async (event, permissionId: string, conversationId?: string) => {
  if (!agentManager || !conversationManager) {
    throw new Error('Services not initialized');
  }

  const targetConversationId = conversationId || conversationManager.getCurrentConversationId();
  if (!targetConversationId) {
    throw new Error('No active conversation');
  }

  agentManager.respondToPermissionRequest(targetConversationId, permissionId, true);

  // Emit permission-responded event to notify frontend
  mainWindow?.webContents.send('permission-responded', { conversationId: targetConversationId });

  return { success: true };
});

ipcMain.handle('deny-permission', async (event, permissionId: string, conversationId?: string) => {
  if (!agentManager || !conversationManager) {
    throw new Error('Services not initialized');
  }

  const targetConversationId = conversationId || conversationManager.getCurrentConversationId();
  if (!targetConversationId) {
    throw new Error('No active conversation');
  }

  agentManager.respondToPermissionRequest(targetConversationId, permissionId, false);

  // Emit permission-responded event to notify frontend
  mainWindow?.webContents.send('permission-responded', { conversationId: targetConversationId });
  return { success: true };
});

// Update conversation title
ipcMain.handle('update-conversation-title', async (event, conversationId: string, title: string) => {
  if (!conversationManager) {
    throw new Error('Conversation manager not initialized');
  }

  await conversationManager.updateConversationTitle(conversationId, title);

  // Return updated conversation to refresh UI
  const updatedConversation = await conversationManager.getConversation(conversationId);
  return { success: true, conversation: updatedConversation };
});

// Pin conversation
ipcMain.handle('pin-conversation', async (event, conversationId: string) => {
  if (!conversationManager) {
    throw new Error('Conversation manager not initialized');
  }

  await conversationManager.pinConversation(conversationId);
  return { success: true };
});

// Unpin conversation
ipcMain.handle('unpin-conversation', async (event, conversationId: string) => {
  if (!conversationManager) {
    throw new Error('Conversation manager not initialized');
  }

  await conversationManager.unpinConversation(conversationId);
  return { success: true };
});

// API Key Management
ipcMain.handle('get-api-key-status', async () => {
  if (!apiKeyManager) {
    throw new Error('API key manager not initialized');
  }

  return { hasApiKey: apiKeyManager.hasApiKey() };
});

ipcMain.handle('get-api-key', async () => {
  if (!apiKeyManager) {
    throw new Error('API key manager not initialized');
  }

  const apiKey = apiKeyManager.getApiKey();
  return { apiKey: apiKey || null };
});

ipcMain.handle('set-api-key', async (event, apiKey: string) => {
  if (!apiKeyManager || !agentManager) {
    throw new Error('Services not initialized');
  }

  try {
    // Validate API key format (basic check)
    if (!apiKey || !apiKey.trim()) {
      return { success: false, error: 'API key cannot be empty' };
    }

    if (!apiKey.startsWith('sk-ant-')) {
      return { success: false, error: 'Invalid API key format. Anthropic API keys should start with "sk-ant-"' };
    }

    // Save encrypted API key
    apiKeyManager.setApiKey(apiKey);

    // Update the agent manager with the new API key
    agentManager.updateApiKey(apiKey);

    return { success: true };
  } catch (error) {
    console.error('Error setting API key:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('delete-api-key', async () => {
  if (!apiKeyManager) {
    throw new Error('API key manager not initialized');
  }

  try {
    apiKeyManager.deleteApiKey();
    return { success: true };
  } catch (error) {
    console.error('Error deleting API key:', error);
    return { success: false, error: (error as Error).message };
  }
});
