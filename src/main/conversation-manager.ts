import Database from 'better-sqlite3';

interface Message {
  id?: number;
  conversationId?: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: string[];
  timestamp?: number;
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  projectPath?: string;
  sessionId?: string;
  mode?: PermissionMode;
  messages: Message[];
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
        mode TEXT DEFAULT 'default'
      )
    `);

    // Migrate existing databases to add new columns
    try {
      // Check if columns exist
      const tableInfo = this.db.prepare("PRAGMA table_info(conversations)").all() as any[];
      const hasProjectPath = tableInfo.some(col => col.name === 'project_path');
      const hasSessionId = tableInfo.some(col => col.name === 'session_id');
      const hasMode = tableInfo.some(col => col.name === 'mode');

      if (!hasProjectPath) {
        console.log('Adding project_path column to conversations table');
        this.db.exec('ALTER TABLE conversations ADD COLUMN project_path TEXT');
      }

      if (!hasSessionId) {
        console.log('Adding session_id column to conversations table');
        this.db.exec('ALTER TABLE conversations ADD COLUMN session_id TEXT');
      }

      if (!hasMode) {
        console.log('Adding mode column to conversations table');
        this.db.exec("ALTER TABLE conversations ADD COLUMN mode TEXT DEFAULT 'default'");
      }
    } catch (error) {
      console.error('Error during database migration:', error);
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
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, 'New Conversation', now, now);

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

    const result = this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, attachments, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      targetConversationId,
      message.role,
      message.content,
      attachmentsJson,
      timestamp
    );

    // Update conversation's updated_at timestamp
    this.db.prepare(`
      UPDATE conversations
      SET updated_at = ?
      WHERE id = ?
    `).run(timestamp, targetConversationId);

    // Auto-generate title from first user message
    if (message.role === 'user') {
      this.updateConversationTitle(targetConversationId, message.content);
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
      ORDER BY updated_at DESC
    `).all() as any[];

    return conversations.map(conv => ({
      id: conv.id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      projectPath: conv.project_path || undefined,
      sessionId: conv.session_id || undefined,
      mode: (conv.mode as PermissionMode) || 'default',
      messages: [],
    }));
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    const conversation = this.db.prepare(`
      SELECT * FROM conversations
      WHERE id = ?
    `).get(conversationId) as any;

    if (!conversation) {
      return null;
    }

    const messages = this.db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY timestamp ASC
    `).all(conversationId) as any[];

    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      projectPath: conversation.project_path || undefined,
      sessionId: conversation.session_id || undefined,
      mode: (conversation.mode as PermissionMode) || 'default',
      messages: messages.map(msg => ({
        id: msg.id,
        conversationId: msg.conversation_id,
        role: msg.role,
        content: msg.content,
        attachments: msg.attachments ? JSON.parse(msg.attachments) : undefined,
        timestamp: msg.timestamp,
      })),
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

  async deleteConversation(conversationId: string): Promise<void> {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);

    // If we deleted the current conversation, create a new one
    if (this.currentConversationId === conversationId) {
      this.currentConversationId = this.createConversation();
    }
  }

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  close() {
    this.db.close();
  }
}
