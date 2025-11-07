import { query, Options, SDKMessage, SDKUserMessage, Query, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
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
  pluginsPath: string;
  projectPath?: string;
  sessionId?: string | null;
  parentSessionId?: string | null;
  mode?: PermissionMode;
  mcpServers?: Record<string, McpServerConfig>;
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
  private abortController: AbortController | null = null;
  private isInterrupted: boolean = false;
  private processingAttempts: number = 0;
  private readonly MAX_PROCESSING_ATTEMPTS = 100;
  private callbackQueue: MessageCallbacks[] = [];
  private currentCallbackIndex: number = 0;
  private streamedTextByCallback: Map<number, string> = new Map();
  private needsReload: boolean = false;

  constructor(config: ClaudeAgentConfig) {
    super();
    this.config = config;

    // Initialize session ID and mode from config (for session restoration)
    this.currentSessionId = config.sessionId || null;
    this.mode = config.mode || 'default';

    console.log('[ClaudeAgent] Initialized with:', {
      projectPath: config.projectPath,
      sessionId: this.currentSessionId,
      mode: this.mode,
    });
  }

  // Queue a message for processing
  async sendMessage(
    message: string,
    attachments: string[] = [],
    callbacks: MessageCallbacks = {}
  ): Promise<void> {
    // Check if MCP config needs to be reloaded before processing
    if (this.needsReload) {
      console.log('[ClaudeAgent] Applying new MCP configuration before processing message');
      this.needsReload = false;
      // Config has already been updated in reloadMcpConfig method
    }

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
    this.isInterrupted = false;

    // Emit processing started event
    this.emit('processing-started');

    // Continuous processing loop - keep processing while messages exist
    while (this.messageQueue.length > 0 && !this.isInterrupted) {
      // Safety guard: prevent infinite loops
      this.processingAttempts++;
      if (this.processingAttempts > this.MAX_PROCESSING_ATTEMPTS) {
        console.error('[ClaudeAgent] Max processing attempts reached, stopping to prevent infinite loop');
        break;
      }

      // Clear callback queue from previous iteration
      this.callbackQueue = [];
      this.currentCallbackIndex = 0;
      this.streamedTextByCallback.clear();

      // Create new AbortController for this query
      this.abortController = new AbortController();

      try {
        const projectPath = this.config.projectPath || process.cwd();

        // Check if this is the first message of a forked conversation
        const isFork = this.config.parentSessionId && !this.currentSessionId;

        const options: Options = {
          model: 'claude-sonnet-4-5-20250929',
          maxThinkingTokens: 10000,
          includePartialMessages: true,  // Enable real-time streaming
          cwd: projectPath,
          settingSources: [],
          // Allow all tools by not specifying allowedTools
          plugins: [
            { type: 'local', path: this.config.pluginsPath }
          ],
          mcpServers: this.config.mcpServers,
          resume: isFork ? (this.config.parentSessionId || undefined) : (this.currentSessionId || undefined),
          forkSession: isFork || undefined,
          env: {
            PATH: process.env.PATH,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          },
        };

        // Log SDK initialization details
        console.log('[ClaudeAgent] Starting SDK query with options:', {
          model: options.model,
          cwd: options.cwd,
          plugins: options.plugins,
          resume: options.resume,
          forkSession: options.forkSession,
          isFork,
          hasApiKey: !!(options.env?.ANTHROPIC_API_KEY),
          messageQueueLength: this.messageQueue.length,
          processingAttempt: this.processingAttempts,
        });

        // Create async generator for messages
        const messageGenerator = this.createMessageGenerator();

        // Use streaming input mode with async generator
        this.currentQuery = query({ prompt: messageGenerator, options });

        // Set permission mode on the query
        this.currentQuery.setPermissionMode(this.mode);

        // Handle streaming messages from SDK with abort checking
        for await (const sdkMessage of this.currentQuery) {
          // Check if abort was signaled - break immediately
          if (this.abortController.signal.aborted) {
            console.log('[ClaudeAgent] Abort signal detected, breaking out of message loop');
            throw new Error('AbortError');
          }
          await this.handleMessage(sdkMessage);
        }

        // Query completed successfully, reset attempts counter
        this.processingAttempts = 0;

      } catch (error: any) {
        if (error.name === 'AbortError' || error.message?.includes('interrupt') || error.message?.includes('AbortError')) {
          console.log('[ClaudeAgent] Query interrupted, preserving queued messages');
          this.isInterrupted = true;

          // Notify callbacks about interruption for currently processing messages
          this.callbackQueue.forEach(callbacks => {
            if (callbacks.onInterrupted) {
              callbacks.onInterrupted();
            }
          });

          // Also notify any queued messages that haven't started processing yet
          this.messageQueue.forEach(msg => {
            if (msg.callbacks.onInterrupted) {
              msg.callbacks.onInterrupted();
            }
          });

          // Break out of processing loop but don't clear queue
          break;
        } else {
          console.error('[ClaudeAgent] Error in processQueue:', {
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack,
            sessionId: this.currentSessionId,
            projectPath: this.config.projectPath,
            isProcessing: this.isProcessing,
            queueLength: this.messageQueue.length,
            mode: this.mode,
          });
          throw error;
        }
      } finally {
        this.currentQuery = null;
        this.abortController = null;
      }
    }

    // Only clear processing flag after all messages processed or interrupted
    this.isProcessing = false;

    // Reset attempts counter when processing completely finishes
    this.processingAttempts = 0;

    // Clear callback queue to prevent memory leaks
    this.callbackQueue = [];
    this.currentCallbackIndex = 0;
    this.streamedTextByCallback.clear();

    // Emit processing complete event
    this.emit('processing-complete', {
      interrupted: this.isInterrupted,
      remainingMessages: this.messageQueue.length
    });
  }

  // Create async generator for streaming input
  private async *createMessageGenerator(): AsyncGenerator<SDKUserMessage, void, unknown> {
    // Process only the messages that exist at the start of this generator's lifecycle
    // New messages added during processing will be handled by the next iteration of processQueue's while loop
    const messagesToProcess = [...this.messageQueue];
    this.messageQueue = [];

    // Store all callbacks in queue to route responses correctly
    this.callbackQueue = messagesToProcess.map(msg => msg.callbacks);
    this.currentCallbackIndex = 0;

    console.log('[ClaudeAgent] Processing batch of', messagesToProcess.length, 'messages');

    for (const queued of messagesToProcess) {
      // Build message content
      let content = queued.message;

      // Add attachment context if files are provided
      if (queued.attachments.length > 0) {
        content += '\n\nAttached files:\n';
        queued.attachments.forEach(file => {
          content += `- ${file}\n`;
        });
      }

      console.log('[ClaudeAgent] Yielding message to SDK:', {
        contentPreview: content.substring(0, 100),
        hasAttachments: queued.attachments.length > 0,
        attachmentCount: queued.attachments.length,
      });

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
    // Get callbacks for current message being processed
    const callbacks: MessageCallbacks = this.callbackQueue[this.currentCallbackIndex] || {};

    // Debug logging for all SDK messages
    console.log('[ClaudeAgent] handleMessage:', {
      type: message.type,
      callbackIndex: this.currentCallbackIndex,
      queueLength: this.callbackQueue.length,
      hasOnToken: !!callbacks.onToken,
      hasOnThinking: !!callbacks.onThinking,
      hasOnToolUse: !!callbacks.onToolUse,
    });

    // Extract and store session ID for conversation continuity
    if ('session_id' in message && message.session_id) {
      this.currentSessionId = message.session_id;
    }

    switch (message.type) {
      case 'assistant':
        // Extract text, thinking, and tool_use from assistant message
        console.log('[ClaudeAgent] Assistant message received');
        if (message.message && 'content' in message.message) {
          const content = message.message.content;
          if (Array.isArray(content)) {
            console.log('[ClaudeAgent] Content blocks:', content.map((b: any) => ({ type: b.type, hasText: !!b.text, hasThinking: !!b.thinking })));
            content.forEach((block: any) => {
              if (block.type === 'text' && block.text && callbacks.onToken) {
                const fullText = block.text;
                const streamedText = this.streamedTextByCallback.get(this.currentCallbackIndex) || '';

                if (streamedText.length === 0) {
                  // No streaming occurred, send full text
                  console.log('[ClaudeAgent] No streaming occurred, sending full text block');
                  callbacks.onToken(fullText);
                } else if (fullText.length > streamedText.length) {
                  // Streaming failed midway, send the missing part
                  const missingText = fullText.substring(streamedText.length);
                  console.log('[ClaudeAgent] Streaming incomplete, sending missing text:', missingText.substring(0, 50));
                  callbacks.onToken(missingText);
                } else if (fullText !== streamedText) {
                  // Edge case: Text differs but same length (shouldn't happen, but handle it)
                  console.warn('[ClaudeAgent] Streamed text differs from final text!');
                  console.log('[ClaudeAgent] Sending full text block to be safe');
                  callbacks.onToken(fullText);
                } else {
                  // Streaming completed successfully, no action needed
                  console.log('[ClaudeAgent] Text fully streamed, skipping duplicate');
                }
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
        // Handle streaming events - log full structure to debug
        const streamMsg = message as any;
        console.log('[ClaudeAgent] Stream event structure:', {
          hasEvent: !!streamMsg.event,
          eventType: streamMsg.event?.type,
          hasDelta: !!streamMsg.event?.delta,
          deltaType: streamMsg.event?.delta?.type,
          keys: Object.keys(streamMsg),
        });

        // Try different possible structures
        if (streamMsg.event && streamMsg.event.delta) {
          const delta = streamMsg.event.delta;
          if (delta.type === 'text_delta' && delta.text) {
            // Accumulate the streamed text for this callback
            const currentStreamed = this.streamedTextByCallback.get(this.currentCallbackIndex) || '';
            this.streamedTextByCallback.set(this.currentCallbackIndex, currentStreamed + delta.text);

            console.log('[ClaudeAgent] Found text delta:', delta.text.substring(0, 50));
            if (callbacks.onToken) {
              callbacks.onToken(delta.text);
            }
          }
        } else if ('delta' in streamMsg) {
          const delta = streamMsg.delta;
          if (delta && delta.type === 'text_delta' && delta.text) {
            // Accumulate the streamed text for this callback
            const currentStreamed = this.streamedTextByCallback.get(this.currentCallbackIndex) || '';
            this.streamedTextByCallback.set(this.currentCallbackIndex, currentStreamed + delta.text);

            console.log('[ClaudeAgent] Found text delta (alt structure):', delta.text.substring(0, 50));
            if (callbacks.onToken) {
              callbacks.onToken(delta.text);
            }
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
        // Final result message for current user message - advance to next callback
        console.log('[ClaudeAgent] Result received, advancing to next message callback', {
          from: this.currentCallbackIndex,
          to: this.currentCallbackIndex + 1,
          queueLength: this.callbackQueue.length,
        });
        // Clean up accumulated text for this callback to prevent memory leaks
        this.streamedTextByCallback.delete(this.currentCallbackIndex);
        this.currentCallbackIndex++;
        break;

      case 'system':
        // System initialization
        console.log('[ClaudeAgent] System message received');
        break;

      default:
        // Unknown message type
        console.warn('[ClaudeAgent] Unknown message type:', message.type, message);
        break;
    }
  }

  // Interrupt the current processing
  async interrupt(): Promise<void> {
    try {
      // Set interrupted flag to stop the processing loop
      this.isInterrupted = true;

      console.log('[ClaudeAgent] Interrupt requested, queue length:', this.messageQueue.length);

      // FIRST: Abort via AbortController for immediate cancellation
      if (this.abortController) {
        console.log('[ClaudeAgent] Aborting via AbortController');
        this.abortController.abort();
      }

      // SECOND: Try SDK's interrupt method as backup
      if (this.currentQuery && this.isProcessing) {
        console.log('[ClaudeAgent] Calling SDK interrupt method');

        // Add timeout to prevent hanging forever
        const interruptPromise = this.currentQuery.interrupt();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Interrupt timeout')), 1000)
        );

        try {
          await Promise.race([interruptPromise, timeoutPromise]);
          console.log('[ClaudeAgent] SDK interrupt completed successfully');
        } catch (error: any) {
          if (error.message === 'Interrupt timeout') {
            console.warn('[ClaudeAgent] SDK interrupt timed out after 1s, relying on AbortController');
          } else {
            console.warn('[ClaudeAgent] SDK interrupt error (continuing anyway):', error);
          }
        }
      }
    } catch (error) {
      console.error('[ClaudeAgent] Error interrupting query:', error);
    } finally {
      // Notify currently processing messages about interruption
      this.callbackQueue.forEach(callbacks => {
        if (callbacks.onInterrupted) {
          callbacks.onInterrupted();
        }
      });

      // Also notify all queued messages about interruption
      this.messageQueue.forEach(msg => {
        if (msg.callbacks.onInterrupted) {
          msg.callbacks.onInterrupted();
        }
      });

      // Clear the query reference and processing flag
      this.currentQuery = null;
      this.abortController = null;
      this.isProcessing = false;

      // Emit processing-complete event so frontend can update UI
      this.emit('processing-complete', {
        interrupted: true,
        remainingMessages: this.messageQueue.length
      });

      console.log('[ClaudeAgent] Interrupt complete, messages preserved in queue:', this.messageQueue.length);
    }
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

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  // Get current queue length (useful for debugging and UI feedback)
  getQueueLength(): number {
    return this.messageQueue.length;
  }

  // Clear the message queue (useful after interruption if user wants to discard pending messages)
  clearQueue(): void {
    console.log('[ClaudeAgent] Clearing message queue, discarding', this.messageQueue.length, 'messages');
    this.messageQueue = [];
  }

  // Resume processing if there are queued messages (useful after interruption)
  async resumeProcessing(): Promise<void> {
    if (this.messageQueue.length > 0 && !this.isProcessing) {
      console.log('[ClaudeAgent] Resuming processing with', this.messageQueue.length, 'queued messages');
      this.isInterrupted = false;
      await this.processQueue();
    }
  }

  // Reload MCP configuration
  async reloadMcpConfig(newMcpServers?: Record<string, McpServerConfig>): Promise<void> {
    console.log('[ClaudeAgent] Marking agent for MCP config reload');

    // Update config if new servers provided
    if (newMcpServers !== undefined) {
      this.config.mcpServers = newMcpServers;
    }

    // Mark that reload is needed - will apply on next message
    this.needsReload = true;
  }

  // Permission methods - handled by SDK mode
  async approvePermission(permissionId: string): Promise<void> {
    // Permission approval handled by SDK mode
  }

  async denyPermission(permissionId: string): Promise<void> {
    // Permission denial handled by SDK mode
  }
}
