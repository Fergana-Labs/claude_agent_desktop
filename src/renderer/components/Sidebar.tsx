import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef } from 'react';
import { Conversation, SearchResult } from '../types';
import './Sidebar.css';

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  conversationsWithActivity: Set<string>;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onForkConversation: (id: string) => void;
  onShowSettings?: () => void;
}

interface ConversationWithValidity extends Conversation {
  folderExists: boolean;
  matchSnippet?: string;
}

export interface SidebarRef {
  handleDeleteFocused: () => void;
  clearFocus: () => void;
}

const Sidebar = forwardRef<SidebarRef, SidebarProps>(({
  conversations,
  currentConversationId,
  conversationsWithActivity,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onForkConversation,
  onShowSettings,
}, ref) => {
  const [validatedConversations, setValidatedConversations] = useState<ConversationWithValidity[]>([]);
  const [contextMenu, setContextMenu] = useState<{ conversationId: string; x: number; y: number } | null>(null);
  const [focusedConversationId, setFocusedConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [caseSensitive, setCaseSensitive] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Search effect with debouncing
  useEffect(() => {
    const performSearch = async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        const results = await window.electron.searchConversations(searchQuery, caseSensitive);
        setSearchResults(results);

        // Auto-focus first result
        if (results.length > 0) {
          const firstResultId = results[0].conversation.id;
          setFocusedConversationId(firstResultId);
          onSelectConversation(firstResultId);
        }
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    const debounceTimer = setTimeout(performSearch, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery, caseSensitive]);

  useEffect(() => {
    const validateFolders = async () => {
      // Determine which conversations to validate
      const conversationsToValidate = searchQuery.trim()
        ? searchResults.map(result => result.conversation)
        : conversations;

      const validated = await Promise.all(
        conversationsToValidate.map(async (conv) => {
          if (!conv.projectPath) {
            return { ...conv, folderExists: false };
          }
          const result = await window.electron.checkFolderExists(conv.projectPath);

          // Add search match snippet if available
          if (searchQuery.trim()) {
            const searchResult = searchResults.find(r => r.conversation.id === conv.id);
            const matchSnippet = searchResult?.matches?.[0]?.snippet || '';
            return { ...conv, folderExists: result.exists, matchSnippet };
          }

          return { ...conv, folderExists: result.exists };
        })
      );
      setValidatedConversations(validated);
    };

    validateFolders();
  }, [conversations, searchResults, searchQuery]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  // Expose methods via ref for keyboard shortcuts in App
  useImperativeHandle(ref, () => ({
    clearFocus: () => {
      console.log('[Sidebar] clearFocus called');
      setFocusedConversationId(null);
    },
    handleDeleteFocused: () => {
      console.log('[Sidebar] handleDeleteFocused called, focusedConversationId:', focusedConversationId);
      if (focusedConversationId) {
        console.log('[Sidebar] Deleting conversation:', focusedConversationId);
        onDeleteConversation(focusedConversationId);
        // Clear focus after delete
        setFocusedConversationId(null);
      } else {
        console.log('[Sidebar] No focused conversation to delete');
      }
    }
  }), [focusedConversationId, validatedConversations, onDeleteConversation]);

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
    console.log('[Sidebar] Conversation clicked:', conv.id);
    // Set focus to this conversation
    setFocusedConversationId(conv.id);
    console.log('[Sidebar] Focus set to:', conv.id);
    // Always allow selecting conversations - they can view messages even if folder is missing
    onSelectConversation(conv.id);
  };

  const handleContextMenu = (e: React.MouseEvent, conversationId: string) => {
    e.preventDefault();
    setContextMenu({ conversationId, x: e.clientX, y: e.clientY });
  };

  const handleFork = (conversationId: string) => {
    setContextMenu(null);
    onForkConversation(conversationId);
  };

  const handleDelete = (conversationId: string) => {
    setContextMenu(null);
    onDeleteConversation(conversationId);
  };

  const handleRename = (conversationId: string) => {
    setContextMenu(null);
    const conv = validatedConversations.find(c => c.id === conversationId);
    if (conv) {
      setEditingConversationId(conversationId);
      setEditingTitle(conv.title);
      setTimeout(() => titleInputRef.current?.select(), 0);
    }
  };

  const handleTitleSave = async (conversationId: string) => {
    if (!editingTitle.trim()) {
      setEditingConversationId(null);
      return;
    }

    try {
      await window.electron.updateConversationTitle(conversationId, editingTitle.trim());
      setEditingConversationId(null);
      // Trigger conversation list refresh in App component
      // This happens automatically through onConversationTitleUpdated callback
      window.dispatchEvent(new Event('conversation-updated'));
    } catch (error) {
      console.error('Error updating title:', error);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent, conversationId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleTitleSave(conversationId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEditingConversationId(null);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Claude Office Assistant</h2>
        <div className="search-container">
          <input
            type="text"
            className="search-input"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="search-clear-btn"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              ×
            </button>
          )}
          <button
            className={`case-sensitive-btn ${caseSensitive ? 'active' : ''}`}
            onClick={() => setCaseSensitive(!caseSensitive)}
            title={caseSensitive ? 'Case-sensitive' : 'Case-insensitive'}
          >
            Aa
          </button>
        </div>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Chat
        </button>
      </div>

      <div className="conversations-list">
        {validatedConversations.map((conv) => (
          <div
            key={conv.id}
            className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''} ${conv.id === focusedConversationId ? 'focused' : ''} ${!conv.folderExists && conv.projectPath ? 'invalid' : ''}`}
            onClick={() => handleConversationClick(conv)}
            onContextMenu={(e) => handleContextMenu(e, conv.id)}
            style={{
              cursor: 'pointer'
            }}
          >
            <div className="conversation-info">
              <div className="conversation-title">
                {editingConversationId === conv.id ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    className="title-edit-input-sidebar"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => handleTitleKeyDown(e, conv.id)}
                    onBlur={() => handleTitleSave(conv.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
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
                  </>
                )}
              </div>
              {conv.matchSnippet && (
                <div className="search-match-snippet">
                  {conv.matchSnippet}
                </div>
              )}
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
          </div>
        ))}
      </div>

      {/* Settings Footer */}
      {onShowSettings && (
        <div className="sidebar-footer">
          <button className="settings-btn" onClick={onShowSettings}>
            ⚙️ MCP Settings
          </button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            zIndex: 1000,
            minWidth: '150px'
          }}
        >
          <div
            onClick={() => handleRename(contextMenu.conversationId)}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              color: '#fff',
              fontSize: '14px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#383838'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Rename
          </div>
          <div
            onClick={() => handleFork(contextMenu.conversationId)}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              color: '#fff',
              fontSize: '14px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#383838'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Fork Conversation
          </div>
          <div
            onClick={() => handleDelete(contextMenu.conversationId)}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              color: '#ff6b6b',
              fontSize: '14px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#383838'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Delete Conversation
          </div>
        </div>
      )}
    </div>
  );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;
