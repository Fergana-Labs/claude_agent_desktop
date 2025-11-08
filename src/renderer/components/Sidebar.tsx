import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef } from 'react';
import { Conversation, SearchResult } from '../types';
import './Sidebar.css';

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  conversationsWithActivity: Set<string>;
  activeConversations: Set<string>;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onForkConversation: (id: string) => void;
  onShowSettings?: () => void;
  onTitleUpdated?: () => void;
}

interface ConversationWithValidity extends Conversation {
  folderExists: boolean;
  matchSnippet?: string;
}

export interface SidebarRef {
  handleDeleteFocused: () => void;
  clearFocus: () => void;
  focusSearch: () => void;
}

const Sidebar = forwardRef<SidebarRef, SidebarProps>(({
  conversations,
  currentConversationId,
  conversationsWithActivity,
  activeConversations,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onForkConversation,
  onShowSettings,
  onTitleUpdated,
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
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(260);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Load saved preferences from localStorage
  useEffect(() => {
    const savedWidth = localStorage.getItem('sidebarWidth');
    const savedCollapsed = localStorage.getItem('sidebarCollapsed');

    if (savedWidth) {
      const width = parseInt(savedWidth, 10);
      if (width >= 200 && width <= 600) {
        setSidebarWidth(width);
      }
    }

    if (savedCollapsed) {
      setIsCollapsed(savedCollapsed === 'true');
    }
  }, []);

  // Handle resize drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = e.clientX;

      // Auto-collapse if resizing below 150px
      if (newWidth < 150) {
        setIsCollapsed(true);
        localStorage.setItem('sidebarCollapsed', 'true');
        return;
      }

      // If currently collapsed and resizing, expand it
      if (isCollapsed && newWidth >= 150) {
        setIsCollapsed(false);
        localStorage.setItem('sidebarCollapsed', 'false');
      }

      if (newWidth >= 200 && newWidth <= 600) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Save to localStorage only after drag ends to reduce I/O
      if (!isCollapsed) {
        localStorage.setItem('sidebarWidth', sidebarWidth.toString());
      }
    };

    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isCollapsed, sidebarWidth]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const toggleCollapse = () => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    localStorage.setItem('sidebarCollapsed', newCollapsed.toString());
  };

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
    },
    focusSearch: () => {
      console.log('[Sidebar] focusSearch called');
      searchInputRef.current?.focus();
    }
  }), [focusedConversationId, validatedConversations, onDeleteConversation]);

  const formatDate = (timestamp: number) => {
    const messageDate = new Date(timestamp);
    const now = new Date();

    // Get start of day (midnight) for both dates in local timezone
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDateStart = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());

    // Calculate difference in calendar days
    const daysDiff = Math.floor((todayStart.getTime() - messageDateStart.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff === 0) {
      return 'Today';
    } else if (daysDiff === 1) {
      return 'Yesterday';
    } else if (daysDiff < 7) {
      return `${daysDiff} days ago`;
    } else {
      return messageDate.toLocaleDateString();
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
      onTitleUpdated?.();
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

  const handlePin = async (conversationId: string) => {
    setContextMenu(null);
    try {
      await window.electron.pinConversation(conversationId);
      onTitleUpdated?.(); // Refresh conversation list
    } catch (error) {
      console.error('Error pinning conversation:', error);
    }
  };

  const handleUnpin = async (conversationId: string) => {
    setContextMenu(null);
    try {
      await window.electron.unpinConversation(conversationId);
      onTitleUpdated?.(); // Refresh conversation list
    } catch (error) {
      console.error('Error unpinning conversation:', error);
    }
  };

  // Separate pinned and unpinned conversations
  const pinnedConversations = validatedConversations.filter(conv => conv.isPinned);
  const unpinnedConversations = validatedConversations.filter(conv => !conv.isPinned);

  return (
    <div
      ref={sidebarRef}
      className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isResizing ? 'resizing' : ''}`}
      style={{ width: isCollapsed ? '50px' : `${sidebarWidth}px` }}
    >
      <div className="sidebar-header">
        <div className="sidebar-header-top">
          <h2>{isCollapsed ? '' : 'Claude Office Assistant'}</h2>
          <button
            className="collapse-toggle-btn"
            onClick={toggleCollapse}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? '›' : '‹'}
          </button>
        </div>
        {!isCollapsed && (
          <>
            <div className="search-container">
              <input
                ref={searchInputRef}
                type="text"
                className="search-input"
                placeholder={`Search... (${navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd+K' : 'Ctrl+K'})`}
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
              <span className="keyboard-hint">
                {navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Cmd+T' : 'Ctrl+T'}
              </span>
            </button>
          </>
        )}
      </div>

      {!isCollapsed && (
        <div className="conversations-list">
          {/* Pinned Conversations Section */}
          {pinnedConversations.length > 0 && (
          <>
            <div className="pinned-section-header">Pinned</div>
            {pinnedConversations.map((conv) => (
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
                        <span className="pin-icon">📌</span>
                        {conv.title}
                        {activeConversations.has(conv.id) && (
                          <span style={{
                            marginLeft: '8px',
                            background: '#ff9800',
                            color: '#fff',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            animation: 'pulse 2s infinite'
                          }}>
                            In Progress
                          </span>
                        )}
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
            <div className="section-divider"></div>
          </>
        )}

        {/* Unpinned Conversations Section */}
        {unpinnedConversations.map((conv) => (
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
                    {activeConversations.has(conv.id) && (
                      <span style={{
                        marginLeft: '8px',
                        background: '#ff9800',
                        color: '#fff',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        animation: 'pulse 2s infinite'
                      }}>
                        In Progress
                      </span>
                    )}
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
      )}

      {/* Settings Footer */}
      {onShowSettings && !isCollapsed && (
        <div className="sidebar-footer">
          <button className="settings-btn" onClick={onShowSettings}>
            ⚙️ MCP Settings
          </button>
        </div>
      )}

      {/* Resize Handle */}
      {!isCollapsed && (
        <div
          className="resize-handle"
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        />
      )}

      {/* Context Menu */}
      {contextMenu && (() => {
        const conv = validatedConversations.find(c => c.id === contextMenu.conversationId);
        const isPinned = conv?.isPinned || false;

        return (
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
            {isPinned ? (
              <div
                onClick={() => handleUnpin(contextMenu.conversationId)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  color: '#fff',
                  fontSize: '14px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#383838'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Unpin
              </div>
            ) : (
              <div
                onClick={() => handlePin(contextMenu.conversationId)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  color: '#fff',
                  fontSize: '14px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#383838'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Pin
              </div>
            )}
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
        );
      })()}
    </div>
  );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;
