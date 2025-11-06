import React, { useState, useEffect } from 'react';
import { Conversation } from '../types';
import './Sidebar.css';

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  conversationsWithActivity: Set<string>;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

interface ConversationWithValidity extends Conversation {
  folderExists: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  currentConversationId,
  conversationsWithActivity,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}) => {
  const [validatedConversations, setValidatedConversations] = useState<ConversationWithValidity[]>([]);

  useEffect(() => {
    const validateFolders = async () => {
      const validated = await Promise.all(
        conversations.map(async (conv) => {
          if (!conv.projectPath) {
            return { ...conv, folderExists: false };
          }
          const result = await window.electron.checkFolderExists(conv.projectPath);
          return { ...conv, folderExists: result.exists };
        })
      );
      setValidatedConversations(validated);
    };

    validateFolders();
  }, [conversations]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return 'Today';
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const handleConversationClick = (conv: ConversationWithValidity) => {
    // Always allow selecting conversations - they can view messages even if folder is missing
    onSelectConversation(conv.id);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Claude Office Assistant</h2>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Chat
        </button>
      </div>

      <div className="conversations-list">
        {validatedConversations.map((conv) => (
          <div
            key={conv.id}
            className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''} ${!conv.folderExists && conv.projectPath ? 'invalid' : ''}`}
            onClick={() => handleConversationClick(conv)}
            style={{
              cursor: 'pointer'
            }}
          >
            <div className="conversation-info">
              <div className="conversation-title">
                {conv.title}
                {conversationsWithActivity.has(conv.id) && (
                  <span style={{
                    marginLeft: '8px',
                    background: '#4a9eff',
                    color: '#fff',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    animation: 'pulse 2s infinite'
                  }}>
                    New
                  </span>
                )}
              </div>
              <div className="conversation-date">{formatDate(conv.updatedAt)}</div>
              {conv.projectPath && (
                <div style={{
                  fontSize: '10px',
                  color: conv.folderExists ? '#888' : '#d44',
                  marginTop: '2px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  📁 {conv.projectPath.split('/').pop() || conv.projectPath}
                  {!conv.folderExists && ' (folder not found)'}
                </div>
              )}
            </div>
            <button
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('Delete this conversation?')) {
                  onDeleteConversation(conv.id);
                }
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;
