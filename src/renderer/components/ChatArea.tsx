import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Conversation, ToolExecution, PermissionRequest, PermissionMode } from '../types';
import './ChatArea.css';

interface ChatAreaProps {
  conversation: Conversation | null;
  onMessageSent: () => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({ conversation, onMessageSent }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeTool, setActiveTool] = useState<ToolExecution | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [folderExists, setFolderExists] = useState(true);
  const [mode, setMode] = useState<PermissionMode>('default');
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Store per-conversation state
  const conversationInputsRef = useRef<Map<string, string>>(new Map());
  const conversationAttachmentsRef = useRef<Map<string, string[]>>(new Map());
  const conversationLoadingRef = useRef<Map<string, boolean>>(new Map());
  const conversationStreamingRef = useRef<Map<string, string>>(new Map());
  const conversationToolRef = useRef<Map<string, ToolExecution | null>>(new Map());
  const conversationPermissionsRef = useRef<Map<string, PermissionRequest[]>>(new Map());

  useEffect(() => {
    // Set up streaming token listener
    const removeTokenListener = window.electron.onMessageToken((data: { token: string; conversationId: string }) => {
      // Store the token for the conversation it belongs to
      const currentContent = conversationStreamingRef.current.get(data.conversationId) || '';
      const newContent = currentContent + data.token;
      conversationStreamingRef.current.set(data.conversationId, newContent);

      // Only update UI if this is the currently viewed conversation
      if (conversation?.id === data.conversationId) {
        setStreamingContent(newContent);
        scrollToBottom();
      }
    });

    // Set up tool execution listener
    const removeToolListener = window.electron.onToolExecution((data: ToolExecution & { conversationId: string }) => {
      // Store the tool execution for the conversation it belongs to
      conversationToolRef.current.set(data.conversationId, data);

      // Only update UI if this is the currently viewed conversation
      if (conversation?.id === data.conversationId) {
        setActiveTool(data);
        if (data.status === 'completed') {
          setTimeout(() => {
            conversationToolRef.current.set(data.conversationId, null);
            if (conversation?.id === data.conversationId) {
              setActiveTool(null);
            }
          }, 2000);
        }
      }
    });

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

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      removeTokenListener();
      removeToolListener();
      removePermissionListener();
      removeInterruptListener();
    };
  }, [conversation]);

  useEffect(() => {
    scrollToBottom();
  }, [conversation?.messages, permissionRequests]);

  useEffect(() => {
    // Save current state before switching conversations
    return () => {
      if (conversation?.id) {
        conversationInputsRef.current.set(conversation.id, input);
        conversationAttachmentsRef.current.set(conversation.id, attachedFiles);
        conversationLoadingRef.current.set(conversation.id, isLoading);
        conversationStreamingRef.current.set(conversation.id, streamingContent);
        conversationToolRef.current.set(conversation.id, activeTool);
        conversationPermissionsRef.current.set(conversation.id, permissionRequests);
      }
    };
  }, [conversation?.id, input, attachedFiles, isLoading, streamingContent, activeTool, permissionRequests]);

  useEffect(() => {
    // Restore state for new conversation
    if (conversation?.id) {
      const savedInput = conversationInputsRef.current.get(conversation.id) || '';
      const savedAttachments = conversationAttachmentsRef.current.get(conversation.id) || [];
      const savedLoading = conversationLoadingRef.current.get(conversation.id) || false;
      const savedStreaming = conversationStreamingRef.current.get(conversation.id) || '';
      const savedTool = conversationToolRef.current.get(conversation.id) || null;
      const savedPermissions = conversationPermissionsRef.current.get(conversation.id) || [];

      setInput(savedInput);
      setAttachedFiles(savedAttachments);
      setIsLoading(savedLoading);
      setStreamingContent(savedStreaming);
      setActiveTool(savedTool);
      setPermissionRequests(savedPermissions);
    } else {
      // Clear all state when no conversation
      setInput('');
      setAttachedFiles([]);
      setIsLoading(false);
      setStreamingContent('');
      setActiveTool(null);
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

    // Set loading state for this conversation
    conversationLoadingRef.current.set(conversationId, true);
    conversationStreamingRef.current.set(conversationId, '');
    setIsLoading(true);
    setStreamingContent('');

    // Refresh conversation to show the user's message immediately
    onMessageSent();

    try {
      await window.electron.sendMessage(messageContent, conversationId, messageAttachments);
      // Refresh again after response is complete
      onMessageSent();
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please check your API key.');
    } finally {
      // Clear loading state for this conversation
      conversationLoadingRef.current.set(conversationId, false);
      conversationStreamingRef.current.set(conversationId, '');
      setIsLoading(false);
      setStreamingContent('');
    }
  };

  const handleStop = async () => {
    try {
      await window.electron.interruptMessage();
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

  const handleFileAttach = () => {
    // In a real app, you'd use Electron's dialog to select files
    const filePath = prompt('Enter file path to attach:');
    if (filePath) {
      setAttachedFiles([...attachedFiles, filePath]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles(attachedFiles.filter((_, i) => i !== index));
  };

  const handleModeChange = async (newMode: PermissionMode) => {
    if (!conversation?.id) return;

    try {
      await window.electron.setMode(newMode, conversation.id);
      setMode(newMode);
    } catch (error) {
      console.error('Error changing mode:', error);
    }
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

  const getToolIcon = (toolName: string) => {
    if (toolName.includes('word') || toolName.includes('docx')) return '📄';
    if (toolName.includes('excel') || toolName.includes('xlsx')) return '📊';
    if (toolName.includes('powerpoint') || toolName.includes('pptx')) return '📊';
    return '🔧';
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

  return (
    <div className="chat-area">
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

      <div className="messages-container">
        {conversation?.messages.map((msg, index) => (
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
        ))}

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

        {activeTool && (
          <div className="tool-execution">
            <span className="tool-icon">{getToolIcon(activeTool.tool)}</span>
            <span className="tool-text">
              {activeTool.status === 'running'
                ? `Using ${activeTool.tool}...`
                : `Completed ${activeTool.tool}`}
            </span>
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
          <button className="attach-btn" onClick={handleFileAttach} disabled={isLoading || !folderExists}>
            📎
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={folderExists ? "Type a message... (Shift+Enter for new line)" : "Folder not found - cannot send messages"}
            disabled={!folderExists}
            rows={3}
          />
          {isLoading ? (
            <button
              className="stop-btn"
              onClick={handleStop}
              style={{
                background: '#f5222d',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              ■ Stop
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!folderExists || (!input.trim() && attachedFiles.length === 0)}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatArea;
