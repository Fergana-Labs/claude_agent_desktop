export interface ElectronAPI {
  sendMessage: (message: string, attachments?: string[]) => Promise<{ success: boolean; messageId: number }>;
  onMessageToken: (callback: (token: string) => void) => () => void;
  onToolExecution: (callback: (data: any) => void) => () => void;
  getConversations: () => Promise<any[]>;
  getConversation: (conversationId: string) => Promise<any>;
  newConversation: () => Promise<{ success: boolean }>;
  deleteConversation: (conversationId: string) => Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
