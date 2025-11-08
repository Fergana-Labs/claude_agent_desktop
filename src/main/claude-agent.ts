import { query, Options, SDKMessage, SDKUserMessage, Query, HookInput, HookJSONOutput, PreToolUseHookInput, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { ContentBlockParam, ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { EventEmitter } from 'events';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface MessageCallbacks {
  onToken?: (token: string) => void;
  onThinking?: (thinking: string) => void;
  onToolUse?: (toolName: string, toolInput: any) => void;
  onToolResult?: (toolName: string, result: any) => void;
  onPermissionRequest?: (request: PermissionRequest) => void;
  onPlanApprovalRequest?: (request: PlanApprovalRequest) => void;
  onInterrupted?: () => void;
}

export interface PermissionRequest {
  id: string;
  tool: string;
  action: string;
  details: string;
  timestamp: number;
}

export interface PlanApprovalRequest {
  id: string;
  plan: string;
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
  model?: string;
  additionalDirectories?: string[];
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append: string };
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
  private streamedTextByCallback: Map<string, string> = new Map();
  private needsReload: boolean = false;
  private pendingPermissionRequests: Map<string, {
    resolve: (result: HookJSONOutput) => void;
    reject: (error: Error) => void;
    toolName: string;
    toolInput: unknown;
  }> = new Map();
  private pendingPlanApprovals: Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(config: ClaudeAgentConfig) {
    super();
    this.config = config;
    console.log('this config is config, and config is', config)

    // Initialize session ID and mode from config (for session restoration)
    this.currentSessionId = config.sessionId || null;
    console.log('config mode is ', config.mode)
    this.mode = config.mode || 'default';
    console.log('this mode is', this.mode)

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
    console.log('henry we are processing the damn queue');
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

        // Map model setting to SDK model ID
        const modelMap: Record<string, string> = {
          'sonnet': 'claude-sonnet-4-5-20250929',
          'opus': 'claude-opus-4-20250514',
          'haiku': 'claude-3-5-haiku-20241022',
        };
        const modelId = this.config.model ? modelMap[this.config.model] || 'claude-sonnet-4-5-20250929' : 'claude-sonnet-4-5-20250929';

        const options: Options = {
          model: modelId,
          maxThinkingTokens: 10000,
          includePartialMessages: true,  // Enable real-time streaming
          cwd: projectPath,
          additionalDirectories: this.config.additionalDirectories || [],
          settingSources: [],
          permissionMode: this.mode,  // Pass permission mode in options
          // Allow all tools by not specifying allowedTools
          plugins: [
            { type: 'local', path: this.config.pluginsPath }
          ],
          mcpServers: this.config.mcpServers,
          resume: isFork ? (this.config.parentSessionId || undefined) : (this.currentSessionId || undefined),
          forkSession: isFork || undefined,
          systemPrompt: this.config.systemPrompt,
          env: {
            PATH: process.env.PATH,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          },
          // PreToolUse hook
          hooks: {
            PreToolUse: [
              {
                hooks: [this.preToolUseHook.bind(this)]
              }
            ]
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

        console.log('henry we are about to set permission mode as ', this.mode)

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

  // PreToolUse hook implementation
  private async preToolUseHook(
    input: HookInput,
    toolUseID: string | undefined,
    options: {
      signal: AbortSignal;
    }
  ): Promise<HookJSONOutput> {
    // Type guard to ensure this is a PreToolUse hook
    if (input.hook_event_name !== 'PreToolUse') {
      console.warn('[ClaudeAgent] preToolUseHook called with wrong event:', input.hook_event_name);
      return { continue: true };
    }

    const hookInput = input as PreToolUseHookInput;

    console.log('henry we are calling preToolUse')
    console.log('[ClaudeAgent] PreToolUse hook called:', {
      toolName: hookInput.tool_name,
      toolUseID,
      mode: this.mode,
      inputKeys: typeof hookInput.tool_input === 'object' && hookInput.tool_input !== null
        ? Object.keys(hookInput.tool_input)
        : 'not an object',
    });

    // If in bypass mode, auto-allow everything
    console.log('henry we r in mode', this.mode)
    if (this.mode === 'bypassPermissions') {
      console.log('[ClaudeAgent] bypassPermissions mode active, auto-allowing');
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        }
      };
    }

    // Get callbacks for current message being processed
    const callbacks = this.callbackQueue[this.currentCallbackIndex] || {};

    // If no callback registered, auto-allow
    if (!callbacks.onPermissionRequest) {
      console.warn('[ClaudeAgent] No onPermissionRequest callback registered, auto-allowing');
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        }
      };
    }

    // Create a unique ID for this request
    const requestId = toolUseID || `hook-${Date.now()}-${Math.random()}`;

    // Create a promise that will be resolved when the user responds
    return new Promise<HookJSONOutput>((resolve, reject) => {
      // Store the resolver
      this.pendingPermissionRequests.set(requestId, {
        resolve,
        reject,
        toolName: hookInput.tool_name,
        toolInput: hookInput.tool_input,
      });

      // Trigger the permission request callback
      const request: PermissionRequest = {
        id: requestId,
        tool: hookInput.tool_name,
        action: hookInput.tool_name,
        details: JSON.stringify(hookInput.tool_input, null, 2),
        timestamp: Date.now(),
      };

      console.log('[ClaudeAgent] Triggering onPermissionRequest:', request);
      callbacks.onPermissionRequest!(request);

      // Handle abort signal
      options.signal.addEventListener('abort', () => {
        this.pendingPermissionRequests.delete(requestId);
        reject(new Error('Permission request aborted'));
      });
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
      // Build message content - handle images vs non-images differently
      let messageContent: string | ContentBlockParam[];

      if (queued.attachments.length > 0) {
        // Separate images from non-image files
        const imageFiles: string[] = [];
        const nonImageFiles: string[] = [];

        queued.attachments.forEach(file => {
          if (isImageFile(file)) {
            imageFiles.push(file);
          } else {
            nonImageFiles.push(file);
          }
        });

        // Build content blocks array
        const contentBlocks: ContentBlockParam[] = [];

        // Add user message text as first block
        contentBlocks.push({
          type: 'text',
          text: queued.message
        } as TextBlockParam);

        // Add images as image blocks
        for (const imagePath of imageFiles) {
          try {
            // Check if file exists
            if (!fs.existsSync(imagePath)) {
              console.warn(`[ClaudeAgent] Image file not found: ${imagePath}`);
              nonImageFiles.push(imagePath); // Fall back to text path
              continue;
            }

            // Read image file and convert to base64
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Data = imageBuffer.toString('base64');
            const mediaType = getImageMediaType(imagePath);

            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data
              }
            } as ImageBlockParam);

            console.log(`[ClaudeAgent] Added image: ${path.basename(imagePath)} (${mediaType})`);
          } catch (error) {
            console.error(`[ClaudeAgent] Error reading image file ${imagePath}:`, error);
            nonImageFiles.push(imagePath); // Fall back to text path
          }
        }

        // Add non-image files as text list
        if (nonImageFiles.length > 0) {
          let attachmentText = '\n\nAttached files:\n';
          nonImageFiles.forEach(file => {
            attachmentText += `- ${file}\n`;
          });
          contentBlocks.push({
            type: 'text',
            text: attachmentText
          } as TextBlockParam);
        }

        messageContent = contentBlocks;
      } else {
        // No attachments, just send message as string
        messageContent = queued.message;
      }

      console.log('[ClaudeAgent] Yielding message to SDK:', {
        contentPreview: typeof messageContent === 'string' ? messageContent.substring(0, 100) : `${messageContent.length} content blocks`,
        hasAttachments: queued.attachments.length > 0,
        attachmentCount: queued.attachments.length,
        imageCount: queued.attachments.filter(f => isImageFile(f)).length,
      });

      // Yield SDKUserMessage object
      yield {
        type: 'user',
        session_id: this.currentSessionId || 'new-session',
        message: {
          role: 'user',
          content: messageContent
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

    console.log('henry we are running handleMessage')

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
                const streamKey = `${this.currentCallbackIndex}-0`; // Default to content_index 0 for assistant messages
                const streamedText = this.streamedTextByCallback.get(streamKey) || '';

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
            // Check if this is a new content block (has index)
            const contentIndex = streamMsg.event.content_index ?? streamMsg.content_index ?? 0;
            
            // Use content index to track separate text blocks
            const streamKey = `${this.currentCallbackIndex}-${contentIndex}`;
            const currentStreamed = this.streamedTextByCallback.get(streamKey) || '';
            const newStreamed = currentStreamed + delta.text;
            this.streamedTextByCallback.set(streamKey, newStreamed);

            // Send the FULL accumulated text instead of just the delta
            // Accumulate text here instead of accumulating deltas in the frontend
            if (callbacks.onToken) {
              callbacks.onToken(newStreamed);
            }
          }
        } else if ('delta' in streamMsg) {
          const delta = streamMsg.delta;
          if (delta && delta.type === 'text_delta' && delta.text) {
            // Check if this is a new content block (has index)
            const contentIndex = streamMsg.content_index ?? 0;
            
            // Use content index to track separate text blocks
            const streamKey = `${this.currentCallbackIndex}-${contentIndex}`;
            const currentStreamed = this.streamedTextByCallback.get(streamKey) || '';
            const newStreamed = currentStreamed + delta.text;
            this.streamedTextByCallback.set(streamKey, newStreamed);

            // Send the FULL accumulated text instead of just the delta
            // Accumulate text here instead of accumulating deltas in the frontend
            if (callbacks.onToken) {
              callbacks.onToken(newStreamed);
            }
          }
        } else {
          // Log unknown stream event structure
          console.log('[ClaudeAgent] Stream event structure:', {
            hasEvent: !!streamMsg.event,
            eventType: streamMsg.event?.type,
            hasDelta: !!streamMsg.event?.delta,
            deltaType: streamMsg.event?.delta?.type,
            keys: Object.keys(streamMsg),
          });
        }
        break;

      case 'tool_progress':
        // Notify about tool execution
        console.log('henry we are in case tool progress')
        if ('tool' in message) {
          const toolMsg = message as any;

          // Check if this is ExitPlanMode tool
          if (toolMsg.tool === 'ExitPlanMode' && toolMsg.status === 'completed') {
            console.log('[ClaudeAgent] ExitPlanMode detected:', toolMsg);

            // Extract the plan from the tool input
            const plan = toolMsg.input?.plan || 'No plan provided';
            const requestId = `plan-${Date.now()}-${Math.random()}`;

            // If we have a plan approval callback, use it
            if (callbacks.onPlanApprovalRequest) {
              const request: PlanApprovalRequest = {
                id: requestId,
                plan: plan,
                timestamp: Date.now(),
              };

              console.log('[ClaudeAgent] Triggering onPlanApprovalRequest:', request);
              callbacks.onPlanApprovalRequest(request);
            } else {
              // No callback registered, auto-approve and switch to default mode
              console.log('[ClaudeAgent] No onPlanApprovalRequest callback, auto-approving plan');
              if (this.currentQuery && this.isProcessing) {
                this.currentQuery.setPermissionMode('default');
                this.mode = 'default';
              }
            }
          } else if (toolMsg.tool && toolMsg.status === 'running' && callbacks.onToolUse) {
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
        // Delete all entries for this callback index (including all content_index variants)
        const keysToDelete: string[] = [];
        this.streamedTextByCallback.forEach((_, key) => {
          if (key.startsWith(`${this.currentCallbackIndex}-`)) {
            keysToDelete.push(key);
          }
        });
        keysToDelete.forEach(key => this.streamedTextByCallback.delete(key));
        this.currentCallbackIndex++;
        break;

      case 'system':
        // System initialization and hook responses
        const systemMsg = message as any;
        if (systemMsg.subtype === 'hook_response') {
          console.log('[ClaudeAgent] Hook response received:', {
            hook_name: systemMsg.hook_name,
            hook_event: systemMsg.hook_event,
            exit_code: systemMsg.exit_code,
            stdout: systemMsg.stdout,
            stderr: systemMsg.stderr,
          });
        } else {
          console.log('[ClaudeAgent] System message received');
        }
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

  // Respond to a permission request
  async respondToPermissionRequest(
    requestId: string,
    approved: boolean,
    updatedInput?: Record<string, unknown>
  ): Promise<void> {
    console.log('[ClaudeAgent] respondToPermissionRequest called:', {
      requestId,
      approved,
      hasUpdatedInput: !!updatedInput,
    });

    const pendingRequest = this.pendingPermissionRequests.get(requestId);

    if (!pendingRequest) {
      console.warn('[ClaudeAgent] No pending permission request found for ID:', requestId);
      return;
    }

    // Remove from pending requests
    this.pendingPermissionRequests.delete(requestId);

    // Resolve the promise with the appropriate HookJSONOutput
    if (approved) {
      const result: HookJSONOutput = {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: updatedInput,
        }
      };
      console.log('[ClaudeAgent] Resolving permission request as allowed');
      pendingRequest.resolve(result);
    } else {
      const result: HookJSONOutput = {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'User denied permission',
        }
      };
      console.log('[ClaudeAgent] Resolving permission request as denied');
      pendingRequest.resolve(result);
    }
  }

  // Respond to a plan approval request
  async respondToPlanApproval(
    requestId: string,
    approved: boolean
  ): Promise<void> {
    console.log('[ClaudeAgent] respondToPlanApproval called:', {
      requestId,
      approved,
    });

    const pendingApproval = this.pendingPlanApprovals.get(requestId);

    if (!pendingApproval) {
      console.warn('[ClaudeAgent] No pending plan approval found for ID:', requestId);
      // Still try to set mode if approved
      if (approved && this.currentQuery && this.isProcessing) {
        console.log('[ClaudeAgent] Switching from plan mode to default mode');
        this.currentQuery.setPermissionMode('default');
        this.mode = 'default';
      }
      return;
    }

    // Remove from pending approvals
    this.pendingPlanApprovals.delete(requestId);

    if (approved) {
      // Switch from plan mode to default execution mode
      if (this.currentQuery && this.isProcessing) {
        console.log('[ClaudeAgent] Plan approved, switching to default mode');
        this.currentQuery.setPermissionMode('default');
        this.mode = 'default';
      }
      pendingApproval.resolve();
    } else {
      // User denied the plan - stay in plan mode or end conversation
      console.log('[ClaudeAgent] Plan denied by user');
      pendingApproval.reject(new Error('Plan denied by user'));
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

  getIsProcessing(): boolean {
    return this.isProcessing;
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

// Helper functions for image handling
function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
}

function getImageMediaType(filePath: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/png'; // fallback
  }
}
