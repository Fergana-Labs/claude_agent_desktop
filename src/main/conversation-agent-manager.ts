import { ClaudeAgent, PermissionMode, PlanApprovalRequest } from './claude-agent.js';
import { ConversationManager } from './conversation-manager.js';
import { EventEmitter } from 'events';
import { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

interface MessageCallbacks {
  onToken?: (token: string) => void;
  onThinking?: (thinking: string) => void;
  onToolUse?: (toolName: string, toolInput: any) => void;
  onToolResult?: (toolName: string, result: any) => void;
  onPermissionRequest?: (request: any) => void;
  onPlanApprovalRequest?: (request: PlanApprovalRequest) => void;
  onInterrupted?: () => void;
}

interface AgentConfig {
  apiKey: string;
  pluginsPath: string;
  mcpServers?: Record<string, McpServerConfig>;
  model?: string;
  additionalDirectories?: string[];
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append: string };
}

/**
 * Manages a pool of ClaudeAgent instances, one per conversation.
 * This ensures each conversation maintains its own isolated state:
 * - Session ID (conversation history)
 * - Message queue
 * - Permission mode
 * - Active query
 */
export class ConversationAgentManager extends EventEmitter {
  private agents: Map<string, ClaudeAgent> = new Map();
  private config: AgentConfig;
  private conversationManager: ConversationManager;

  constructor(config: AgentConfig, conversationManager: ConversationManager) {
    super();
    this.config = config;
    this.conversationManager = conversationManager;
  }

  /**
   * Gets or creates an agent for a specific conversation
   */
  async getOrCreateAgent(conversationId: string): Promise<ClaudeAgent> {
    // Return existing agent if available
    if (this.agents.has(conversationId)) {
      return this.agents.get(conversationId)!;
    }

    // Get conversation details from database
    const conversation = await this.conversationManager.getConversation(conversationId);
    console.log('we in get or create agent and the conversation is', conversation)
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    console.log('[AgentManager] Creating new agent for conversation:', {
      conversationId,
      projectPath: conversation.projectPath,
      sessionId: conversation.sessionId,
      parentSessionId: conversation.parentSessionId,
      mode: conversation.mode,
    });

    // Create new agent with conversation-specific config
    const agent = new ClaudeAgent({
      apiKey: this.config.apiKey,
      pluginsPath: this.config.pluginsPath,
      projectPath: conversation.projectPath || process.cwd(),
      sessionId: conversation.sessionId || null,
      parentSessionId: conversation.parentSessionId || null,
      mode: conversation.mode || 'default',
      mcpServers: this.config.mcpServers,
      model: this.config.model,
      additionalDirectories: this.config.additionalDirectories,
      systemPrompt: this.config.systemPrompt,
    });

    // Forward agent events with conversationId
    agent.on('processing-started', () => {
      console.log('[AgentManager] Processing started for conversation:', conversationId);
      this.emit('processing-started', { conversationId });
    });

    agent.on('processing-complete', (data: any) => {
      console.log('[AgentManager] Processing complete for conversation:', conversationId, data);
      this.emit('processing-complete', { conversationId, ...data });
    });

    agent.on('clear-permissions', () => {
      console.log('[AgentManager] Clear permissions for conversation:', conversationId);
      this.emit('clear-permissions', { conversationId });
    });

    // Store agent in map
    this.agents.set(conversationId, agent);

    return agent;
  }

  /**
   * Send a message to a specific conversation's agent
   */
  async sendMessage(
    conversationId: string,
    message: string,
    attachments: string[] = [],
    callbacks: MessageCallbacks = {}
  ): Promise<void> {
    const agent = await this.getOrCreateAgent(conversationId);
    await agent.sendMessage(message, attachments, callbacks);
  }

  /**
   * Interrupt message processing for a specific conversation
   */
  async interrupt(conversationId: string): Promise<void> {
    const agent = this.agents.get(conversationId);
    if (agent) {
      await agent.interrupt();
    }
  }

  /**
   * Set permission mode for a specific conversation
   */
  async setMode(conversationId: string, mode: PermissionMode): Promise<void> {
    const agent = await this.getOrCreateAgent(conversationId);
    agent.setMode(mode);
  }

  /**
   * Get permission mode for a specific conversation
   */
  getMode(conversationId: string): PermissionMode {
    const agent = this.agents.get(conversationId);
    return agent ? agent.getMode() : 'default';
  }

  /**
   * Get session ID for a specific conversation
   */
  getCurrentSessionId(conversationId: string): string | null {
    const agent = this.agents.get(conversationId);
    return agent ? agent.getCurrentSessionId() : null;
  }

  /**
   * Delete an agent (called when conversation is deleted)
   */
  async deleteAgent(conversationId: string): Promise<void> {
    const agent = this.agents.get(conversationId);
    if (agent) {
      // Interrupt any active processing
      await agent.interrupt();
      // Remove from map
      this.agents.delete(conversationId);
      console.log('[AgentManager] Deleted agent for conversation:', conversationId);
    }
  }

  /**
   * Handle permission response
   */
  respondToPermissionRequest(conversationId: string, requestId: string, approved: boolean, updatedInput?: Record<string, unknown>): void {
    const agent = this.agents.get(conversationId);
    if (agent) {
      agent.respondToPermissionRequest(requestId, approved, updatedInput);
    } else {
      console.warn('[AgentManager] No agent found for conversation:', conversationId);
    }
  }

  /**
   * Handle plan approval response
   */
  respondToPlanApproval(conversationId: string, requestId: string, approved: boolean): void {
    const agent = this.agents.get(conversationId);
    if (agent) {
      agent.respondToPlanApproval(requestId, approved);
    } else {
      console.warn('[AgentManager] No agent found for conversation:', conversationId);
    }
  }

  /**
   * Reload MCP configuration for all existing agents
   * Agents will apply the new config on their next message
   */
  async reloadMcpConfig(newMcpServers?: Record<string, McpServerConfig>): Promise<void> {
    console.log('[AgentManager] Reloading MCP configuration for all agents...');

    // Update stored config
    if (newMcpServers !== undefined) {
      this.config.mcpServers = newMcpServers;
    }

    // Mark all existing agents for reload
    const reloadPromises = Array.from(this.agents.values()).map(agent =>
      agent.reloadMcpConfig(this.config.mcpServers)
    );

    await Promise.all(reloadPromises);
    console.log('[AgentManager] MCP configuration reloaded for', this.agents.size, 'agents');
  }

  /**
   * Check if a conversation is currently processing
   */
  isConversationProcessing(conversationId: string): boolean {
    const agent = this.agents.get(conversationId);
    return agent ? agent.getIsProcessing() : false;
  }

  /**
   * Get all conversation IDs that are currently processing
   */
  getActiveConversations(): string[] {
    const activeConversations: string[] = [];
    for (const [conversationId, agent] of this.agents.entries()) {
      if (agent.getIsProcessing()) {
        activeConversations.push(conversationId);
      }
    }
    return activeConversations;
  }

  /**
   * Update application settings (model, system prompt, etc.)
   */
  updateSettings(settings: {
    model?: string;
    additionalDirectories?: string[];
    systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append: string };
  }): void {
    console.log('[AgentManager] Updating settings:', settings);
    if (settings.model !== undefined) {
      this.config.model = settings.model;
    }
    if (settings.additionalDirectories !== undefined) {
      this.config.additionalDirectories = settings.additionalDirectories;
    }
    if (settings.systemPrompt !== undefined) {
      this.config.systemPrompt = settings.systemPrompt;
    }
  }

  /**
   * Cleanup all agents (called on shutdown)
   */
  async cleanup(): Promise<void> {
    console.log('[AgentManager] Cleaning up all agents...');
    const promises = Array.from(this.agents.keys()).map(id => this.deleteAgent(id));
    await Promise.all(promises);
  }
}
