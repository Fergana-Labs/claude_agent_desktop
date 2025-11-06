import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import FolderSelectionModal from './components/FolderSelectionModal';
import { Conversation } from './types';
import './App.css';

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [isElectronReady, setIsElectronReady] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [conversationsWithActivity, setConversationsWithActivity] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Check if electron API is available
    if (window.electron) {
      setIsElectronReady(true);
      loadConversations();
    } else {
      console.error('Electron API not available');
    }
  }, []);

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
      await window.electron.newConversationWithFolder(folderPath);
      setShowFolderModal(false);
      await loadConversations();
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
        conversations={conversations}
        currentConversationId={currentConversation?.id}
        conversationsWithActivity={conversationsWithActivity}
        onSelectConversation={loadConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
      />
      <ChatArea
        conversation={currentConversation}
        onMessageSent={loadConversations}
        onLoadMoreMessages={handleLoadMoreMessages}
      />
    </div>
  );
}

export default App;
