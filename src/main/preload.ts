import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Send a message to Claude
  sendMessage: (message: string, conversationId: string, attachments?: string[]) =>
    ipcRenderer.invoke('send-message', message, conversationId, attachments),

  // Listen for streaming tokens
  onMessageToken: (callback: (data: { token: string; conversationId: string; startedAt?: number }) => void) => {
    const subscription = (_event: any, data: { token: string; conversationId: string; startedAt?: number }) => callback(data);
    ipcRenderer.on('message-token', subscription);
    return () => ipcRenderer.removeListener('message-token', subscription);
  },

  // Listen for thinking tokens
  onMessageThinking: (callback: (data: { thinking: string; conversationId: string }) => void) => {
    const subscription = (_event: any, data: { thinking: string; conversationId: string }) => callback(data);
    ipcRenderer.on('message-thinking', subscription);
    return () => ipcRenderer.removeListener('message-thinking', subscription);
  },

  // Listen for tool execution updates
  onToolExecution: (callback: (data: any) => void) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('tool-execution', subscription);
    return () => ipcRenderer.removeListener('tool-execution', subscription);
  },

  // Listen for permission requests
  onPermissionRequest: (callback: (request: any) => void) => {
    const subscription = (_event: any, request: any) => callback(request);
    ipcRenderer.on('permission-request', subscription);
    return () => ipcRenderer.removeListener('permission-request', subscription);
  },

  // Listen for plan approval requests
  onPlanApprovalRequest: (callback: (request: any) => void) => {
    const subscription = (_event: any, request: any) => callback(request);
    ipcRenderer.on('plan-approval-request', subscription);
    return () => ipcRenderer.removeListener('plan-approval-request', subscription);
  },

  // Listen for message interruptions
  onMessageInterrupted: (callback: (data: { conversationId: string }) => void) => {
    const subscription = (_event: any, data: { conversationId: string }) => callback(data);
    ipcRenderer.on('message-interrupted', subscription);
    return () => ipcRenderer.removeListener('message-interrupted', subscription);
  },

  // Listen for processing started event
  onProcessingStarted: (callback: (data: { conversationId: string; startedAt?: number }) => void) => {
    const subscription = (_event: any, data: { conversationId: string; startedAt?: number }) => callback(data);
    ipcRenderer.on('processing-started', subscription);
    return () => ipcRenderer.removeListener('processing-started', subscription);
  },

  // Listen for processing complete event
  onProcessingComplete: (callback: (data: { conversationId: string; interrupted: boolean; remainingMessages: number }) => void) => {
    const subscription = (_event: any, data: { conversationId: string; interrupted: boolean; remainingMessages: number }) => callback(data);
    ipcRenderer.on('processing-complete', subscription);
    return () => ipcRenderer.removeListener('processing-complete', subscription);
  },

  // Listen for user message saved event (triggers conversation refresh and sidebar reorder)
  onUserMessageSaved: (callback: (data: { conversationId: string }) => void) => {
    const subscription = (_event: any, data: { conversationId: string }) => callback(data);
    ipcRenderer.on('user-message-saved', subscription);
    return () => ipcRenderer.removeListener('user-message-saved', subscription);
  },

  // Listen for assistant message saved event (triggers conversation list refresh for activity badges)
  onAssistantMessageSaved: (callback: (data: { conversationId: string }) => void) => {
    const subscription = (_event: any, data: { conversationId: string }) => callback(data);
    ipcRenderer.on('assistant-message-saved', subscription);
    return () => ipcRenderer.removeListener('assistant-message-saved', subscription);
  },

  // Listen for permission responded event (when user approves/denies a permission)
  onPermissionResponded: (callback: (data: { conversationId: string }) => void) => {
    const subscription = (_event: any, data: { conversationId: string }) => callback(data);
    ipcRenderer.on('permission-responded', subscription);
    return () => ipcRenderer.removeListener('permission-responded', subscription);
  },

  // Listen for clear permissions event (when interrupting)
  onClearPermissions: (callback: (data: { conversationId: string }) => void) => {
    const subscription = (_event: any, data: { conversationId: string }) => callback(data);
    ipcRenderer.on('clear-permissions', subscription);
    return () => ipcRenderer.removeListener('clear-permissions', subscription);
  },

  // Listen for mode changed event (when mode changes from plan to default, etc.)
  onModeChanged: (callback: (data: { conversationId: string; mode: string }) => void) => {
    const subscription = (_event: any, data: { conversationId: string; mode: string }) => callback(data);
    ipcRenderer.on('mode-changed', subscription);
    return () => ipcRenderer.removeListener('mode-changed', subscription);
  },

  // Conversation management
  getConversations: () => ipcRenderer.invoke('get-conversations'),

  searchConversations: (query: string, caseSensitive: boolean) =>
    ipcRenderer.invoke('search-conversations', query, caseSensitive),

  getActiveConversations: () => ipcRenderer.invoke('get-active-conversations'),

  getConversation: (conversationId: string, limit?: number, offset?: number) =>
    ipcRenderer.invoke('get-conversation', conversationId, limit, offset),

  newConversationWithFolder: (folderPath: string, mode?: string) =>
    ipcRenderer.invoke('new-conversation-with-folder', folderPath, mode),

  deleteConversation: (conversationId: string) =>
    ipcRenderer.invoke('delete-conversation', conversationId),

  forkConversation: (conversationId: string) =>
    ipcRenderer.invoke('fork-conversation', conversationId),

  // Folder selection
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  getProjectPath: (conversationId: string) => ipcRenderer.invoke('get-project-path', conversationId),
  checkFolderExists: (folderPath: string) => ipcRenderer.invoke('check-folder-exists', folderPath),
  createFolder: (parentPath: string, folderName: string) => ipcRenderer.invoke('create-folder', parentPath, folderName),

  // Mode and permission management
  setMode: (mode: string, conversationId: string) => ipcRenderer.invoke('set-mode', mode, conversationId),
  getMode: (conversationId: string) => ipcRenderer.invoke('get-mode', conversationId),
  interruptMessage: (conversationId?: string) => ipcRenderer.invoke('interrupt-message', conversationId),
  approvePermission: (permissionId: string) => ipcRenderer.invoke('approve-permission', permissionId),
  denyPermission: (permissionId: string) => ipcRenderer.invoke('deny-permission', permissionId),
  respondToPermission: (data: { requestId: string; approved: boolean; conversationId?: string; updatedInput?: Record<string, unknown> }) =>
    ipcRenderer.invoke('respond-to-permission', data),
  respondToPlanApproval: (data: { requestId: string; approved: boolean; conversationId?: string }) =>
    ipcRenderer.invoke('respond-to-plan-approval', data),
  updateConversationTitle: (conversationId: string, title: string) => ipcRenderer.invoke('update-conversation-title', conversationId, title),
  pinConversation: (conversationId: string) => ipcRenderer.invoke('pin-conversation', conversationId),
  unpinConversation: (conversationId: string) => ipcRenderer.invoke('unpin-conversation', conversationId),

  // File operations
  openFile: (filePath: string) => ipcRenderer.invoke('open-file', filePath),

  // MCP configuration
  mcpGetConfig: () => ipcRenderer.invoke('mcp:getConfig'),
  mcpSaveConfig: (servers: any) => ipcRenderer.invoke('mcp:saveConfig', servers),
  mcpValidateConfig: (servers: any) => ipcRenderer.invoke('mcp:validateConfig', servers),
  mcpFileExists: () => ipcRenderer.invoke('mcp:fileExists'),
  mcpReloadConfig: () => ipcRenderer.invoke('mcp:reloadConfig'),

  // Notifications
  playNotificationSound: () => ipcRenderer.invoke('play-notification-sound'),

  // App Settings
  updateAppSettings: (settings: {
    model?: string;
    additionalDirectories?: string[];
    systemPromptMode?: 'append' | 'custom';
    customSystemPrompt?: string;
  }) => ipcRenderer.invoke('update-app-settings', settings),
});

// Type definitions for TypeScript
export interface ElectronAPI {
  sendMessage: (message: string, conversationId: string, attachments?: string[]) => Promise<{ success: boolean; messageId: number }>;
  onMessageToken: (callback: (data: { token: string; conversationId: string; startedAt?: number }) => void) => () => void;
  onMessageThinking: (callback: (data: { thinking: string; conversationId: string }) => void) => () => void;
  onToolExecution: (callback: (data: any) => void) => () => void;
  onPermissionRequest: (callback: (request: any) => void) => () => void;
  onPlanApprovalRequest: (callback: (request: any) => void) => () => void;
  onMessageInterrupted: (callback: (data: { conversationId: string }) => void) => () => void;
  onProcessingStarted: (callback: (data: { conversationId: string; startedAt?: number }) => void) => () => void;
  onProcessingComplete: (callback: (data: { conversationId: string; interrupted: boolean; remainingMessages: number }) => void) => () => void;
  onUserMessageSaved: (callback: (data: { conversationId: string }) => void) => () => void;
  onAssistantMessageSaved: (callback: (data: { conversationId: string }) => void) => () => void;
  onPermissionResponded: (callback: (data: { conversationId: string }) => void) => () => void;
  onClearPermissions: (callback: (data: { conversationId: string }) => void) => () => void;
  onModeChanged: (callback: (data: { conversationId: string; mode: string }) => void) => () => void;
  getConversations: () => Promise<any[]>;
  searchConversations: (query: string, caseSensitive: boolean) => Promise<any[]>;
  getActiveConversations: () => Promise<string[]>;
  getConversation: (conversationId: string, limit?: number, offset?: number) => Promise<any>;
  newConversationWithFolder: (folderPath: string, mode?: string) => Promise<{ success: boolean; conversationId: string }>;
  deleteConversation: (conversationId: string) => Promise<{ success: boolean }>;
  forkConversation: (conversationId: string) => Promise<any>;
  selectFolder: () => Promise<{ success: boolean; path?: string }>;
  selectFiles: () => Promise<{ success: boolean; paths: string[] }>;
  getProjectPath: (conversationId: string) => Promise<{ path: string }>;
  checkFolderExists: (folderPath: string) => Promise<{ exists: boolean }>;
  createFolder: (parentPath: string, folderName: string) => Promise<{ success: boolean; error?: string; path: string | null }>;
  setMode: (mode: string, conversationId: string) => Promise<{ success: boolean }>;
  getMode: (conversationId: string) => Promise<{ mode: string }>;
  interruptMessage: (conversationId?: string) => Promise<{ success: boolean; error?: string }>;
  approvePermission: (permissionId: string) => Promise<{ success: boolean }>;
  denyPermission: (permissionId: string) => Promise<{ success: boolean }>;
  respondToPermission: (data: { requestId: string; approved: boolean; conversationId?: string; updatedInput?: Record<string, unknown> }) => Promise<{ success: boolean }>;
  respondToPlanApproval: (data: { requestId: string; approved: boolean; conversationId?: string }) => Promise<{ success: boolean }>;
  updateConversationTitle: (conversationId: string, title: string) => Promise<{ success: boolean; conversation: any }>;
  pinConversation: (conversationId: string) => Promise<{ success: boolean }>;
  unpinConversation: (conversationId: string) => Promise<{ success: boolean }>;
  openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  mcpGetConfig: () => Promise<{ success: boolean; config: any; error?: string }>;
  mcpSaveConfig: (servers: any) => Promise<{ success: boolean; error?: string; validationErrors?: string[] }>;
  mcpValidateConfig: (servers: any) => Promise<{ success: boolean; errors: string[] }>;
  mcpFileExists: () => Promise<{ success: boolean; exists: boolean; error?: string }>;
  mcpReloadConfig: () => Promise<{ success: boolean; message?: string; error?: string }>;
  playNotificationSound: () => Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
