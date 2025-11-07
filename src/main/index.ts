import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config as loadEnv } from 'dotenv';
import { existsSync, mkdirSync } from 'fs';
import { ConversationAgentManager } from './conversation-agent-manager.js';
import { ConversationManager } from './conversation-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file
const envPath = path.join(__dirname, '../../.env');
loadEnv({ path: envPath });

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

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../../logo-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load from Vite dev server
  // Try loading from Vite first, fall back to built files if unavailable
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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
  // Initialize Conversation Manager
  conversationManager = new ConversationManager(
    path.join(app.getPath('userData'), 'conversations.db')
  );

  // Initialize Agent Manager
  const pluginsPath = path.join(__dirname, '../../plugins');
  console.log('[Main] Initializing agent manager with plugins path:', pluginsPath);
  console.log('[Main] Plugins directory exists:', existsSync(pluginsPath));
  if (existsSync(pluginsPath)) {
    const { readdirSync } = await import('fs');
    console.log('[Main] Plugins directory contents:', readdirSync(pluginsPath));
  }

  agentManager = new ConversationAgentManager(
    {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      pluginsPath: pluginsPath,
    },
    conversationManager
  );

  // Forward processing events to renderer
  agentManager.on('processing-started', (data: any) => {
    console.log('[Main] Processing started:', data);
    mainWindow?.webContents.send('processing-started', data);
  });

  agentManager.on('processing-complete', (data: any) => {
    console.log('[Main] Processing complete:', data);
    mainWindow?.webContents.send('processing-complete', data);
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

    console.log('[send-message] Processing message:', {
      conversationId,
      projectPath: conversation.projectPath,
      sessionId: conversation.sessionId,
      messagePreview: message.substring(0, 50),
      hasAttachments: !!attachments?.length,
    });

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

    // Helper function to save accumulated text chunk
    const saveTextChunk = async () => {
      if (currentTextChunk.trim() && conversationManager) {
        try {
          await conversationManager.saveMessage({
            role: 'assistant',
            content: currentTextChunk,
            messageType: 'assistant',
          }, conversationId);
          mainWindow?.webContents.send('assistant-message-saved', { conversationId });
          currentTextChunk = '';
        } catch (error) {
          console.error('Error saving text chunk:', error);
        }
      }
    };

    await agentManager.sendMessage(conversationId, message, attachments, {
      onToken: (token: string) => {
        currentTextChunk += token;
        mainWindow?.webContents.send('message-token', { token, conversationId });
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
      console.log('[send-message] Updating sessionId for conversation:', conversationId);
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
    } else {
      console.log('[send-message] Message interrupted by user, not saving as error');
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

ipcMain.handle('get-conversation', async (event, conversationId: string, limit?: number, offset?: number) => {
  if (!conversationManager) {
    throw new Error('Services not initialized');
  }

  try {
    console.log('[get-conversation] Loading conversation:', conversationId, { limit, offset });

    // Set this as the active conversation for the conversation manager
    conversationManager.setCurrentConversationId(conversationId);

    // Simply return the conversation - the agent will be created on-demand when needed
    const conversation = await conversationManager.getConversation(conversationId, limit, offset);

    if (conversation) {
      console.log('[get-conversation] Conversation details:', {
        id: conversation.id,
        projectPath: conversation.projectPath,
        sessionId: conversation.sessionId,
        mode: conversation.mode,
      });
    }

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
  console.log('henry we are about to make a new conversation via conversationManager.')
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

  // Update agent mode (will get or create agent for this conversation)
  await agentManager.setMode(conversationId, mode as any);

  // Save mode to database
  await conversationManager.updateMode(conversationId, mode as any);

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

// Approve permission
ipcMain.handle('approve-permission', async (event, permissionId: string, conversationId?: string) => {
  if (!agentManager || !conversationManager) {
    throw new Error('Services not initialized');
  }

  // If no conversationId provided, use the current active conversation
  const targetConversationId = conversationId || conversationManager.getCurrentConversationId();
  if (!targetConversationId) {
    throw new Error('No active conversation');
  }

  await agentManager.approvePermission(targetConversationId, permissionId);
  return { success: true };
});

// Deny permission
ipcMain.handle('deny-permission', async (event, permissionId: string, conversationId?: string) => {
  if (!agentManager || !conversationManager) {
    throw new Error('Services not initialized');
  }

  // If no conversationId provided, use the current active conversation
  const targetConversationId = conversationId || conversationManager.getCurrentConversationId();
  if (!targetConversationId) {
    throw new Error('No active conversation');
  }

  await agentManager.denyPermission(targetConversationId, permissionId);
  return { success: true };
});
