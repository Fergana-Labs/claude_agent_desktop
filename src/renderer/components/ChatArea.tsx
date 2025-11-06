import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Conversation, ToolExecution, PermissionRequest, PermissionMode } from '../types';
import { ToolUseMessage } from './ToolUseMessage';
import { ToolResultMessage } from './ToolResultMessage';
import { ThinkingMessage } from './ThinkingMessage';
import { ErrorMessage } from './ErrorMessage';
import './ChatArea.css';

interface ChatAreaProps {
  conversation: Conversation | null;
  onMessageSent: () => void;
  onLoadMoreMessages?: (conversationId: string, offset: number) => Promise<void>;
  onChatAreaFocus?: () => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({ conversation, onMessageSent, onLoadMoreMessages, onChatAreaFocus }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [folderExists, setFolderExists] = useState(true);
  const [mode, setMode] = useState<PermissionMode>('default');
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showAutoAcceptWarning, setShowAutoAcceptWarning] = useState(false);
  const [dontShowAgainChecked, setDontShowAgainChecked] = useState(false);
  const [pendingMode, setPendingMode] = useState<PermissionMode | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const dragCounterRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamingUpdateScheduledRef = useRef(false);

  // Store per-conversation state
  const conversationInputsRef = useRef<Map<string, string>>(new Map());
  const conversationAttachmentsRef = useRef<Map<string, string[]>>(new Map());
  const conversationLoadingRef = useRef<Map<string, boolean>>(new Map());
  const conversationStreamingRef = useRef<Map<string, string>>(new Map());
  const conversationPermissionsRef = useRef<Map<string, PermissionRequest[]>>(new Map());

  useEffect(() => {
    // Set up streaming token listener with throttling to reduce "twitchy" behavior
    const removeTokenListener = window.electron.onMessageToken((data: { token: string; conversationId: string }) => {
      // Store the token for the conversation it belongs to
      const currentContent = conversationStreamingRef.current.get(data.conversationId) || '';
      const newContent = currentContent + data.token;
      conversationStreamingRef.current.set(data.conversationId, newContent);

      // Only update UI if this is the currently viewed conversation
      // Use requestAnimationFrame to throttle updates to ~60fps max
      if (conversation?.id === data.conversationId && !streamingUpdateScheduledRef.current) {
        streamingUpdateScheduledRef.current = true;
        requestAnimationFrame(() => {
          streamingUpdateScheduledRef.current = false;
          // Get the latest content from the ref (may have more tokens than when scheduled)
          const latestContent = conversationStreamingRef.current.get(data.conversationId) || '';
          setStreamingContent(latestContent);
          scrollToBottom();
        });
      }
    });

    // Tool execution events are now saved as messages in the database
    // No need for temporary tool indicators

    // Set up permission request listener
    const removePermissionListener = window.electron.onPermissionRequest((request: PermissionRequest & { conversationId: string }) => {
      // Store the permission request for the conversation it belongs to
      const currentRequests = conversationPermissionsRef.current.get(request.conversationId) || [];
      const newRequests = [...currentRequests, request];
      conversationPermissionsRef.current.set(request.conversationId, newRequests);

      // Only update UI if this is the currently viewed conversation
      if (conversation?.id === request.conversationId) {
        setPermissionRequests(newRequests);
      }

      // Show browser notification with sound
      if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification('Permission Request', {
          body: `${request.tool}: ${request.action}`,
          icon: '/logo-icon.png',
          requireInteraction: true,
        });

        // Play sound
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBi1+z/LTgjMGHm7A7+OZSA0PVqnm77BdGAU+lt3ywHMnBSl6zPDijz8KFF+47OelUxIKQ5zi8r1nIgU='
);
        audio.play().catch(() => {});
      }
    });

    // Set up interruption listener
    const removeInterruptListener = window.electron.onMessageInterrupted((data: { conversationId: string }) => {
      // Clear loading state for the conversation that was interrupted
      conversationLoadingRef.current.set(data.conversationId, false);
      conversationStreamingRef.current.set(data.conversationId, '');

      // Only update UI if this is the currently viewed conversation
      if (conversation?.id === data.conversationId) {
        setIsLoading(false);
        setStreamingContent('');
      }
    });

    // Set up user message saved listener (triggers immediate conversation refresh and sidebar reorder)
    const removeUserMessageSavedListener = window.electron.onUserMessageSaved((data: { conversationId: string }) => {
      // Refresh conversation list to show the user's message and update sidebar sort order
      onMessageSent();
    });

    // Set up assistant message saved listener (triggers conversation list refresh for activity badges)
    const removeAssistantMessageSavedListener = window.electron.onAssistantMessageSaved((data: { conversationId: string }) => {
      // Refresh conversation list to update activity badges, but don't auto-switch to the conversation
      onMessageSent();
    });

    // Set up processing started listener
    const removeProcessingStartedListener = window.electron.onProcessingStarted((data: { conversationId: string }) => {
      // Set loading state for the conversation that started processing
      conversationLoadingRef.current.set(data.conversationId, true);

      // Only update UI if this is the currently viewed conversation
      if (conversation?.id === data.conversationId) {
        setIsLoading(true);
      }
    });

    // Set up processing complete listener
    const removeProcessingCompleteListener = window.electron.onProcessingComplete((data: { conversationId: string; interrupted: boolean; remainingMessages: number }) => {
      // Clear loading state for the conversation that completed processing
      conversationLoadingRef.current.set(data.conversationId, false);

      // Only update UI if this is the currently viewed conversation
      if (conversation?.id === data.conversationId) {
        setIsLoading(false);
        // Don't clear streaming content yet - wait for the saved message to load
        // The content will be cleared when conversation reloads with the new message
      }
    });

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      removeTokenListener();
      removePermissionListener();
      removeInterruptListener();
      removeUserMessageSavedListener();
      removeAssistantMessageSavedListener();
      removeProcessingStartedListener();
      removeProcessingCompleteListener();
    };
  }, [conversation]);

  useEffect(() => {
    // Save current state before switching conversations
    return () => {
      if (conversation?.id) {
        conversationInputsRef.current.set(conversation.id, input);
        conversationAttachmentsRef.current.set(conversation.id, attachedFiles);
        conversationLoadingRef.current.set(conversation.id, isLoading);
        conversationStreamingRef.current.set(conversation.id, streamingContent);
        conversationPermissionsRef.current.set(conversation.id, permissionRequests);
      }
    };
  }, [conversation?.id, input, attachedFiles, isLoading, streamingContent, permissionRequests]);

  useEffect(() => {
    // Restore state for new conversation
    if (conversation?.id) {
      const savedInput = conversationInputsRef.current.get(conversation.id) || '';
      const savedAttachments = conversationAttachmentsRef.current.get(conversation.id) || [];
      const savedLoading = conversationLoadingRef.current.get(conversation.id) || false;
      const savedStreaming = conversationStreamingRef.current.get(conversation.id) || '';
      const savedPermissions = conversationPermissionsRef.current.get(conversation.id) || [];

      setInput(savedInput);
      setAttachedFiles(savedAttachments);
      setIsLoading(savedLoading);
      setStreamingContent(savedStreaming);
      setPermissionRequests(savedPermissions);
    } else {
      // Clear all state when no conversation
      setInput('');
      setAttachedFiles([]);
      setIsLoading(false);
      setStreamingContent('');
      setPermissionRequests([]);
    }
  }, [conversation?.id]);

  useEffect(() => {
    // Check if conversation's folder exists
    const checkFolder = async () => {
      if (conversation?.projectPath) {
        const result = await window.electron.checkFolderExists(conversation.projectPath);
        setFolderExists(result.exists);
      } else {
        // No project path means it's a conversation without file access - that's okay
        setFolderExists(true);
      }
    };

    checkFolder();
  }, [conversation]);

  useEffect(() => {
    // Load mode when conversation changes
    const loadMode = async () => {
      if (conversation?.id) {
        try {
          const result = await window.electron.getMode(conversation.id);
          setMode(result.mode as PermissionMode);
        } catch (error) {
          console.error('Error loading mode:', error);
          setMode('default');
        }
      } else {
        setMode('default');
      }
    };

    loadMode();
  }, [conversation]);

  // Clear streaming content when new messages arrive (saved messages loaded from DB)
  useEffect(() => {
    if (conversation?.id && conversation.messages.length > 0) {
      // If we have messages loaded and streaming content exists, clear it
      // This ensures saved messages from DB replace the streaming content
      const hasStreamingContent = conversationStreamingRef.current.get(conversation.id);
      if (hasStreamingContent && !isLoading) {
        conversationStreamingRef.current.set(conversation.id, '');
        setStreamingContent('');
      }
    }
  }, [conversation?.messages.length, conversation?.id, isLoading]);

  // Instantly scroll to bottom when conversation changes (no animation)
  useEffect(() => {
    if (conversation?.id) {
      scrollToBottom('auto');
      // Check if there are more messages to load
      const totalMessages = conversation.totalMessageCount || 0;
      const loadedMessages = conversation.messages.length;
      setHasMoreMessages(loadedMessages < totalMessages);

      // Auto-focus the textarea when conversation changes
      // Use a small delay to ensure the component is fully rendered
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [conversation?.id, conversation?.messages.length, conversation?.totalMessageCount]);

  // Scroll event listener for loading older messages
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = async () => {
      const { scrollTop, scrollHeight, clientHeight } = container;

      // Load more when scrolled near the top (within 100px)
      if (scrollTop < 100 && hasMoreMessages && !isLoadingMore && conversation?.id && onLoadMoreMessages) {
        setIsLoadingMore(true);
        previousScrollHeightRef.current = scrollHeight;

        try {
          // Calculate offset based on current loaded messages
          const offset = conversation.messages.length;

          // Request parent to load more messages
          await onLoadMoreMessages(conversation.id, offset);

        } catch (error) {
          console.error('Error loading more messages:', error);
        } finally {
          setIsLoadingMore(false);

          // Restore scroll position after new messages are added
          requestAnimationFrame(() => {
            if (container) {
              const newScrollHeight = container.scrollHeight;
              const scrollDiff = newScrollHeight - previousScrollHeightRef.current;
              container.scrollTop = scrollTop + scrollDiff;
            }
          });
        }
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [conversation, hasMoreMessages, isLoadingMore]);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const handleSend = async () => {
    if (!input.trim() && attachedFiles.length === 0) return;
    if (!conversation?.id) return;

    // Store the message content before clearing
    const messageContent = input;
    const messageAttachments = [...attachedFiles];
    const conversationId = conversation.id;

    // Clear input immediately
    setInput('');
    setAttachedFiles([]);

    // Clear saved input for this conversation since we're sending it
    conversationInputsRef.current.delete(conversationId);
    conversationAttachmentsRef.current.delete(conversationId);

    // Set loading state for this conversation (only if not already loading)
    const alreadyLoading = conversationLoadingRef.current.get(conversationId);
    if (!alreadyLoading) {
      conversationLoadingRef.current.set(conversationId, true);
      conversationStreamingRef.current.set(conversationId, '');
      setIsLoading(true);
      setStreamingContent('');
    }

    try {
      await window.electron.sendMessage(messageContent, conversationId, messageAttachments);
      // Note: We don't refresh conversations here because:
      // 1. The user-message-saved event already triggers a refresh
      // 2. We don't want to auto-switch back to this chat if the user switched away
      // 3. Loading state is now managed by backend processing-started/processing-complete events
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please check your API key.');
      // Clear loading state only on error (processing never started)
      conversationLoadingRef.current.set(conversationId, false);
      conversationStreamingRef.current.set(conversationId, '');
      setIsLoading(false);
      setStreamingContent('');
    }
  };

  const handleStop = async () => {
    try {
      const result = await window.electron.interruptMessage(conversation?.id);
      if (!result.success) {
        console.error('Error stopping message:', result.error);
      }
      if (conversation?.id) {
        conversationLoadingRef.current.set(conversation.id, false);
        conversationStreamingRef.current.set(conversation.id, '');
      }
      setIsLoading(false);
      setStreamingContent('');
    } catch (error) {
      console.error('Error stopping message:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileAttach = async () => {
    try {
      const result = await window.electron.selectFiles();
      if (result.success && result.paths.length > 0) {
        setAttachedFiles([...attachedFiles, ...result.paths]);
      }
    } catch (error) {
      console.error('Error selecting files:', error);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles(attachedFiles.filter((_, i) => i !== index));
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const filePaths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // In Electron, we can access the file path
        const path = (file as any).path;
        if (path) {
          filePaths.push(path);
        }
      }
      if (filePaths.length > 0) {
        setAttachedFiles([...attachedFiles, ...filePaths]);
      }
    }
  };

  const handleModeChange = async (newMode: PermissionMode) => {
    if (!conversation?.id) return;

    // Check if switching to Auto-Accept All (bypassPermissions)
    if (newMode === 'bypassPermissions') {
      // Check localStorage for "don't show again" preference
      const hideWarning = localStorage.getItem('hideAutoAcceptWarning') === 'true';

      if (!hideWarning) {
        // Show warning modal
        setPendingMode(newMode);
        setShowAutoAcceptWarning(true);
        return; // Don't change mode yet, wait for user confirmation
      }
    }

    // Proceed with mode change
    try {
      await window.electron.setMode(newMode, conversation.id);
      setMode(newMode);
    } catch (error) {
      console.error('Error changing mode:', error);
    }
  };

  const handleConfirmAutoAccept = async () => {
    // Save "don't show again" preference if checked
    if (dontShowAgainChecked) {
      localStorage.setItem('hideAutoAcceptWarning', 'true');
    }

    // Change to Auto-Accept All mode
    if (pendingMode && conversation?.id) {
      try {
        await window.electron.setMode(pendingMode, conversation.id);
        setMode(pendingMode);
      } catch (error) {
        console.error('Error changing mode:', error);
      }
    }

    // Close modal and reset state
    setShowAutoAcceptWarning(false);
    setPendingMode(null);
    setDontShowAgainChecked(false);
  };

  const handleCancelAutoAccept = () => {
    // Close modal without changing mode
    setShowAutoAcceptWarning(false);
    setPendingMode(null);
    setDontShowAgainChecked(false);
  };

  const handleApprovePermission = async (permissionId: string) => {
    try {
      await window.electron.approvePermission(permissionId);
      const newRequests = permissionRequests.filter(p => p.id !== permissionId);
      setPermissionRequests(newRequests);
      if (conversation?.id) {
        conversationPermissionsRef.current.set(conversation.id, newRequests);
      }
    } catch (error) {
      console.error('Error approving permission:', error);
    }
  };

  const handleDenyPermission = async (permissionId: string) => {
    try {
      await window.electron.denyPermission(permissionId);
      const newRequests = permissionRequests.filter(p => p.id !== permissionId);
      setPermissionRequests(newRequests);
      if (conversation?.id) {
        conversationPermissionsRef.current.set(conversation.id, newRequests);
      }
    } catch (error) {
      console.error('Error denying permission:', error);
    }
  };

  const getModeLabel = (mode: PermissionMode) => {
    switch (mode) {
      case 'default': return 'Ask';
      case 'acceptEdits': return 'Accept Edits';
      case 'bypassPermissions': return 'Auto-Accept';
      case 'plan': return 'Plan';
      default: return mode;
    }
  };

  const getModeColor = (mode: PermissionMode) => {
    switch (mode) {
      case 'default': return '#4a9eff';
      case 'acceptEdits': return '#52c41a';
      case 'bypassPermissions': return '#f5222d';
      case 'plan': return '#faad14';
      default: return '#888';
    }
  };

  // Show empty state when no conversation is selected
  if (!conversation) {
    return (
      <div className="chat-area" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%'
      }}>
        <div style={{
          textAlign: 'center',
          color: '#888',
          maxWidth: '400px',
          padding: '40px'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>💬</div>
          <h2 style={{ color: '#ddd', marginBottom: '12px' }}>No Conversations Yet</h2>
          <p style={{ fontSize: '14px', lineHeight: '1.6' }}>
            Click the "New Chat" button in the sidebar to start a conversation with Claude.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="chat-area"
      onClick={() => onChatAreaFocus?.()}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(74, 158, 255, 0.1)',
          border: '2px dashed #4a9eff',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }}>
          <div style={{
            background: 'rgba(0, 0, 0, 0.8)',
            padding: '20px 40px',
            borderRadius: '8px',
            color: '#4a9eff',
            fontSize: '18px',
            fontWeight: 'bold'
          }}>
            Drop files here to attach
          </div>
        </div>
      )}
      {/* Mode Selector Bar */}
      <div style={{
        background: '#2a2a2a',
        padding: '8px 16px',
        borderBottom: '1px solid #444',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <span style={{ color: '#888', fontSize: '13px' }}>Mode:</span>
        <select
          value={mode}
          onChange={(e) => handleModeChange(e.target.value as PermissionMode)}
          disabled={!folderExists}
          style={{
            background: '#1e1e1e',
            border: `1px solid ${getModeColor(mode)}`,
            color: getModeColor(mode),
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '13px',
            cursor: folderExists ? 'pointer' : 'not-allowed',
          }}
        >
          <option value="default">Ask for Permissions</option>
          <option value="acceptEdits">Accept Edits Only</option>
          <option value="bypassPermissions">Auto-Accept All</option>
          <option value="plan">Plan Mode</option>
        </select>
        <div style={{
          background: getModeColor(mode),
          color: '#fff',
          padding: '2px 8px',
          borderRadius: '10px',
          fontSize: '11px',
          fontWeight: 'bold'
        }}>
          {getModeLabel(mode)}
        </div>
      </div>

      {!folderExists && conversation?.projectPath && (
        <div style={{
          background: '#3a2020',
          border: '1px solid #d44',
          borderRadius: '4px',
          padding: '12px',
          margin: '10px',
          color: '#faa'
        }}>
          ⚠️ This conversation's folder cannot be found: <strong>{conversation.projectPath}</strong>
          <br />
          You can view past messages but cannot send new ones.
        </div>
      )}

      <div className="messages-container" ref={messagesContainerRef}>
        {isLoadingMore && (
          <div style={{ textAlign: 'center', padding: '10px', color: '#858585' }}>
            Loading older messages...
          </div>
        )}
        {conversation?.messages.map((msg, index) => {
          const messageType = msg.messageType || msg.role;

          // Render different components based on message type
          switch (messageType) {
            case 'tool_use':
              return <ToolUseMessage key={index} message={msg} />;

            case 'tool_result':
              return <ToolResultMessage key={index} message={msg} />;

            case 'thinking':
              return <ThinkingMessage key={index} message={msg} />;

            case 'error':
              return <ErrorMessage key={index} message={msg} />;

            case 'user':
            case 'assistant':
            default:
              // Regular user/assistant messages
              return (
                <div key={index} className={`message ${msg.role}`}>
                  <div className="message-role">{msg.role === 'user' ? 'You' : 'Claude'}</div>
                  <div className="message-content">
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="message-attachments">
                        {msg.attachments.map((file, i) => (
                          <div key={i} className="attachment-badge">
                            📎 {file.split('/').pop()}
                          </div>
                        ))}
                      </div>
                    )}
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              );
          }
        })}

        {streamingContent && (
          <div className="message assistant streaming">
            <div className="message-role">Claude</div>
            <div className="message-content">
              <ReactMarkdown>{streamingContent}</ReactMarkdown>
              <span className="cursor">▊</span>
            </div>
          </div>
        )}

        {/* Permission Requests */}
        {permissionRequests.map(request => (
          <div key={request.id} style={{
            background: '#2a2a2a',
            border: '2px solid #faad14',
            borderRadius: '8px',
            padding: '16px',
            margin: '10px 0',
            animation: 'pulse 2s infinite'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '24px' }}>⚠️</span>
              <strong style={{ color: '#faad14', fontSize: '16px' }}>Permission Required</strong>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: '#ddd', marginBottom: '4px' }}>
                <strong>{request.tool}</strong> wants to: {request.action}
              </div>
              {request.details && (
                <div style={{ color: '#888', fontSize: '13px', fontFamily: 'monospace' }}>
                  {request.details}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleApprovePermission(request.id)}
                style={{
                  background: '#52c41a',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                ✓ Approve
              </button>
              <button
                onClick={() => handleDenyPermission(request.id)}
                style={{
                  background: '#f5222d',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                ✗ Deny
              </button>
            </div>
          </div>
        ))}

        {/* Auto-Accept All Warning Modal */}
        {showAutoAcceptWarning && (
          <div style={{
            background: '#2a2a2a',
            border: '2px solid #f5222d',
            borderRadius: '8px',
            padding: '16px',
            margin: '10px 0',
            animation: 'pulse 2s infinite'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '24px' }}>⚠️</span>
              <strong style={{ color: '#f5222d', fontSize: '16px' }}>Warning: Auto-Accept All Mode</strong>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ color: '#ddd', marginBottom: '8px' }}>
                You are about to enable <strong>Auto-Accept All</strong> mode, which will:
              </div>
              <ul style={{ color: '#ddd', marginLeft: '20px', marginBottom: '8px' }}>
                <li>Automatically approve ALL tool executions without asking</li>
                <li>Allow Claude to read, write, and delete files</li>
                <li>Allow Claude to run arbitrary commands</li>
                <li>Potentially cause data loss or system changes</li>
              </ul>
              <div style={{ color: '#f5222d', fontSize: '13px', fontWeight: 'bold' }}>
                Only use this mode if you fully trust the current conversation context.
              </div>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ddd', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={dontShowAgainChecked}
                  onChange={(e) => setDontShowAgainChecked(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                Don't show this warning again
              </label>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleCancelAutoAccept}
                style={{
                  background: '#3e3e42',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAutoAccept}
                style={{
                  background: '#f5222d',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Enable Auto-Accept All
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        {attachedFiles.length > 0 && (
          <div className="attachments-preview">
            {attachedFiles.map((file, index) => (
              <div key={index} className="attachment-preview">
                <span>📎 {file.split('/').pop()}</span>
                <button onClick={() => removeAttachment(index)}>×</button>
              </div>
            ))}
          </div>
        )}

        <div className="input-controls">
          <button className="attach-btn" onClick={handleFileAttach} disabled={!folderExists}>
            📎
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => onChatAreaFocus?.()}
            placeholder={folderExists ? "Type a message... (Shift+Enter for new line)" : "Folder not found - cannot send messages"}
            disabled={!folderExists}
            rows={3}
          />
          <div className="button-stack">
            {isLoading && (
              <button
                className="stop-btn"
                onClick={handleStop}
              >
                ■ Stop
              </button>
            )}
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!folderExists || (!input.trim() && attachedFiles.length === 0)}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatArea;
