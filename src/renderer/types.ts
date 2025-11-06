export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export type MessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'thinking' | 'error';

export interface Message {
  id?: number;
  conversationId?: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: string[];
  timestamp?: number;
  messageType?: MessageType;
  metadata?: any;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  projectPath?: string;
  sessionId?: string;
  parentSessionId?: string;
  mode?: PermissionMode;
  messages: Message[];
  totalMessageCount?: number;
}

export interface ToolExecution {
  tool: string;
  input?: any;
  result?: any;
  status: 'running' | 'completed';
}

export interface PermissionRequest {
  id: string;
  tool: string;
  action: string;
  details: string;
  timestamp: number;
}
