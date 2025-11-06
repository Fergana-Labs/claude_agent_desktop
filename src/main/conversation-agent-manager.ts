import { ClaudeAgent, PermissionMode } from './claude-agent.js';
import { ConversationManager } from './conversation-manager.js';

interface MessageCallbacks {
  onToken?: (token: string) => void;
  onThinking?: (thinking: string) => void;
  onToolUse?: (toolName: string, toolInput: any) => void;
  onToolResult?: (toolName: string, result: any) => void;
  onPermissionRequest?: (request: any) => void;
  onInterrupted?: () => void;
}

interface AgentConfig {
  apiKey: string;
  pluginsPath: string;
}

/**
 * Manages a pool of ClaudeAgent instances, one per conversation.
 * This ensures each conversation maintains its own isolated state:
 * - Session ID (conversation history)
 * - Message queue
 * - Permission mode
 * - Active query
 */
export class ConversationAgentManager {
  private agents: Map<string, ClaudeAgent> = new Map();
  private config: AgentConfig;
  private conversationManager: ConversationManager;

  constructor(config: AgentConfig, conversationManager: ConversationManager) {
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
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    console.log('[AgentManager] Creating new agent for conversation:', {
      conversationId,
      projectPath: conversation.projectPath,
      sessionId: conversation.sessionId,
      mode: conversation.mode,
    });

    // Create new agent with conversation-specific config
    const agent = new ClaudeAgent({
      apiKey: this.config.apiKey,
      pluginsPath: this.config.pluginsPath,
      projectPath: conversation.projectPath || process.cwd(),
      sessionId: conversation.sessionId || null,
      mode: conversation.mode || 'default',
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
   * Handle permission approval
   */
  async approvePermission(conversationId: string, permissionId: string): Promise<void> {
    const agent = this.agents.get(conversationId);
    if (agent) {
      await agent.approvePermission(permissionId);
    }
  }

  /**
   * Handle permission denial
   */
  async denyPermission(conversationId: string, permissionId: string): Promise<void> {
    const agent = this.agents.get(conversationId);
    if (agent) {
      await agent.denyPermission(permissionId);
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
