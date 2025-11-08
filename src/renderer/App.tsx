import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import FolderSelectionModal from './components/FolderSelectionModal';
import SettingsModal from './components/SettingsModal';
import { Conversation, PermissionMode } from './types';
import './App.css';

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [isElectronReady, setIsElectronReady] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [conversationsWithActivity, setConversationsWithActivity] = useState<Set<string>>(new Set());
  const [activeConversations, setActiveConversations] = useState<Set<string>>(new Set());
  const [showFindBar, setShowFindBar] = useState(false);
  const sidebarRef = useRef<{ handleDeleteFocused: () => void; clearFocus: () => void; focusSearch: () => void } | null>(null);
  const previousActivityRef = useRef<Set<string>>(new Set());
  const lastEventTimestampRef = useRef<number>(0);

  useEffect(() => {
    // Load and apply theme
    const savedTheme = localStorage.getItem('theme');
    const theme = (savedTheme === 'light' || savedTheme === 'dark') ? savedTheme : 'dark';
    document.documentElement.setAttribute('data-theme', theme);

    // Check if electron API is available
    if (window.electron) {
      setIsElectronReady(true);
      loadConversations();

      // Initialize app settings from localStorage
      const savedModel = localStorage.getItem('selectedModel');
      const savedDirs = localStorage.getItem('additionalDirectories');
      const savedPromptMode = localStorage.getItem('systemPromptMode');
      const savedPrompt = localStorage.getItem('customSystemPrompt');

      try {
        const additionalDirectories = savedDirs ? JSON.parse(savedDirs) : [];
        window.electron.updateAppSettings({
          model: savedModel || 'sonnet',
          additionalDirectories,
          systemPromptMode: (savedPromptMode as 'append' | 'custom') || 'append',
          customSystemPrompt: savedPrompt || '',
        }).catch(err => {
          console.error('Failed to initialize app settings:', err);
        });
      } catch (err) {
        console.error('Failed to parse settings:', err);
      }
    } else {
      console.error('Electron API not available');
    }
  }, []);

  // Track active conversations (those currently processing)
  useEffect(() => {
    if (!window.electron) return;

    // Listen for processing started
    const removeProcessingStartedListener = window.electron.onProcessingStarted((data) => {
      lastEventTimestampRef.current = Date.now();
      setActiveConversations(prev => {
        const newSet = new Set(prev);
        newSet.add(data.conversationId);
        return newSet;
      });
    });

    // Listen for processing complete
    const removeProcessingCompleteListener = window.electron.onProcessingComplete((data) => {
      lastEventTimestampRef.current = Date.now();
      setActiveConversations(prev => {
        const newSet = new Set(prev);
        newSet.delete(data.conversationId);
        return newSet;
      });

      // Play beep for all processing completions if enabled
      const audioEnabled = localStorage.getItem('audioNotificationsEnabled');
      if (audioEnabled !== 'false') {
        window.electron.playNotificationSound().catch(error => {
          console.error('Error playing notification sound:', error);
        });
      }

      // If processing completed for a conversation that's not current, mark it as needing attention
      if (currentConversation?.id !== data.conversationId) {
        setConversationsWithActivity(prev => {
          const newSet = new Set(prev);
          newSet.add(data.conversationId);
          return newSet;
        });
      }
    });

    // Listen for permission requests - mark conversation as needing attention
    const removePermissionListener = window.electron.onPermissionRequest((request: any) => {
      // Play beep for all permission requests if enabled
      const audioEnabled = localStorage.getItem('audioNotificationsEnabled');
      if (audioEnabled !== 'false') {
        window.electron.playNotificationSound().catch(error => {
          console.error('Error playing notification sound:', error);
        });
      }

      // If permission request is for a different conversation, mark it as needing attention
      if (currentConversation?.id !== request.conversationId) {
        setConversationsWithActivity(prev => {
          const newSet = new Set(prev);
          newSet.add(request.conversationId);
          return newSet;
        });
      }
    });

    // Listen for permission responses - remove from conversationsWithActivity
    const removePermissionRespondedListener = window.electron.onPermissionResponded((data) => {
      setConversationsWithActivity(prev => {
        const newSet = new Set(prev);
        newSet.delete(data.conversationId);
        return newSet;
      });
    });

    // Poll for active conversations periodically to sync state
    const pollActiveConversations = async () => {
      try {
        // Don't poll if recent event (within 3 seconds) to avoid overriding fresh event data
        const timeSinceLastEvent = Date.now() - lastEventTimestampRef.current;
        if (timeSinceLastEvent < 3000) {
          return; // Skip this poll cycle
        }

        const active = await window.electron.getActiveConversations();
        setActiveConversations(new Set(active));
      } catch (error) {
        console.error('Error polling active conversations:', error);
      }
    };

    // Initial poll
    pollActiveConversations();

    // Poll every 2 seconds
    const pollInterval = setInterval(pollActiveConversations, 2000);

    return () => {
      removeProcessingStartedListener();
      removeProcessingCompleteListener();
      removePermissionListener();
      removePermissionRespondedListener();
      clearInterval(pollInterval);
    };
  }, [currentConversation]);

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

      // Cmd-F / Ctrl-F: Open find bar (don't trigger in input fields)
      if (cmdOrCtrl && e.key === 'f' && !isInInputField) {
        console.log('[Keyboard] Cmd-F triggered');
        e.preventDefault();
        setShowFindBar(true);
      }

      // Cmd-K / Ctrl-K: Focus sidebar search (don't trigger in input fields)
      if (cmdOrCtrl && e.key === 'k' && !isInInputField) {
        console.log('[Keyboard] Cmd-K triggered');
        e.preventDefault();
        sidebarRef.current?.focusSearch();
      }

      // Esc: Close find bar first, then interrupt message
      // Note: Escape in find bar itself will stopPropagation, so this won't run
      if (e.key === 'Escape') {
        console.log('[Keyboard] Escape key detected!');

        // If find bar is open, close it instead of interrupting
        if (showFindBar) {
          console.log('[Keyboard] Closing find bar');
          e.preventDefault();
          setShowFindBar(false);
          return;
        }

        // Otherwise interrupt message
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
  }, [currentConversation, showFindBar]);

  const loadConversations = async () => {
    try {
      const convos = await window.electron.getConversations();

      // conversationsWithActivity is now managed solely by events:
      // - onProcessingComplete: adds when processing finishes (for non-current conversations)
      // - onPermissionRequest: adds when permission needed (for non-current conversations)
      // - onPermissionResponded: removes when user responds to permission
      // - loadConversation: removes when user clicks on conversation
      // No timestamp-based detection needed - events provide accurate state

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

  const handleFolderSelected = async (folderPath: string, mode?: string) => {
    try {
      const result = await window.electron.newConversationWithFolder(folderPath, mode);
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
        <h2>Loading Claude Agent Desktop...</h2>
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
        currentConversationId={showSettings ? undefined : currentConversation?.id}
        conversationsWithActivity={conversationsWithActivity}
        activeConversations={activeConversations}
        onSelectConversation={(id) => {
          setShowSettings(false);
          loadConversation(id);
        }}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onForkConversation={handleForkConversation}
        onShowSettings={() => setShowSettings(true)}
        onTitleUpdated={loadConversations}
      />
      <ChatArea
        conversation={currentConversation}
        onMessageSent={loadConversations}
        onLoadMoreMessages={handleLoadMoreMessages}
        onChatAreaFocus={() => sidebarRef.current?.clearFocus()}
        showFindBar={showFindBar}
        onCloseFindBar={() => setShowFindBar(false)}
        onConversationTitleUpdated={loadConversations}
      />
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

export default App;
