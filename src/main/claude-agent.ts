import { query, Options, SDKMessage, SDKUserMessage, Query } from '@anthropic-ai/claude-agent-sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

interface MessageCallbacks {
  onToken?: (token: string) => void;
  onThinking?: (thinking: string) => void;
  onToolUse?: (toolName: string, toolInput: any) => void;
  onToolResult?: (toolName: string, result: any) => void;
  onPermissionRequest?: (request: PermissionRequest) => void;
  onInterrupted?: () => void;
}

interface PermissionRequest {
  id: string;
  tool: string;
  action: string;
  details: string;
  timestamp: number;
}

interface ClaudeAgentConfig {
  apiKey: string;
  skillsPath: string;
  projectPath?: string;
}

interface QueuedMessage {
  message: string;
  attachments: string[];
  callbacks: MessageCallbacks;
}

export class ClaudeAgent extends EventEmitter {
  private config: ClaudeAgentConfig;
  private currentSessionId: string | null = null;
  private mode: PermissionMode = 'default';
  private messageQueue: QueuedMessage[] = [];
  private isProcessing: boolean = false;
  private currentQuery: Query | null = null;

  constructor(config: ClaudeAgentConfig) {
    super();
    this.config = config;
  }

  // Queue a message for processing
  async sendMessage(
    message: string,
    attachments: string[] = [],
    callbacks: MessageCallbacks = {}
  ): Promise<void> {
    // Add message to queue
    this.messageQueue.push({ message, attachments, callbacks });

    // Start processing if not already running
    if (!this.isProcessing) {
      await this.processQueue();
    }
  }

  // Process queued messages using async generator pattern
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const projectPath = this.config.projectPath || process.cwd();

      const options: Options = {
        model: 'claude-sonnet-4-5-20250929',
        maxThinkingTokens: 10000,
        cwd: projectPath,
        settingSources: ['user', 'project'],
        allowedTools: ['Skill', 'Read', 'Write', 'Bash'],
        resume: this.currentSessionId || undefined,
        env: {
          PATH: process.env.PATH,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
      };

      // Create async generator for messages
      const messageGenerator = this.createMessageGenerator();

      // Use streaming input mode with async generator
      this.currentQuery = query({ prompt: messageGenerator, options });

      // Set permission mode on the query
      this.currentQuery.setPermissionMode(this.mode);

      // Handle streaming messages from SDK
      for await (const sdkMessage of this.currentQuery) {
        await this.handleMessage(sdkMessage);
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message?.includes('interrupt')) {
        // Notify all queued callbacks about interruption
        this.messageQueue.forEach(msg => {
          if (msg.callbacks.onInterrupted) {
            msg.callbacks.onInterrupted();
          }
        });
      } else {
        console.error('Error in processQueue:', error);
        throw error;
      }
    } finally {
      this.isProcessing = false;
      this.currentQuery = null;
      this.messageQueue = [];
    }
  }

  // Create async generator for streaming input
  private async *createMessageGenerator(): AsyncGenerator<SDKUserMessage, void, unknown> {
    while (this.messageQueue.length > 0) {
      const queued = this.messageQueue.shift();
      if (!queued) break;

      // Store current callbacks in a way the message handler can access them
      (this as any).currentCallbacks = queued.callbacks;

      // Build message content
      let content = queued.message;

      // Add attachment context if files are provided
      if (queued.attachments.length > 0) {
        content += '\n\nAttached files:\n';
        queued.attachments.forEach(file => {
          content += `- ${file}\n`;
        });
      }

      // Yield SDKUserMessage object
      yield {
        type: 'user',
        session_id: this.currentSessionId || 'new-session',
        message: {
          role: 'user',
          content: content
        },
        parent_tool_use_id: null,
      } as SDKUserMessage;
    }
  }

  private async handleMessage(message: SDKMessage) {
    const callbacks: MessageCallbacks = (this as any).currentCallbacks || {};

    // Extract and store session ID for conversation continuity
    if ('session_id' in message && message.session_id) {
      this.currentSessionId = message.session_id;
    }

    switch (message.type) {
      case 'assistant':
        // Extract text, thinking, and tool_use from assistant message
        if (message.message && 'content' in message.message) {
          const content = message.message.content;
          if (Array.isArray(content)) {
            content.forEach((block: any) => {
              if (block.type === 'text' && callbacks.onToken) {
                callbacks.onToken(block.text);
              } else if (block.type === 'thinking' && callbacks.onThinking) {
                callbacks.onThinking(block.thinking);
              } else if (block.type === 'tool_use' && callbacks.onToolUse) {
                callbacks.onToolUse(block.name, block.input);
              }
            });
          }
        }
        break;

      case 'stream_event':
        // Handle streaming events
        if (callbacks.onToken && 'delta' in message) {
          const delta = (message as any).delta;
          if (delta && delta.type === 'text_delta' && delta.text) {
            callbacks.onToken(delta.text);
          }
        }
        break;

      case 'tool_progress':
        // Notify about tool execution
        if (callbacks.onToolUse && 'tool' in message) {
          const toolMsg = message as any;
          if (toolMsg.tool && toolMsg.status === 'running') {
            callbacks.onToolUse(toolMsg.tool, toolMsg.input || {});
          } else if (toolMsg.tool && toolMsg.status === 'completed' && callbacks.onToolResult) {
            callbacks.onToolResult(toolMsg.tool, toolMsg.result);
          }
        }
        break;

      case 'result':
        // Final result message
        break;

      case 'system':
        // System initialization
        break;

      default:
        // Unknown message type
        break;
    }
  }

  // Interrupt the current processing
  async interrupt(): Promise<void> {
    if (this.currentQuery && this.isProcessing) {
      this.currentQuery.interrupt();
    }
    // Clear the query reference and processing flag to prevent dangling references
    this.currentQuery = null;
    this.isProcessing = false;
  }

  // Set the permission mode
  setMode(mode: PermissionMode): void {
    this.mode = mode;

    // Update current query if running and processing
    // Only update if the query is still active to prevent "write after end" errors
    if (this.currentQuery && this.isProcessing) {
      try {
        this.currentQuery.setPermissionMode(mode);
      } catch (error) {
        // Ignore errors if the query has already ended
        console.warn('Failed to set permission mode on current query:', error);
      }
    }
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  async reset(): Promise<void> {
    // Interrupt any active query first
    if (this.currentQuery && this.isProcessing) {
      this.currentQuery.interrupt();
    }

    // Clear all state
    this.currentQuery = null;
    this.currentSessionId = null;
    this.mode = 'default';
    this.messageQueue = [];
    this.isProcessing = false;
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  setSessionId(sessionId: string | null): void {
    this.currentSessionId = sessionId;
  }

  // Permission methods - handled by SDK mode
  async approvePermission(permissionId: string): Promise<void> {
    // Permission approval handled by SDK mode
  }

  async denyPermission(permissionId: string): Promise<void> {
    // Permission denial handled by SDK mode
  }
}
