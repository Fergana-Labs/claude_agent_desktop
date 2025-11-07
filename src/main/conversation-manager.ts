import Database from 'better-sqlite3';

export type MessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'thinking' | 'error';

interface Message {
  id?: number;
  conversationId?: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: string[];
  timestamp?: number;
  messageType?: MessageType;
  metadata?: any;
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

interface Conversation {
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

export class ConversationManager {
  private db: Database.Database;
  private currentConversationId: string | null = null;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase() {
    // Create conversations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        project_path TEXT,
        session_id TEXT,
        mode TEXT DEFAULT 'default',
        last_user_message_at INTEGER
      )
    `);

    // Migrate existing databases to add new columns
    try {
      // Check if columns exist
      const tableInfo = this.db.prepare("PRAGMA table_info(conversations)").all() as any[];
      const hasProjectPath = tableInfo.some(col => col.name === 'project_path');
      const hasSessionId = tableInfo.some(col => col.name === 'session_id');
      const hasMode = tableInfo.some(col => col.name === 'mode');
      const hasLastUserMessageAt = tableInfo.some(col => col.name === 'last_user_message_at');
      const hasParentSessionId = tableInfo.some(col => col.name === 'parent_session_id');

      if (!hasProjectPath) {
        this.db.exec('ALTER TABLE conversations ADD COLUMN project_path TEXT');
      }

      if (!hasSessionId) {
        this.db.exec('ALTER TABLE conversations ADD COLUMN session_id TEXT');
      }

      if (!hasMode) {
        this.db.exec("ALTER TABLE conversations ADD COLUMN mode TEXT DEFAULT 'default'");
      }

      if (!hasLastUserMessageAt) {
        this.db.exec('ALTER TABLE conversations ADD COLUMN last_user_message_at INTEGER');
        // Initialize last_user_message_at with updated_at for existing conversations
        this.db.exec('UPDATE conversations SET last_user_message_at = updated_at WHERE last_user_message_at IS NULL');
      }

      if (!hasParentSessionId) {
        this.db.exec('ALTER TABLE conversations ADD COLUMN parent_session_id TEXT');
      }
    } catch (error) {
      console.error('Error during database migration:', error);
    }

    // Migrate messages table to add message_type and metadata columns
    try {
      const messageTableInfo = this.db.prepare("PRAGMA table_info(messages)").all() as any[];
      const hasMessageType = messageTableInfo.some(col => col.name === 'message_type');
      const hasMetadata = messageTableInfo.some(col => col.name === 'metadata');

      if (!hasMessageType) {
        // Add message_type column with default based on role
        this.db.exec('ALTER TABLE messages ADD COLUMN message_type TEXT');
        // Set message_type based on role for existing messages
        this.db.exec("UPDATE messages SET message_type = role WHERE message_type IS NULL");
      }

      if (!hasMetadata) {
        this.db.exec('ALTER TABLE messages ADD COLUMN metadata TEXT');
      }
    } catch (error) {
      console.error('Error during messages table migration:', error);
    }

    // Create messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments TEXT,
        timestamp INTEGER NOT NULL,
        message_type TEXT DEFAULT 'assistant',
        metadata TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);

    // Create index for faster queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, timestamp)
    `);

    // Initialize first conversation if none exists
    const count = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number };
    if (count.count === 0) {
      this.createConversation();
    } else {
      // Load the most recent conversation
      const recent = this.db.prepare(`
        SELECT id FROM conversations
        ORDER BY updated_at DESC
        LIMIT 1
      `).get() as { id: string };
      this.currentConversationId = recent.id;
    }
  }

  private createConversation(): string {
    const id = this.generateId();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at, last_user_message_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, 'New Conversation', now, now, now);

    this.currentConversationId = id;
    return id;
  }

  async newConversation(): Promise<string> {
    return this.createConversation();
  }

  async saveMessage(message: Message, conversationId?: string): Promise<number> {
    // Use provided conversationId, or fall back to currentConversationId
    let targetConversationId = conversationId || this.currentConversationId;

    if (!targetConversationId) {
      targetConversationId = this.createConversation();
      this.currentConversationId = targetConversationId;
    }

    const timestamp = Date.now();
    const attachmentsJson = message.attachments ? JSON.stringify(message.attachments) : null;
    const messageType = message.messageType || message.role; // Default to role if not specified
    const metadataJson = message.metadata ? JSON.stringify(message.metadata) : null;

    const result = this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, attachments, timestamp, message_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      targetConversationId,
      message.role,
      message.content,
      attachmentsJson,
      timestamp,
      messageType,
      metadataJson
    );

    // Update conversation's updated_at timestamp
    // If this is a user message, also update last_user_message_at for sidebar sorting
    if (message.role === 'user') {
      this.db.prepare(`
        UPDATE conversations
        SET updated_at = ?, last_user_message_at = ?
        WHERE id = ?
      `).run(timestamp, timestamp, targetConversationId);

      // Auto-generate title from first user message
      this.updateConversationTitle(targetConversationId, message.content);
    } else {
      // For assistant messages, only update updated_at
      this.db.prepare(`
        UPDATE conversations
        SET updated_at = ?
        WHERE id = ?
      `).run(timestamp, targetConversationId);
    }

    return result.lastInsertRowid as number;
  }

  private updateConversationTitle(conversationId: string, firstMessage: string) {
    const messageCount = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM messages
      WHERE conversation_id = ? AND role = 'user'
    `).get(conversationId) as { count: number };

    // Only update title for the first message
    if (messageCount.count === 1) {
      const title = firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '');
      this.db.prepare(`
        UPDATE conversations
        SET title = ?
        WHERE id = ?
      `).run(title, conversationId);
    }
  }

  async getConversations(): Promise<Conversation[]> {
    const conversations = this.db.prepare(`
      SELECT * FROM conversations
      ORDER BY COALESCE(last_user_message_at, updated_at, created_at) DESC
    `).all() as any[];

    return conversations.map(conv => ({
      id: conv.id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      projectPath: conv.project_path || undefined,
      sessionId: conv.session_id || undefined,
      parentSessionId: conv.parent_session_id || undefined,
      mode: (conv.mode as PermissionMode) || 'default',
      messages: [],
    }));
  }

  async getConversation(conversationId: string, limit?: number, offset?: number): Promise<Conversation | null> {
    const conversation = this.db.prepare(`
      SELECT * FROM conversations
      WHERE id = ?
    `).get(conversationId) as any;

    if (!conversation) {
      return null;
    }

    // Get total message count
    const totalCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE conversation_id = ?
    `).get(conversationId) as { count: number };

    // If limit is provided, use pagination
    let messages: any[];
    if (limit !== undefined) {
      // For initial load, get the latest N messages
      // For loading older messages, use offset
      const actualOffset = offset || 0;
      messages = this.db.prepare(`
        SELECT * FROM messages
        WHERE conversation_id = ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(conversationId, limit, actualOffset) as any[];

      // Reverse to show oldest first (chronological order)
      messages.reverse();
    } else {
      // Load all messages (backward compatibility)
      messages = this.db.prepare(`
        SELECT * FROM messages
        WHERE conversation_id = ?
        ORDER BY timestamp ASC
      `).all(conversationId) as any[];
    }

    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      projectPath: conversation.project_path || undefined,
      sessionId: conversation.session_id || undefined,
      parentSessionId: conversation.parent_session_id || undefined,
      mode: (conversation.mode as PermissionMode) || 'default',
      messages: messages.map(msg => {
        let attachments: string[] | undefined = undefined;
        if (msg.attachments) {
          try {
            const parsed = JSON.parse(msg.attachments);
            // Ensure it's an array, not null or other value
            attachments = Array.isArray(parsed) ? parsed : undefined;
          } catch (e) {
            console.error('Failed to parse attachments:', e);
            attachments = undefined;
          }
        }

        return {
          id: msg.id,
          conversationId: msg.conversation_id,
          role: msg.role,
          content: msg.content,
          attachments,
          timestamp: msg.timestamp,
          messageType: (msg.message_type as MessageType) || msg.role,
          metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined,
        };
      }),
      totalMessageCount: totalCount.count,
    };
  }

  async updateProjectPath(conversationId: string, projectPath: string): Promise<void> {
    this.db.prepare(`
      UPDATE conversations
      SET project_path = ?, updated_at = ?
      WHERE id = ?
    `).run(projectPath, Date.now(), conversationId);
  }

  async updateSessionId(conversationId: string, sessionId: string): Promise<void> {
    this.db.prepare(`
      UPDATE conversations
      SET session_id = ?, updated_at = ?
      WHERE id = ?
    `).run(sessionId, Date.now(), conversationId);
  }

  async updateMode(conversationId: string, mode: PermissionMode): Promise<void> {
    this.db.prepare(`
      UPDATE conversations
      SET mode = ?, updated_at = ?
      WHERE id = ?
    `).run(mode, Date.now(), conversationId);
  }

  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }

  setCurrentConversationId(conversationId: string | null): void {
    this.currentConversationId = conversationId;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);

    // If we deleted the current conversation, clear it
    if (this.currentConversationId === conversationId) {
      this.currentConversationId = null;
    }
  }

  async forkConversation(conversationId: string): Promise<Conversation> {
    // Get the parent conversation
    const parentConversation = await this.getConversation(conversationId);

    if (!parentConversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Create new conversation with same properties
    const newId = this.generateId();
    const now = Date.now();

    // Insert new conversation with parent's sessionId as parent_session_id
    this.db.prepare(`
      INSERT INTO conversations (
        id, title, created_at, updated_at, last_user_message_at,
        project_path, mode, parent_session_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId,
      parentConversation.title + ' (fork)',
      now,
      now,
      now,
      parentConversation.projectPath || null,
      parentConversation.mode || 'default',
      parentConversation.sessionId || null
    );

    // Copy all messages from parent conversation
    const messages = this.db.prepare(`
      SELECT role, content, attachments, timestamp, message_type, metadata
      FROM messages
      WHERE conversation_id = ?
      ORDER BY timestamp ASC
    `).all(conversationId) as any[];

    const insertMessage = this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, attachments, timestamp, message_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const msg of messages) {
      insertMessage.run(
        newId,
        msg.role,
        msg.content,
        msg.attachments,
        msg.timestamp,
        msg.message_type,
        msg.metadata
      );
    }

    // Return the complete forked conversation
    const forkedConversation = await this.getConversation(newId);

    if (!forkedConversation) {
      throw new Error('Failed to create forked conversation');
    }

    return forkedConversation;
  }

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  close() {
    this.db.close();
  }
}
