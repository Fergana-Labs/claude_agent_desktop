import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config as loadEnv } from 'dotenv';
import { existsSync, mkdirSync } from 'fs';
import { ClaudeAgent } from './claude-agent.js';
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
let claudeAgent: ClaudeAgent | null = null;
let conversationManager: ConversationManager | null = null;
let activeConversationId: string | null = null;

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

  // Initialize Claude Agent with default settings (will be updated per-conversation)
  claudeAgent = new ClaudeAgent({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    skillsPath: path.join(app.getPath('userData'), '.claude/skills'),
    projectPath: process.cwd(),
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('send-message', async (event, message: string, conversationId: string, attachments?: string[]) => {
  if (!claudeAgent || !conversationManager || !mainWindow) {
    throw new Error('Agent not initialized');
  }

  try {
    // Use the conversation ID passed from the frontend
    // This prevents race conditions where activeConversationId changes
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

    // Stream Claude's response
    let fullResponse = '';

    await claudeAgent.sendMessage(message, attachments, {
      onToken: (token: string) => {
        fullResponse += token;
        mainWindow?.webContents.send('message-token', { token, conversationId });
      },
      onThinking: (thinking: string) => {
        mainWindow?.webContents.send('message-thinking', { thinking, conversationId });
      },
      onToolUse: (toolName: string, toolInput: any) => {
        mainWindow?.webContents.send('tool-execution', {
          tool: toolName,
          input: toolInput,
          status: 'running',
          conversationId,
        });
      },
      onToolResult: (toolName: string, result: any) => {
        mainWindow?.webContents.send('tool-execution', {
          tool: toolName,
          result,
          status: 'completed',
          conversationId,
        });
      },
      onPermissionRequest: (request: any) => {
        mainWindow?.webContents.send('permission-request', { ...request, conversationId });
      },
      onInterrupted: () => {
        mainWindow?.webContents.send('message-interrupted', { conversationId });
      },
    });

    // Save assistant response to the specified conversation
    await conversationManager.saveMessage({
      role: 'assistant',
      content: fullResponse,
    }, conversationId);

    // Save the session ID from this conversation
    const sessionId = claudeAgent.getCurrentSessionId();
    if (sessionId) {
      await conversationManager.updateSessionId(conversationId, sessionId);
    }

    return { success: true, messageId };
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
});

ipcMain.handle('get-conversations', async () => {
  if (!conversationManager) {
    throw new Error('Conversation manager not initialized');
  }
  return await conversationManager.getConversations();
});

ipcMain.handle('get-conversation', async (event, conversationId: string) => {
  if (!conversationManager || !claudeAgent) {
    throw new Error('Services not initialized');
  }

  try {
    // Interrupt any in-flight operations before switching conversations
    await claudeAgent.interrupt();

    // Set this as the active conversation
    activeConversationId = conversationId;
    conversationManager.setCurrentConversationId(conversationId);

    const conversation = await conversationManager.getConversation(conversationId);

    if (conversation) {
      // Update agent's project path if conversation has one
      if (conversation.projectPath) {
        // Reset the old agent before creating a new one
        await claudeAgent.reset();

        claudeAgent = new ClaudeAgent({
          apiKey: process.env.ANTHROPIC_API_KEY || '',
          skillsPath: path.join(app.getPath('userData'), '.claude/skills'),
          projectPath: conversation.projectPath,
        });
      }

      // Load conversation-specific session ID (on current agent)
      if (conversation.sessionId) {
        claudeAgent.setSessionId(conversation.sessionId);
      } else {
        claudeAgent.setSessionId(null);
      }

      // Load conversation-specific mode (on current agent)
      if (conversation.mode) {
        claudeAgent.setMode(conversation.mode);
      } else {
        claudeAgent.setMode('default');
      }
    }

    return conversation;
  } catch (error) {
    console.error('Error loading conversation:', error);
    return null;
  }
});

ipcMain.handle('new-conversation', async () => {
  if (!conversationManager || !claudeAgent) {
    throw new Error('Services not initialized');
  }
  const conversationId = await conversationManager.newConversation();

  // Set as active conversation
  activeConversationId = conversationId;
  conversationManager.setCurrentConversationId(conversationId);

  await claudeAgent.reset();
  return { success: true, conversationId };
});

ipcMain.handle('new-conversation-with-folder', async (event, folderPath: string) => {
  if (!conversationManager || !claudeAgent) {
    throw new Error('Services not initialized');
  }

  // Create new conversation
  const conversationId = await conversationManager.newConversation();

  // Set as active conversation
  activeConversationId = conversationId;
  conversationManager.setCurrentConversationId(conversationId);

  // Set the folder path for this conversation
  await conversationManager.updateProjectPath(conversationId, folderPath);

  // Reset agent session for new conversation
  await claudeAgent.reset();

  // Initialize agent with the selected folder
  claudeAgent = new ClaudeAgent({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    skillsPath: path.join(app.getPath('userData'), '.claude/skills'),
    projectPath: folderPath,
  });

  return { success: true, conversationId };
});

ipcMain.handle('delete-conversation', async (event, conversationId: string) => {
  if (!conversationManager) {
    throw new Error('Conversation manager not initialized');
  }
  await conversationManager.deleteConversation(conversationId);
  return { success: true };
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

ipcMain.handle('get-project-path', async () => {
  if (!conversationManager) {
    throw new Error('Conversation manager not initialized');
  }

  if (!activeConversationId) {
    return { path: '' };
  }

  const conversation = await conversationManager.getConversation(activeConversationId);
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

// Interrupt message processing
ipcMain.handle('interrupt-message', async () => {
  if (!claudeAgent) {
    throw new Error('Agent not initialized');
  }
  await claudeAgent.interrupt();
  return { success: true };
});

// Set permission mode
ipcMain.handle('set-mode', async (event, mode: string) => {
  if (!claudeAgent || !conversationManager) {
    throw new Error('Services not initialized');
  }

  if (!activeConversationId) {
    throw new Error('No active conversation');
  }

  // Update agent mode
  claudeAgent.setMode(mode as any);

  // Save mode to conversation
  await conversationManager.updateMode(activeConversationId, mode as any);

  return { success: true };
});

// Get current mode
ipcMain.handle('get-mode', async () => {
  if (!claudeAgent) {
    throw new Error('Agent not initialized');
  }
  return { mode: claudeAgent.getMode() };
});

// Approve permission
ipcMain.handle('approve-permission', async (event, permissionId: string) => {
  if (!claudeAgent) {
    throw new Error('Agent not initialized');
  }
  await claudeAgent.approvePermission(permissionId);
  return { success: true };
});

// Deny permission
ipcMain.handle('deny-permission', async (event, permissionId: string) => {
  if (!claudeAgent) {
    throw new Error('Agent not initialized');
  }
  await claudeAgent.denyPermission(permissionId);
  return { success: true };
});
