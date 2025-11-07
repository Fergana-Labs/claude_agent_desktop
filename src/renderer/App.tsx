import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import FolderSelectionModal from './components/FolderSelectionModal';
import { Conversation, PermissionMode } from './types';
import './App.css';

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [isElectronReady, setIsElectronReady] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [conversationsWithActivity, setConversationsWithActivity] = useState<Set<string>>(new Set());
  const sidebarRef = useRef<{ handleDeleteFocused: () => void; clearFocus: () => void } | null>(null);

  useEffect(() => {
    // Check if electron API is available
    if (window.electron) {
      setIsElectronReady(true);
      loadConversations();
    } else {
      console.error('Electron API not available');
    }
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      console.log('[Keyboard] Key pressed:', e.key, 'Shift:', e.shiftKey, 'Meta:', e.metaKey, 'Ctrl:', e.ctrlKey, 'In input:', isInInputField);

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Cmd-T / Ctrl-T: Create new chat with current folder
      // Don't trigger when typing in input/textarea
      if (cmdOrCtrl && e.key === 't' && !isInInputField) {
        console.log('[Keyboard] Cmd-T triggered');
        e.preventDefault();
        if (currentConversation?.projectPath) {
          // Create new chat with current conversation's folder
          try {
            const result = await window.electron.newConversationWithFolder(currentConversation.projectPath);
            await loadConversations();

            // Auto-select the newly created conversation but DON'T focus it in sidebar
            if (result.success && result.conversationId) {
              await loadConversation(result.conversationId);
              // Clear sidebar focus since we're in the text editor
              sidebarRef.current?.clearFocus();
            }
          } catch (error) {
            console.error('Error creating new conversation:', error);
          }
        } else {
          // No current folder, open folder selection modal
          setShowFolderModal(true);
        }
      }

      // Esc: Interrupt current message (works everywhere, including textarea)
      if (e.key === 'Escape') {
        console.log('[Keyboard] Escape key detected!');
        console.log('[Keyboard] Current conversation ID:', currentConversation?.id);
        e.preventDefault();
        if (currentConversation?.id) {
          console.log('[Keyboard] Calling interruptMessage for conversation:', currentConversation.id);
          try {
            const result = await window.electron.interruptMessage(currentConversation.id);
            console.log('[Keyboard] Interrupt result:', result);
          } catch (error) {
            console.error('[Keyboard] Error interrupting message:', error);
          }
        } else {
          console.log('[Keyboard] No current conversation, cannot interrupt');
        }
      }

      // Shift-Tab: Cycle through modes (works everywhere, including textarea)
      if (e.shiftKey && e.key === 'Tab') {
        console.log('[Keyboard] Shift-Tab triggered, currentConversation:', currentConversation?.id);
        e.preventDefault();
        if (currentConversation?.id) {
          try {
            const result = await window.electron.getMode(currentConversation.id);
            const currentMode = result.mode as PermissionMode;
            console.log('[Keyboard] Current mode:', currentMode);

            // Cycle: default → acceptEdits → plan → default (skip bypassPermissions)
            let nextMode: PermissionMode;
            switch (currentMode) {
              case 'default':
                nextMode = 'acceptEdits';
                break;
              case 'acceptEdits':
                nextMode = 'plan';
                break;
              case 'plan':
                nextMode = 'default';
                break;
              case 'bypassPermissions':
                // If somehow in bypassPermissions mode, go to default
                nextMode = 'default';
                break;
              default:
                nextMode = 'default';
            }

            console.log('[Keyboard] Setting mode to:', nextMode);
            await window.electron.setMode(nextMode, currentConversation.id);
            // Reload conversation to trigger ChatArea's mode loading useEffect
            await loadConversation(currentConversation.id);
          } catch (error) {
            console.error('Error cycling mode:', error);
          }
        } else {
          console.log('[Keyboard] No current conversation, cannot cycle mode');
        }
      }

      // Delete: Delete focused chat in sidebar (only when NOT in input field)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInInputField) {
        console.log('[Keyboard] Delete/Backspace triggered, calling handleDeleteFocused');
        e.preventDefault();
        sidebarRef.current?.handleDeleteFocused();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentConversation]);

  const loadConversations = async () => {
    try {
      const convos = await window.electron.getConversations();

      // Detect conversations that have updated while viewing a different one
      const newActivity = new Set(conversationsWithActivity);
      convos.forEach(conv => {
        // If this conversation updated and it's not the current one
        if (currentConversation && conv.id !== currentConversation.id) {
          const oldConv = conversations.find(c => c.id === conv.id);
          // If updatedAt changed, mark as having activity
          if (oldConv && conv.updatedAt > oldConv.updatedAt) {
            newActivity.add(conv.id);
          }
        }
      });
      setConversationsWithActivity(newActivity);

      setConversations(convos);

      // Check if current conversation still exists
      const currentStillExists = currentConversation && convos.some(c => c.id === currentConversation.id);

      if (convos.length === 0) {
        // No conversations left, clear current conversation
        setCurrentConversation(null);
      } else if (!currentStillExists) {
        // Current conversation was deleted, load the most recent one
        loadConversation(convos[0].id);
      } else if (currentConversation) {
        // Reload current conversation to get updated messages
        await loadConversation(currentConversation.id);
      } else {
        // No current conversation but conversations exist, load the first one
        loadConversation(convos[0].id);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const loadConversation = async (conversationId: string, limit?: number, offset?: number) => {
    try {
      // For initial load, use pagination (load last 50 messages)
      const initialLimit = limit !== undefined ? limit : 50;
      const conversation = await window.electron.getConversation(conversationId, initialLimit, offset);
      setCurrentConversation(conversation);

      // Clear activity indicator for this conversation
      setConversationsWithActivity(prev => {
        const newSet = new Set(prev);
        newSet.delete(conversationId);
        return newSet;
      });
    } catch (error) {
      console.error('Error loading conversation:', error);
    }
  };

  const handleNewConversation = () => {
    // Open folder selection modal
    setShowFolderModal(true);
  };

  const handleFolderSelected = async (folderPath: string) => {
    try {
      const result = await window.electron.newConversationWithFolder(folderPath);
      setShowFolderModal(false);
      await loadConversations();

      // Auto-select the newly created conversation
      if (result.success && result.conversationId) {
        await loadConversation(result.conversationId);
      }
    } catch (error) {
      console.error('Error creating new conversation:', error);
    }
  };

  const handleFolderModalCancel = () => {
    setShowFolderModal(false);
  };

  const handleLoadMoreMessages = async (conversationId: string, offset: number) => {
    try {
      const limit = 50; // Load 50 messages at a time
      const olderMessages = await window.electron.getConversation(conversationId, limit, offset);

      if (olderMessages && currentConversation) {
        // Prepend older messages to current conversation
        const updatedConversation = {
          ...currentConversation,
          messages: [...olderMessages.messages, ...currentConversation.messages],
          totalMessageCount: olderMessages.totalMessageCount,
        };
        setCurrentConversation(updatedConversation);
      }
    } catch (error) {
      console.error('Error loading more messages:', error);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await window.electron.deleteConversation(conversationId);
      await loadConversations();
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  };

  const handleForkConversation = async (conversationId: string) => {
    try {
      const forkedConversation = await window.electron.forkConversation(conversationId);
      await loadConversations();

      // Auto-select the newly forked conversation
      if (forkedConversation) {
        await loadConversation(forkedConversation.id);
      }
    } catch (error) {
      console.error('Error forking conversation:', error);
    }
  };

  if (!isElectronReady) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#1e1e1e',
        color: '#fff',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <h2>Loading Claude Office Assistant...</h2>
        <p>If this message persists, check the console for errors.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <FolderSelectionModal
        isOpen={showFolderModal}
        onConfirm={handleFolderSelected}
        onCancel={handleFolderModalCancel}
        defaultFolder={currentConversation?.projectPath}
      />
      <Sidebar
        ref={sidebarRef}
        conversations={conversations}
        currentConversationId={currentConversation?.id}
        conversationsWithActivity={conversationsWithActivity}
        onSelectConversation={loadConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onForkConversation={handleForkConversation}
      />
      <ChatArea
        conversation={currentConversation}
        onMessageSent={loadConversations}
        onLoadMoreMessages={handleLoadMoreMessages}
        onChatAreaFocus={() => sidebarRef.current?.clearFocus()}
      />
    </div>
  );
}

export default App;
