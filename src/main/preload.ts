import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Send a message to Claude
  sendMessage: (message: string, conversationId: string, attachments?: string[]) =>
    ipcRenderer.invoke('send-message', message, conversationId, attachments),

  // Listen for streaming tokens
  onMessageToken: (callback: (data: { token: string; conversationId: string }) => void) => {
    const subscription = (_event: any, data: { token: string; conversationId: string }) => callback(data);
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

  // Listen for message interruptions
  onMessageInterrupted: (callback: (data: { conversationId: string }) => void) => {
    const subscription = (_event: any, data: { conversationId: string }) => callback(data);
    ipcRenderer.on('message-interrupted', subscription);
    return () => ipcRenderer.removeListener('message-interrupted', subscription);
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

  // Conversation management
  getConversations: () => ipcRenderer.invoke('get-conversations'),

  getConversation: (conversationId: string, limit?: number, offset?: number) =>
    ipcRenderer.invoke('get-conversation', conversationId, limit, offset),

  newConversationWithFolder: (folderPath: string) =>
    ipcRenderer.invoke('new-conversation-with-folder', folderPath),

  deleteConversation: (conversationId: string) =>
    ipcRenderer.invoke('delete-conversation', conversationId),

  // Folder selection
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getProjectPath: (conversationId: string) => ipcRenderer.invoke('get-project-path', conversationId),
  checkFolderExists: (folderPath: string) => ipcRenderer.invoke('check-folder-exists', folderPath),
  createFolder: (parentPath: string, folderName: string) => ipcRenderer.invoke('create-folder', parentPath, folderName),

  // Mode and permission management
  setMode: (mode: string, conversationId: string) => ipcRenderer.invoke('set-mode', mode, conversationId),
  getMode: (conversationId: string) => ipcRenderer.invoke('get-mode', conversationId),
  interruptMessage: (conversationId?: string) => ipcRenderer.invoke('interrupt-message', conversationId),
  approvePermission: (permissionId: string) => ipcRenderer.invoke('approve-permission', permissionId),
  denyPermission: (permissionId: string) => ipcRenderer.invoke('deny-permission', permissionId),
});

// Type definitions for TypeScript
export interface ElectronAPI {
  sendMessage: (message: string, conversationId: string, attachments?: string[]) => Promise<{ success: boolean; messageId: number }>;
  onMessageToken: (callback: (data: { token: string; conversationId: string }) => void) => () => void;
  onMessageThinking: (callback: (data: { thinking: string; conversationId: string }) => void) => () => void;
  onToolExecution: (callback: (data: any) => void) => () => void;
  onPermissionRequest: (callback: (request: any) => void) => () => void;
  onMessageInterrupted: (callback: (data: { conversationId: string }) => void) => () => void;
  onUserMessageSaved: (callback: (data: { conversationId: string }) => void) => () => void;
  onAssistantMessageSaved: (callback: (data: { conversationId: string }) => void) => () => void;
  getConversations: () => Promise<any[]>;
  getConversation: (conversationId: string, limit?: number, offset?: number) => Promise<any>;
  newConversationWithFolder: (folderPath: string) => Promise<{ success: boolean; conversationId: string }>;
  deleteConversation: (conversationId: string) => Promise<{ success: boolean }>;
  selectFolder: () => Promise<{ success: boolean; path?: string }>;
  getProjectPath: (conversationId: string) => Promise<{ path: string }>;
  checkFolderExists: (folderPath: string) => Promise<{ exists: boolean }>;
  createFolder: (parentPath: string, folderName: string) => Promise<{ success: boolean; error?: string; path: string | null }>;
  setMode: (mode: string, conversationId: string) => Promise<{ success: boolean }>;
  getMode: (conversationId: string) => Promise<{ mode: string }>;
  interruptMessage: (conversationId?: string) => Promise<{ success: boolean; error?: string }>;
  approvePermission: (permissionId: string) => Promise<{ success: boolean }>;
  denyPermission: (permissionId: string) => Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
