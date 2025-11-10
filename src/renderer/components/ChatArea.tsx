import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Conversation, ToolExecution, PermissionRequest, PlanApprovalRequest, PermissionMode } from '../types';
import { ToolUseMessage } from './ToolUseMessage';
import { ToolResultMessage } from './ToolResultMessage';
import { ThinkingMessage } from './ThinkingMessage';
import { ErrorMessage } from './ErrorMessage';
import { Send, Square, Paperclip } from 'lucide-react';
import { Tooltip } from './Tooltip';
import './ChatArea.css';

interface ChatAreaProps {
  conversation: Conversation | null;
  onMessageSent: () => void;
  onLoadMoreMessages?: (conversationId: string, offset: number) => Promise<void>;
  onChatAreaFocus?: () => void;
  showFindBar?: boolean;
  onCloseFindBar?: () => void;
  onConversationTitleUpdated?: () => void;
  onOpenSettings?: () => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({ conversation, onMessageSent, onLoadMoreMessages, onChatAreaFocus, showFindBar, onCloseFindBar, onConversationTitleUpdated, onOpenSettings }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [folderExists, setFolderExists] = useState(true);
  const [mode, setMode] = useState<PermissionMode>('default');
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);
  const [currentPermissionIndex, setCurrentPermissionIndex] = useState(0);
  const [planApprovalRequests, setPlanApprovalRequests] = useState<PlanApprovalRequest[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showAutoAcceptWarning, setShowAutoAcceptWarning] = useState(false);
  const [dontShowAgainChecked, setDontShowAgainChecked] = useState(false);
  const [pendingMode, setPendingMode] = useState<PermissionMode | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState<{ element: HTMLElement; index: number }[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [sendError, setSendError] = useState<{ message: string; details: string } | null>(null);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const dragCounterRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamingUpdateScheduledRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Store per-conversation state
  const conversationInputsRef = useRef<Map<string, string>>(new Map());
  const conversationAttachmentsRef = useRef<Map<string, string[]>>(new Map());
  const conversationLoadingRef = useRef<Map<string, boolean>>(new Map());
  const conversationStreamingRef = useRef<Map<string, string>>(new Map());
  const conversationPermissionsRef = useRef<Map<string, PermissionRequest[]>>(new Map());
  const conversationPlanApprovalsRef = useRef<Map<string, PlanApprovalRequest[]>>(new Map());
  const conversationStreamingStartRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // Set up streaming token listener with throttling to reduce "twitchy" behavior
    const removeTokenListener = window.electron.onMessageToken((data: { token: string; conversationId: string; startedAt?: number }) => {
      // Only process tokens for the current conversation
      if (conversation?.id !== data.conversationId) {
        return;
      }

      // Backend now sends the FULL accumulated text, not just deltas
      // So we can set it directly instead of appending
      conversationStreamingRef.current.set(data.conversationId, data.token);

      // If a per-reply startedAt is provided, re-anchor the streaming block
      if (typeof data.startedAt === 'number') {
        conversationStreamingStartRef.current.set(data.conversationId, data.startedAt);
      }

      // Use requestAnimationFrame to throttle updates to ~60fps max
      if (!streamingUpdateScheduledRef.current) {
        streamingUpdateScheduledRef.current = true;
        requestAnimationFrame(() => {
          streamingUpdateScheduledRef.current = false;
          const currentConversationId = conversation?.id;
          if (!currentConversationId) return;
          
          const latestContent = conversationStreamingRef.current.get(currentConversationId) || '';
          
          // Only update if we have content and conversation hasn't changed
          if (latestContent) {
            setStreamingContent(latestContent);
            scrollToBottom();
          }
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
        console.log('henry we are about to set a new permission request so we can display it')
        setPermissionRequests(newRequests);
      }

      // Show browser notification (silent - sound is played via shell.beep in App.tsx)
      if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification('Permission Request', {
          body: `${request.tool}: ${request.action}`,
          icon: '/logo-icon.png',
          requireInteraction: true,
          silent: true,
        });
        // Audio playback removed - sound is played via shell.beep in App.tsx
      }
    });

    // Set up plan approval request listener
    const removePlanApprovalListener = window.electron.onPlanApprovalRequest((request: PlanApprovalRequest & { conversationId: string }) => {
      // Store the plan approval request for the conversation it belongs to
      const currentRequests = conversationPlanApprovalsRef.current.get(request.conversationId) || [];
      const newRequests = [...currentRequests, request];
      conversationPlanApprovalsRef.current.set(request.conversationId, newRequests);

      // Only update UI if this is the currently viewed conversation
      if (conversation?.id === request.conversationId) {
        console.log('[ChatArea] Plan approval request received:', request);
        setPlanApprovalRequests(newRequests);
      }

      // Show browser notification with sound
      if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification('Plan Approval Required', {
          body: 'Claude has created a plan and needs your approval to proceed',
          icon: '/logo-icon.png',
          requireInteraction: true,
        });

        // Play sound
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBi1+z/LTgjMGHm7A7+OZSA0PVqnm77BdGAU+lt3ywHMnBSl6zPDijz8KFF+47OelUxIKQ5zi8r1nIgU=');
        audio.play().catch(() => {});
      }
    });

    // Set up interruption listener
    const removeInterruptListener = window.electron.onMessageInterrupted((data: { conversationId: string }) => {
      // The actual cleanup is handled by onProcessingComplete
      // This event just signals that interruption was requested
    });

    // Set up clear permissions listener
    const removeClearPermissionsListener = window.electron.onClearPermissions((data: { conversationId: string }) => {
      // Clear permission requests for the conversation that was interrupted
      if (conversation?.id === data.conversationId) {
        console.log('[ChatArea] Clearing permission requests due to interrupt');
        setPermissionRequests([]);
        setCurrentPermissionIndex(0);
        setPlanApprovalRequests([]);
        // Also clear from conversation ref
        conversationPermissionsRef.current.set(data.conversationId, []);
        conversationPlanApprovalsRef.current.set(data.conversationId, []);
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
    const removeProcessingStartedListener = window.electron.onProcessingStarted((data: { conversationId: string; startedAt?: number }) => {
      // Set loading state for the conversation that started processing
      conversationLoadingRef.current.set(data.conversationId, true);
      
      // Clear streaming content ref when starting new stream to prevent mixing old/new content
      if (conversation?.id === data.conversationId) {
        conversationStreamingRef.current.set(data.conversationId, '');
        setStreamingContent('');
      }

      // Record the start timestamp for inline placement
      conversationStreamingStartRef.current.set(data.conversationId, data.startedAt ?? Date.now());

      // Only update UI if this is the currently viewed conversation
      if (conversation?.id === data.conversationId) {
        setIsLoading(true);
      }
    });

    // Set up processing complete listener
    const removeProcessingCompleteListener = window.electron.onProcessingComplete((data: { conversationId: string; interrupted: boolean; remainingMessages: number }) => {
      // Clear loading state for the conversation that completed processing
      conversationLoadingRef.current.set(data.conversationId, false);
      // Clear streaming start anchor for this conversation
      conversationStreamingStartRef.current.delete(data.conversationId);

      // Only update UI if this is the currently viewed conversation
      if (conversation?.id === data.conversationId) {
        setIsLoading(false);

        // Don't clear streaming content yet - let it "crystallize" into the saved message
        // The streaming content will be cleared when the conversation reloads with the new message

        // If interrupted, trigger reload to show the saved partial message
        if (data.interrupted) {
          // Trigger reload by calling onMessageSent
          onMessageSent();
        }
        // For normal completion, the saved message will appear when assistant-message-saved triggers reload
      }
    });

    // Set up mode change listener
    const removeModeChangedListener = window.electron.onModeChanged((data: { conversationId: string; mode: string }) => {
      // Only update mode if this is the currently viewed conversation
      if (conversation?.id === data.conversationId) {
        console.log('[ChatArea] Mode changed to:', data.mode);
        setMode(data.mode as PermissionMode);
      }
    });

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      removeTokenListener();
      removePermissionListener();
      removePlanApprovalListener();
      removeInterruptListener();
      removeClearPermissionsListener();
      removeUserMessageSavedListener();
      removeAssistantMessageSavedListener();
      removeProcessingStartedListener();
      removeProcessingCompleteListener();
      removeModeChangedListener();
    };
  }, [conversation]);

  // Rotate loading messages every 3 seconds
  useEffect(() => {
    const loadingMessages = ["Thinking...", "One moment...", "Working on it...", "Processing..."];

    // Only rotate when loading and no streaming content yet
    if (isLoading && !streamingContent) {
      const interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % loadingMessages.length);
      }, 3000);

      return () => clearInterval(interval);
    } else {
      // Reset to first message when not loading
      setLoadingMessageIndex(0);
    }
  }, [isLoading, streamingContent]);

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
      const savedPlanApprovals = conversationPlanApprovalsRef.current.get(conversation.id) || [];

      setInput(savedInput);
      setAttachedFiles(savedAttachments);
      setIsLoading(savedLoading);
      setStreamingContent(savedStreaming);
      setPermissionRequests(savedPermissions);
      setCurrentPermissionIndex(0); // Reset to first permission when switching conversations
      setPlanApprovalRequests(savedPlanApprovals);
    } else {
      // Clear all state when no conversation
      setInput('');
      setAttachedFiles([]);
      setIsLoading(false);
      setStreamingContent('');
      setPermissionRequests([]);
      setCurrentPermissionIndex(0);
      setPlanApprovalRequests([]);
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

  // Autoscroll when permission requests or plan approvals appear
  useEffect(() => {
    if (permissionRequests.length > 0 || planApprovalRequests.length > 0) {
      // Use requestAnimationFrame to ensure DOM has updated after state change
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [permissionRequests.length, planApprovalRequests.length]);

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

    // Check if API key is set before sending
    try {
      const apiKeyStatus = await window.electron.getApiKeyStatus();
      if (!apiKeyStatus.hasApiKey) {
        setSendError({
          message: 'API Key Required',
          details: 'Please set your Anthropic API key in Settings before sending messages.'
        });

        // Open settings modal if callback is provided
        if (onOpenSettings) {
          onOpenSettings();
        }

        return;
      }
    } catch (error) {
      console.error('Failed to check API key status:', error);
      setSendError({
        message: 'Configuration Error',
        details: 'Unable to verify API key status. Please check your settings.'
      });
      return;
    }

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
      // Clear any previous errors when sending a new message
      setSendError(null);

      await window.electron.sendMessage(messageContent, conversationId, messageAttachments);
      // Note: We don't refresh conversations here because:
      // 1. The user-message-saved event already triggers a refresh
      // 2. We don't want to auto-switch back to this chat if the user switched away
      // 3. Loading state is now managed by backend processing-started/processing-complete events
    } catch (error: any) {
      console.error('Error sending message:', error);

      // Check if this is an interruption error (user pressed ESC)
      const isInterruption = error?.name === 'AbortError' ||
                            error?.message?.includes('AbortError') ||
                            error?.message?.includes('interrupt');

      // Only show error for real errors, not interruptions
      if (!isInterruption) {
        // Set error state to display in chat
        setSendError({
          message: 'Failed to send message',
          details: error?.message || 'An unexpected error occurred. Please check your configuration and try again.'
        });

        // Clear loading state and content only for real errors (processing never started)
        conversationLoadingRef.current.set(conversationId, false);
        conversationStreamingRef.current.set(conversationId, '');
        setIsLoading(false);
        setStreamingContent('');
      }
      // For interruptions, don't clear streaming content - it will be saved and reloaded
    }
  };

  const handleStop = async () => {
    try {
      const result = await window.electron.interruptMessage(conversation?.id);
      if (!result.success) {
        console.error('Error stopping message:', result.error);
      }
      // Don't clear streaming content here - let the onProcessingComplete handler manage state
      // This allows the content to "crystallize" into the saved message
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

  // Title editing handlers
  const handleTitleClick = () => {
    if (conversation) {
      setEditedTitle(conversation.title);
      setIsEditingTitle(true);
      setTimeout(() => titleInputRef.current?.select(), 0);
    }
  };

  const handleTitleSave = async () => {
    if (!conversation || !editedTitle.trim()) {
      setIsEditingTitle(false);
      return;
    }

    try {
      await window.electron.updateConversationTitle(conversation.id, editedTitle.trim());
      setIsEditingTitle(false);
      onConversationTitleUpdated?.();
    } catch (error) {
      console.error('Error updating title:', error);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsEditingTitle(false);
    }
  };

  // Find functionality handlers
  const performFind = (query: string) => {
    if (!messagesContainerRef.current || !query) {
      setFindMatches([]);
      setCurrentMatchIndex(0);
      // Clear existing highlights
      const highlighted = messagesContainerRef.current?.querySelectorAll('.find-match, .find-match-current');
      highlighted?.forEach(el => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(el.textContent || ''), el);
          parent.normalize();
        }
      });
      return;
    }

    // Search through all message content
    const matches: { element: HTMLElement; index: number }[] = [];
    const messages = messagesContainerRef.current.querySelectorAll('.message-content, .thinking-content, .tool-summary, .tool-input, .output-content, .error-content');

    messages.forEach((messageEl, msgIndex) => {
      const textContent = messageEl.textContent || '';
      const lowerQuery = query.toLowerCase();
      const lowerContent = textContent.toLowerCase();
      let index = lowerContent.indexOf(lowerQuery);

      while (index !== -1) {
        matches.push({ element: messageEl as HTMLElement, index });
        index = lowerContent.indexOf(lowerQuery, index + 1);
      }
    });

    setFindMatches(matches);
    setCurrentMatchIndex(matches.length > 0 ? 0 : -1);

    // Highlight matches
    highlightMatches(matches, 0);
  };

  const highlightMatches = (matches: { element: HTMLElement; index: number }[], currentIndex: number) => {
    // First, clear all existing highlights
    if (messagesContainerRef.current) {
      const highlighted = messagesContainerRef.current.querySelectorAll('.find-match, .find-match-current');
      highlighted.forEach(el => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(el.textContent || ''), el);
          parent.normalize();
        }
      });
    }

    // Apply new highlights - case insensitive
    // Track global match counter across all elements
    let globalMatchCounter = 0;

    // Group matches by element for efficient processing
    const groupedByElement = new Map<HTMLElement, number[]>();
    matches.forEach((match, idx) => {
      if (!groupedByElement.has(match.element)) {
        groupedByElement.set(match.element, []);
      }
      groupedByElement.get(match.element)!.push(idx);
    });

    groupedByElement.forEach((matchIndices, element) => {
      const textContent = element.textContent || '';
      const query = findQuery;

      if (!query) return;

      // Create a case-insensitive regex to split on matches
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedQuery})`, 'gi');
      const parts = textContent.split(regex);

      // Clear element and rebuild with highlights
      element.innerHTML = '';
      parts.forEach(part => {
        if (part.toLowerCase() === query.toLowerCase() && part.length === query.length) {
          // This is a match - check if it's the current one
          const span = document.createElement('span');
          span.className = globalMatchCounter === currentIndex ? 'find-match-current' : 'find-match';
          span.textContent = part;
          element.appendChild(span);
          globalMatchCounter++;
        } else if (part) {
          element.appendChild(document.createTextNode(part));
        }
      });
    });

    // Scroll to current match
    if (matches.length > 0 && currentIndex >= 0 && currentIndex < matches.length) {
      const currentMatchEl = matches[currentIndex].element.querySelector('.find-match-current');
      currentMatchEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleFindNext = () => {
    if (findMatches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % findMatches.length;
    setCurrentMatchIndex(nextIndex);
    highlightMatches(findMatches, nextIndex);
  };

  const handleFindPrevious = () => {
    if (findMatches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + findMatches.length) % findMatches.length;
    setCurrentMatchIndex(prevIndex);
    highlightMatches(findMatches, prevIndex);
  };

  const handleFindKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handleFindPrevious();
      } else {
        handleFindNext();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCloseFindBar?.();
    }
  };

  // Effect to perform find when query changes
  useEffect(() => {
    if (showFindBar) {
      performFind(findQuery);
    }
  }, [findQuery, showFindBar]);

  // Effect to focus find input when find bar opens
  useEffect(() => {
    if (showFindBar) {
      setTimeout(() => findInputRef.current?.focus(), 0);
    } else {
      // Clear highlights when find bar closes
      setFindQuery('');
      setFindMatches([]);
    }
  }, [showFindBar]);

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
      // Reset to first permission if we removed the current one and there are more
      if (currentPermissionIndex >= newRequests.length && newRequests.length > 0) {
        setCurrentPermissionIndex(0);
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
      // Reset to first permission if we removed the current one and there are more
      if (currentPermissionIndex >= newRequests.length && newRequests.length > 0) {
        setCurrentPermissionIndex(0);
      }
    } catch (error) {
      console.error('Error denying permission:', error);
    }
  };

  const handleApprovePlan = async (requestId: string) => {
    try {
      await window.electron.respondToPlanApproval({
        requestId,
        approved: true,
        conversationId: conversation?.id,
      });
      const newRequests = planApprovalRequests.filter(p => p.id !== requestId);
      setPlanApprovalRequests(newRequests);
      if (conversation?.id) {
        conversationPlanApprovalsRef.current.set(conversation.id, newRequests);
      }
    } catch (error) {
      console.error('Error approving plan:', error);
    }
  };

  const handleDenyPlan = async (requestId: string) => {
    try {
      await window.electron.respondToPlanApproval({
        requestId,
        approved: false,
        conversationId: conversation?.id,
      });
      const newRequests = planApprovalRequests.filter(p => p.id !== requestId);
      setPlanApprovalRequests(newRequests);
      if (conversation?.id) {
        conversationPlanApprovalsRef.current.set(conversation.id, newRequests);
      }
    } catch (error) {
      console.error('Error denying plan:', error);
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
          backgroundColor: 'rgba(74, 158, 255, 0.15)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }}>
          <div style={{
            background: '#4a9eff',
            padding: '20px 40px',
            borderRadius: '8px',
            color: '#ffffff',
            fontSize: '18px',
            fontWeight: 'bold'
          }}>
            Drop files here to attach
          </div>
        </div>
      )}

      {/* Title Header Bar */}
      <div className="chat-header">
        <div className="header-left">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              className="title-edit-input"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              onBlur={handleTitleSave}
            />
          ) : (
            <h3 className="chat-title" onClick={handleTitleClick}>
              {conversation?.title || 'New Conversation'}
            </h3>
          )}
        </div>
        {conversation?.projectPath && (
          <div className="header-right">
            <span className="current-directory" title={conversation.projectPath}>
              {conversation.projectPath}
            </span>
          </div>
        )}
      </div>

      {/* Find Bar */}
      {showFindBar && (
        <div className="find-bar">
          <input
            ref={findInputRef}
            type="text"
            className="find-input"
            placeholder="Find in conversation..."
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={handleFindKeyDown}
          />
          <span className="find-counter">
            {findMatches.length > 0 ? `${currentMatchIndex + 1} of ${findMatches.length}` : 'No matches'}
          </span>
          <button className="find-nav-btn" onClick={handleFindPrevious} disabled={findMatches.length === 0}>
            ↑
          </button>
          <button className="find-nav-btn" onClick={handleFindNext} disabled={findMatches.length === 0}>
            ↓
          </button>
          <button className="find-close-btn" onClick={onCloseFindBar}>
            ×
          </button>
        </div>
      )}

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

        {/* Build messages with optional inline streaming block */}
        {(() => {
          const elements: React.ReactNode[] = [];
          const msgs = conversation?.messages || [];

          // Determine inline insert index based on processing-started timestamp
          let insertIndex: number | null = null;
          const startedAt = conversation?.id ? conversationStreamingStartRef.current.get(conversation.id) : undefined;
          if (conversation?.id && startedAt !== undefined) {
            // Find last index whose timestamp <= startedAt
            let idx = -1;
            for (let i = 0; i < msgs.length; i++) {
              const ts = msgs[i].timestamp ?? 0;
              if (ts <= startedAt) idx = i;
            }
            insertIndex = idx; // -1 means before first
          }

          const renderStreamingBlock = () => (
            <div key="__streaming__" className="message assistant streaming">
              <div className="message-role">Claude</div>
              <div className="message-content">
                {streamingContent ? (
                  <>
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                    {isLoading && <span className="cursor">▊</span>}
                  </>
                ) : (
                  <>
                    {["Thinking...", "One moment...", "Working on it...", "Processing..."][loadingMessageIndex]}
                    <span className="cursor">▊</span>
                  </>
                )}
              </div>
            </div>
          );

          let streamingInserted = false;

          // If insertIndex === -1 and we are loading, insert at top
          if (isLoading && insertIndex === -1) {
            elements.push(renderStreamingBlock());
            streamingInserted = true;
          }

          msgs.forEach((msg, index) => {
            const messageType = msg.messageType || msg.role;
            let node: React.ReactNode;
            switch (messageType) {
              case 'tool_use':
                node = <ToolUseMessage key={`msg-${index}`} message={msg} />;
                break;
              case 'tool_result':
                node = <ToolResultMessage key={`msg-${index}`} message={msg} />;
                break;
              case 'thinking':
                node = <ThinkingMessage key={`msg-${index}`} message={msg} />;
                break;
              case 'error':
                node = <ErrorMessage key={`msg-${index}`} message={msg} />;
                break;
              case 'user':
              case 'assistant':
              default:
                node = (
                  <div key={`msg-${index}`} className={`message ${msg.role}`}>
                    <div className="message-role">{msg.role === 'user' ? 'You' : 'Claude'}</div>
                    <div className="message-content">
                      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
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
                break;
            }
            elements.push(node);

            // After rendering this message, insert streaming block if this is the anchor index
            if (isLoading && insertIndex !== null && insertIndex === index) {
              elements.push(renderStreamingBlock());
              streamingInserted = true;
            }
          });

          // Fallback: if we are loading but have no insert anchor, append at bottom (legacy behavior)
          if (isLoading && insertIndex === null && !streamingInserted) {
            elements.push(renderStreamingBlock());
          }

          return elements;
        })()}

        {/* Error Message Display */}
        {sendError && (
          <div className="tool-message error-message" style={{ margin: '10px 0' }}>
            <div
              className="tool-header"
              onClick={() => setErrorExpanded(!errorExpanded)}
              style={{ cursor: 'pointer' }}
            >
              <span className="tool-icon">⚠</span>
              <span className="tool-summary">{sendError.message}</span>
              <span className="expand-icon">{errorExpanded ? '▼' : '▶'}</span>
            </div>
            {errorExpanded && (
              <div className="tool-details">
                <div className="error-detail-section">
                  <pre className="error-content">{sendError.details}</pre>
                </div>
              </div>
            )}
            <button
              onClick={() => {
                setSendError(null);
                setErrorExpanded(false);
              }}
              className="error-dismiss-btn"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Permission Requests - Show one at a time */}
        {permissionRequests.length > 0 && currentPermissionIndex < permissionRequests.length && (() => {
          const request = permissionRequests[currentPermissionIndex];
          return (
            <div key={request.id} className="permission-request-box">
              <div className="permission-header">
                <span style={{ fontSize: '24px' }}>⚠️</span>
                <strong className="permission-title">Permission Required</strong>
                {permissionRequests.length > 1 && (
                  <span style={{ marginLeft: 'auto', color: '#888', fontSize: '14px' }}>
                    {currentPermissionIndex + 1} of {permissionRequests.length}
                  </span>
                )}
              </div>
              <div style={{ marginBottom: '12px' }}>
                <div className="permission-description">
                  <strong>{request.tool}</strong> wants to: {request.action}
                </div>
                {request.details && (
                  <div className="permission-details">
                    {request.details}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleApprovePermission(request.id)}
                  className="permission-approve-btn"
                >
                  ✓ Approve
                </button>
                <button
                  onClick={() => handleDenyPermission(request.id)}
                  className="permission-deny-btn"
                >
                  ✗ Deny
                </button>
              </div>
            </div>
          );
        })()}

        {/* Plan Approval Requests */}
        {planApprovalRequests.map(request => (
          <div key={request.id} style={{
            background: '#2a2a2a',
            border: '2px solid #1890ff',
            borderRadius: '8px',
            padding: '16px',
            margin: '10px 0',
            animation: 'pulse 2s infinite'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '24px' }}>📋</span>
              <strong style={{ color: '#1890ff', fontSize: '16px' }}>Plan Approval Required</strong>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: '#ddd', marginBottom: '8px' }}>
                Claude has created a plan and needs your approval to proceed:
              </div>
              <div style={{
                background: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: '4px',
                padding: '12px',
                color: '#ddd',
                fontSize: '14px',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                maxHeight: '300px',
                overflowY: 'auto'
              }}>
                {request.plan}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleApprovePlan(request.id)}
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
                ✓ Approve & Proceed
              </button>
              <button
                onClick={() => handleDenyPlan(request.id)}
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
          <div className="auto-accept-warning-box">
            <div className="warning-header">
              <span style={{ fontSize: '24px' }}>⚠️</span>
              <strong className="warning-title">Warning: Auto-Accept All Mode</strong>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <div className="warning-description">
                You are about to enable <strong>Auto-Accept All</strong> mode, which will:
              </div>
              <ul className="warning-list">
                <li>Automatically approve ALL tool executions without asking</li>
                <li>Allow Claude to read, write, and delete files</li>
                <li>Allow Claude to run arbitrary commands</li>
                <li>Potentially cause data loss or system changes</li>
              </ul>
              <div className="warning-danger">
                Only use this mode if you fully trust the current conversation context.
              </div>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label className="warning-checkbox-label">
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
                className="warning-cancel-btn"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAutoAccept}
                className="warning-confirm-btn"
              >
                Enable Auto-Accept All
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <div className="input-controls">
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
              <Tooltip content="Stop">
                <button
                  className="stop-btn"
                  onClick={handleStop}
                >
                  <Square size={18} />
                </button>
              </Tooltip>
            )}
            <Tooltip content="Send">
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!folderExists || (!input.trim() && attachedFiles.length === 0)}
              >
                <Send size={18} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Mode Selector Bar - Moved below input */}
      <div className="mode-selector-bar">
        <Tooltip content="Attach files">
          <button className="attach-btn" onClick={handleFileAttach} disabled={!folderExists}>
            <Paperclip size={16} />
          </button>
        </Tooltip>
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
        <span className="mode-label">Mode:</span>
        <select
          value={mode}
          onChange={(e) => handleModeChange(e.target.value as PermissionMode)}
          disabled={!folderExists}
          className="mode-select"
          style={{
            border: `1px solid ${getModeColor(mode)}`,
            color: getModeColor(mode),
            cursor: folderExists ? 'pointer' : 'not-allowed',
          }}
        >
          <option value="default">Ask for Permissions</option>
          <option value="acceptEdits">Accept Edits Only</option>
          <option value="bypassPermissions">Auto-Accept All</option>
          <option value="plan">Plan Mode</option>
        </select>
        <div className="mode-badge" style={{
          background: getModeColor(mode),
        }}>
          {getModeLabel(mode)}
        </div>
        <span className="keyboard-hint">Shift+Tab to cycle</span>
      </div>
    </div>
  );
};

export default ChatArea;
