import React, { useState, useEffect, useRef } from 'react';
import type { Conversation, Message, User, Attachment, MessageQuote } from '../types';
import { getCsrfToken, apiRequest } from '../api';
import {
  Send,
  Check,
  CheckCheck,
  UserPlus,
  MessageSquare,
  Clock,
  ArrowLeft,
  Paperclip,
  X,
  FileText,
  Download,
  Loader2,
  AlertCircle,
  FileUp,
  Users,
  MoreVertical,
  ShieldAlert,
  UserX,
  Reply,
  Edit2,
  Trash2,
  Smile,
  Search,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

interface ChatAreaProps {
  conversation: Conversation | null;
  messages: Message[];
  currentUser: User;
  isPartnerTyping: boolean;
  onSendMessage: (
    content: string,
    attachmentId?: string | null,
    attachment?: Attachment | null,
    replyToId?: number | null,
    replyQuote?: MessageQuote | null
  ) => void;
  onEditMessage?: (messageId: number, newContent: string) => Promise<void>;
  onDeleteMessage?: (messageId: number, mode: 'me' | 'everyone') => Promise<void>;
  onReactMessage?: (messageId: number, emoji: string) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
  onMarkRead?: (conversationId: string) => void;
  onBackToList?: () => void;
  onOpenInviteModal: () => void;
  onOpenGroupInfo?: () => void;
  onOpenReport?: (userId: number, userName: string, messageId?: number) => void;
  onBlockUser?: (userId: number) => void;
  onViewProfile?: (usernameOrId: string | number) => void;
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];

export const ChatArea: React.FC<ChatAreaProps> = ({
  conversation,
  messages,
  currentUser,
  isPartnerTyping,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onReactMessage,
  onTyping,
  onMarkRead,
  onBackToList,
  onOpenInviteModal,
  onOpenGroupInfo,
  onOpenReport,
  onBlockUser,
  onViewProfile,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const typingTimerRef = useRef<number | null>(null);

  // File Upload State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [uploadedAttachment, setUploadedAttachment] = useState<Attachment | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Drag and drop state
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Lightbox State
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Header Dropdown Menu
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);

  // Stage 3: Chat Essentials States
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [activeReactionPickerMsgId, setActiveReactionPickerMsgId] = useState<number | null>(null);
  const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<{ id: number; isAuthor: boolean } | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);

  // In-Chat Search State
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: number; content: string; createdAt: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  // Auto-scroll to bottom unless user scrolled up
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
  };

  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isPartnerTyping]);

  // Handle Esc key to close lightbox, search, or editing/replying
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxUrl(null);
        setActiveReactionPickerMsgId(null);
        setDeleteConfirmMsg(null);
        if (editingMessage) {
          setEditingMessage(null);
          setInputText('');
        }
        if (replyingTo) {
          setReplyingTo(null);
        }
        if (showSearch) {
          setShowSearch(false);
          setSearchQuery('');
          setSearchResults([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingMessage, replyingTo, showSearch]);

  // Mark messages read when chat is open and window/tab is focused
  useEffect(() => {
    if (!conversation) return;

    const markIfFocused = () => {
      if (document.visibilityState === 'visible') {
        onMarkRead?.(conversation.id);
      }
    };

    markIfFocused();
    window.addEventListener('focus', markIfFocused);
    document.addEventListener('visibilitychange', markIfFocused);

    return () => {
      window.removeEventListener('focus', markIfFocused);
      document.removeEventListener('visibilitychange', markIfFocused);
    };
  }, [conversation?.id, messages.length, onMarkRead]);

  // In-chat search execution
  useEffect(() => {
    if (!showSearch || !searchQuery.trim() || !conversation) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await apiRequest<{
          results: Array<{ id: number; content: string; createdAt: string }>;
        }>(`/api/messages/search?q=${encodeURIComponent(searchQuery.trim())}&conversationId=${conversation.id}`);
        setSearchResults(res.results || []);
        setCurrentMatchIdx(0);
        if (res.results && res.results.length > 0) {
          scrollToMessage(res.results[0].id);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, showSearch, conversation?.id]);

  const scrollToMessage = (msgId: number) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMsgId(msgId);
      setTimeout(() => setHighlightedMsgId(null), 2000);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);

    // Broadcast typing start (only when not editing)
    if (!editingMessage) {
      onTyping(true);
      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
      }
      typingTimerRef.current = window.setTimeout(() => {
        onTyping(false);
      }, 2500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Upload handler
  const processUpload = async (file: File) => {
    setUploadError(null);
    setPendingFile(file);
    setIsUploading(true);

    if (file.type.startsWith('image/')) {
      const objectUrl = URL.createObjectURL(file);
      setPendingPreviewUrl(objectUrl);
    } else {
      setPendingPreviewUrl(null);
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const csrf = getCsrfToken();
      const headers: Record<string, string> = {};
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }

      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include',
        signal: controller.signal,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload file');
      }

      setUploadedAttachment({
        id: data.attachmentId,
        originalName: data.originalName,
        mime: data.mime,
        size: data.size,
        url: data.url,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setUploadError(err.message || 'Upload failed');
      setPendingFile(null);
      if (pendingPreviewUrl) {
        URL.revokeObjectURL(pendingPreviewUrl);
        setPendingPreviewUrl(null);
      }
    } finally {
      setIsUploading(false);
      abortControllerRef.current = null;
    }
  };

  const cancelUpload = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl(null);
    setUploadedAttachment(null);
    setUploadError(null);
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processUpload(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          processUpload(file);
          break;
        }
      }
    }
  };

  const handleSend = async () => {
    const trimmed = inputText.trim();

    // 1. If currently editing a message
    if (editingMessage) {
      if (!trimmed || !onEditMessage || !editingMessage.id) return;
      await onEditMessage(editingMessage.id, trimmed);
      setEditingMessage(null);
      setInputText('');
      return;
    }

    // 2. Normal send or Reply send
    if (!trimmed && !uploadedAttachment) return;
    if (isUploading) return;

    let replyQuote: MessageQuote | null = null;
    if (replyingTo && replyingTo.id) {
      replyQuote = {
        id: replyingTo.id,
        senderId: replyingTo.senderId,
        senderName: replyingTo.senderId === currentUser.id ? 'You' : 'Member',
        content: replyingTo.content.slice(0, 100),
        hasAttachment: !!replyingTo.attachmentId,
      };
    }

    onSendMessage(
      trimmed,
      uploadedAttachment?.id || null,
      uploadedAttachment || null,
      replyingTo?.id || null,
      replyQuote
    );

    setInputText('');
    setReplyingTo(null);

    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl(null);
    setUploadedAttachment(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    onTyping(false);
    isAtBottomRef.current = true;
  };

  const startEditing = (msg: Message) => {
    setEditingMessage(msg);
    setReplyingTo(null);
    setInputText(msg.content);
  };

  const cancelEditing = () => {
    setEditingMessage(null);
    setInputText('');
  };

  const startReplying = (msg: Message) => {
    setReplyingTo(msg);
    setEditingMessage(null);
  };

  const cancelReplying = () => {
    setReplyingTo(null);
  };

  const handleDelete = async (mode: 'me' | 'everyone') => {
    if (!deleteConfirmMsg || !onDeleteMessage) return;
    await onDeleteMessage(deleteConfirmMsg.id, mode);
    setDeleteConfirmMsg(null);
  };

  const handleReaction = async (messageId: number, emoji: string) => {
    setActiveReactionPickerMsgId(null);
    if (onReactMessage) {
      await onReactMessage(messageId, emoji);
    }
  };

  const formatMessageTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatLastSeen = (dateStr?: string) => {
    if (!dateStr) return 'Offline';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / (1000 * 60));
    if (diffMin < 1) return 'Active just now';
    if (diffMin < 60) return `Last active ${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `Last active ${diffHours}h ago`;
    return `Last seen ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  };

  const renderMessageContent = (content: string) => {
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const parts = content.split(urlPattern);

    return parts.map((part, i) => {
      if (part.match(urlPattern)) {
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
  };

  if (!conversation) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[var(--bg-base)] select-none">
        <div className="w-16 h-16 rounded-3xl bg-[var(--accent-soft)] text-[var(--accent-terracotta)] flex items-center justify-center mb-4 shadow-sm">
          <MessageSquare className="w-8 h-8" />
        </div>
        <h2 className="font-serif-claude text-2xl font-medium text-[var(--text-primary)] mb-2">
          Your Conversations
        </h2>
        <p className="text-xs text-[var(--text-secondary)] max-w-sm mb-6 leading-relaxed">
          Select an existing conversation from the sidebar or click "Invite" or "New Group" to start messaging.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onOpenInviteModal}
            className="py-2.5 px-4 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium rounded-xl flex items-center gap-1.5 shadow-md shadow-[var(--accent-terracotta)]/20 transition-all cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Create Invite Link</span>
          </button>
        </div>
      </main>
    );
  }

  const isGroup = conversation.type === 'group';
  const recipient = conversation.recipient;
  const displayName = isGroup
    ? conversation.title || conversation.name || 'Group Chat'
    : recipient
    ? recipient.name || recipient.username || recipient.email.split('@')[0]
    : 'Direct Chat';

  return (
    <main
      className="flex-1 flex flex-col h-full bg-[var(--bg-base)] relative overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) processUpload(file);
      }}
    >
      {/* Drag & Drop Visual Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-40 bg-[var(--bg-surface)]/85 backdrop-blur-sm border-2 border-dashed border-[var(--accent-terracotta)] flex flex-col items-center justify-center text-[var(--accent-terracotta)] animate-fade-in pointer-events-none">
          <FileUp className="w-12 h-12 mb-2 animate-bounce" />
          <p className="text-sm font-semibold">Drop image or file to upload</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">JPEG, PNG, WebP, GIF, PDF, TXT up to 10 MB</p>
        </div>
      )}

      {/* Header */}
      <header className="px-4 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0 select-none z-20">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBackToList}
            className="md:hidden p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            aria-label="Back to chat list"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* Avatar & status */}
          <button
            type="button"
            onClick={() => {
              if (onViewProfile && !isGroup && recipient) {
                onViewProfile(recipient.username || recipient.id);
              }
            }}
            className="flex items-center gap-2.5 text-left hover:opacity-90 transition-opacity cursor-pointer min-w-0"
          >
            <div className="relative shrink-0">
              {isGroup ? (
                <div className="w-9 h-9 rounded-xl border flex items-center justify-center text-sm font-medium bg-[var(--accent-soft)] text-[var(--accent-terracotta)] border-[var(--accent-terracotta)]/20">
                  <Users className="w-4 h-4" />
                </div>
              ) : recipient?.avatarUrl ? (
                <img
                  src={recipient.avatarUrl}
                  alt={displayName}
                  className="w-9 h-9 rounded-xl object-cover border border-[var(--border-subtle)]"
                />
              ) : (
                <div className="w-9 h-9 rounded-xl border flex items-center justify-center text-sm font-medium text-white bg-indigo-600">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              {!isGroup && recipient?.isOnline && (
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[var(--bg-surface)]" />
              )}
            </div>

            <div className="min-w-0">
              <h2 className="text-xs font-semibold text-[var(--text-primary)] truncate font-serif-claude">
                {displayName}
              </h2>
              <div className="text-[10px] text-[var(--text-muted)] truncate">
                {isPartnerTyping ? (
                  <span className="text-[var(--accent-terracotta)] font-medium">typing...</span>
                ) : isGroup ? (
                  <span>{conversation.memberCount || 1} members</span>
                ) : recipient?.isOnline ? (
                  <span className="text-emerald-400 font-medium">Active now</span>
                ) : (
                  <span>{formatLastSeen(recipient?.lastSeen || undefined)}</span>
                )}
              </div>
            </div>
          </button>
        </div>

        {/* Right header actions: Search, Group Info, More */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSearch(!showSearch)}
            title="Search in conversation"
            className={`p-2 rounded-xl transition-colors cursor-pointer ${
              showSearch
                ? 'bg-[var(--accent-soft)] text-[var(--accent-terracotta)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          {isGroup ? (
            <button
              onClick={onOpenGroupInfo}
              className="px-3 py-1.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--border-strong)] text-[var(--text-primary)] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
              <span>Group Info</span>
            </button>
          ) : recipient ? (
            <div className="relative">
              <button
                onClick={() => setShowHeaderMenu((prev) => !prev)}
                className="p-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                title="Options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {showHeaderMenu && (
                <div className="absolute right-0 top-10 z-30 w-40 bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-xl shadow-xl py-1 text-xs animate-fade-in">
                  <button
                    onClick={() => {
                      setShowHeaderMenu(false);
                      if (onViewProfile) onViewProfile(recipient.username || recipient.id);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] text-[var(--text-primary)] flex items-center gap-2 cursor-pointer"
                  >
                    View Profile
                  </button>
                  <button
                    onClick={() => {
                      setShowHeaderMenu(false);
                      onBlockUser?.(recipient.id);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] text-rose-400 flex items-center gap-2 cursor-pointer"
                  >
                    <UserX className="w-3.5 h-3.5" /> Block User
                  </button>
                  <button
                    onClick={() => {
                      setShowHeaderMenu(false);
                      onOpenReport?.(recipient.id, displayName);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] text-amber-400 flex items-center gap-2 cursor-pointer"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" /> Report User
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </header>

      {/* In-Chat Search Bar */}
      {showSearch && (
        <div className="px-4 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] flex items-center gap-2 text-xs animate-fade-in z-10">
          <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages in this conversation..."
            className="flex-1 bg-transparent border-none outline-none text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)]"
          />
          {searchLoading && <span className="text-[10px] text-[var(--text-muted)]">Searching...</span>}
          {searchResults.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              <span>
                {currentMatchIdx + 1} of {searchResults.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  const nextIdx = (currentMatchIdx - 1 + searchResults.length) % searchResults.length;
                  setCurrentMatchIdx(nextIdx);
                  scrollToMessage(searchResults[nextIdx].id);
                }}
                className="p-1 hover:bg-[var(--bg-surface)] rounded cursor-pointer"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextIdx = (currentMatchIdx + 1) % searchResults.length;
                  setCurrentMatchIdx(nextIdx);
                  scrollToMessage(searchResults[nextIdx].id);
                }}
                className="p-1 hover:bg-[var(--bg-surface)] rounded cursor-pointer"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <button
            onClick={() => {
              setShowSearch(false);
              setSearchQuery('');
              setSearchResults([]);
            }}
            className="p-1 hover:bg-[var(--bg-surface)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Messages Stream */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-[var(--text-muted)] py-12">
            <div className="w-12 h-12 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center mb-3">
              <MessageSquare className="w-6 h-6 text-[var(--text-secondary)]" />
            </div>
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
              {isGroup ? displayName : 'Private 1-on-1 Conversation'}
            </p>
            <p className="text-xs text-[var(--text-muted)] max-w-xs">
              Say hello! You can send messages, photos, replies, reactions, and files securely.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.senderId === currentUser.id;
            const isHighlighted = highlightedMsgId === msg.id;

            // Date separator check
            const currentDateStr = new Date(msg.createdAt).toDateString();
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const prevDateStr = prevMsg ? new Date(prevMsg.createdAt).toDateString() : null;
            const showDateSeparator = currentDateStr !== prevDateStr;

            // Render system messages
            if (msg.type === 'system') {
              return (
                <React.Fragment key={msg.id || msg.clientMsgId || idx}>
                  {showDateSeparator && (
                    <div className="flex items-center justify-center my-4">
                      <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)] select-none">
                        {new Date(msg.createdAt).toLocaleDateString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-center my-2">
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] italic select-none">
                      {msg.content}
                    </span>
                  </div>
                </React.Fragment>
              );
            }

            const canEdit =
              isMe &&
              !msg.isDeleted &&
              Date.now() - new Date(msg.createdAt).getTime() <= 15 * 60 * 1000;

            const canDeleteEveryone =
              isMe || (isGroup && ['owner', 'admin'].includes(conversation.role || ''));

            return (
              <React.Fragment key={msg.id || msg.clientMsgId || idx}>
                {showDateSeparator && (
                  <div className="flex items-center justify-center my-4">
                    <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)] select-none">
                      {new Date(msg.createdAt).toLocaleDateString([], {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                )}

                <div
                  id={msg.id ? `msg-${msg.id}` : undefined}
                  className={`flex flex-col group/msg relative transition-all duration-300 ${
                    isMe ? 'items-end' : 'items-start'
                  } ${isHighlighted ? 'bg-[var(--accent-soft)] p-2 rounded-2xl' : ''}`}
                >
                  {/* Sender name for group chats */}
                  {isGroup && !isMe && (
                    <span className="text-[11px] font-medium text-[var(--accent-terracotta)] ml-2 mb-1">
                      Member #{msg.senderId}
                    </span>
                  )}

                  <div className="flex items-center gap-1.5 max-w-[85%] md:max-w-md">
                    {/* Action buttons on left for own messages */}
                    {isMe && !msg.isDeleted && (
                      <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setActiveReactionPickerMsgId(
                              activeReactionPickerMsgId === msg.id ? null : msg.id || null
                            )
                          }
                          title="React"
                          className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          <Smile className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => startReplying(msg)}
                          title="Reply"
                          className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          <Reply className="w-3.5 h-3.5" />
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => startEditing(msg)}
                            title="Edit (within 15m)"
                            className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteConfirmMsg({ id: msg.id!, isAuthor: isMe })
                          }
                          title="Delete"
                          className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Message Bubble */}
                    <div
                      className={`px-4 py-2.5 rounded-2xl shadow-sm text-xs leading-relaxed break-words relative transition-all ${
                        isMe
                          ? 'bg-[var(--bubble-me)] text-white rounded-br-xs'
                          : 'bg-[var(--bubble-them)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-bl-xs'
                      }`}
                    >
                      {/* Quoted Reply Snapshot */}
                      {msg.replyQuote && !msg.isDeleted && (
                        <div
                          onClick={() => msg.replyToId && scrollToMessage(msg.replyToId)}
                          className={`mb-2 p-2 rounded-xl text-left cursor-pointer border-l-2 transition-colors ${
                            isMe
                              ? 'bg-black/20 hover:bg-black/30 border-white text-white/90'
                              : 'bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)] border-[var(--accent-terracotta)] text-[var(--text-secondary)]'
                          }`}
                        >
                          <div className="text-[10px] font-semibold text-[var(--accent-terracotta)] mb-0.5">
                            {msg.replyQuote.senderName}
                          </div>
                          <div className="text-[11px] truncate opacity-80">
                            {msg.replyQuote.content}
                          </div>
                        </div>
                      )}

                      {/* Tombstone if deleted */}
                      {msg.isDeleted ? (
                        <p className="italic text-[var(--text-muted)] select-none">
                          This message was deleted
                        </p>
                      ) : (
                        <>
                          {/* Attachment Display */}
                          {msg.attachment && (
                            <div className="mb-2">
                              {msg.attachment.mime.startsWith('image/') ? (
                                <div
                                  onClick={() => setLightboxUrl(msg.attachment!.url)}
                                  className="cursor-pointer group relative overflow-hidden rounded-xl inline-block"
                                >
                                  <img
                                    src={msg.attachment.url}
                                    alt={msg.attachment.originalName}
                                    className="max-h-60 w-auto rounded-xl object-cover"
                                    loading="lazy"
                                  />
                                </div>
                              ) : (
                                <a
                                  href={msg.attachment.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  download={msg.attachment.originalName}
                                  className={`flex items-center gap-2.5 p-2 rounded-xl border no-underline ${
                                    isMe
                                      ? 'bg-black/20 hover:bg-black/30 border-white/10 text-white'
                                      : 'bg-[var(--bg-base)] border-[var(--border-subtle)] text-[var(--text-primary)]'
                                  }`}
                                >
                                  <FileText className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">{msg.attachment.originalName}</div>
                                    <div className="text-[10px] opacity-70">
                                      {formatFileSize(msg.attachment.size)}
                                    </div>
                                  </div>
                                  <Download className="w-3.5 h-3.5 shrink-0" />
                                </a>
                              )}
                            </div>
                          )}

                          {/* Content */}
                          {msg.content && <p className="whitespace-pre-wrap">{renderMessageContent(msg.content)}</p>}
                        </>
                      )}

                      {/* Footer: Time + Edited tag + Ticks */}
                      <div
                        className={`flex items-center justify-end gap-1 text-[10px] mt-1 select-none ${
                          isMe ? 'text-white/80' : 'text-[var(--text-muted)]'
                        }`}
                      >
                        {msg.editedAt && !msg.isDeleted && (
                          <span
                            className="text-[9px] opacity-75 mr-0.5 cursor-help"
                            title={`Edited at ${new Date(msg.editedAt).toLocaleString()}`}
                          >
                            (edited)
                          </span>
                        )}
                        <span>{formatMessageTime(msg.createdAt)}</span>

                        {isMe && !msg.isDeleted && (
                          <span className="ml-0.5 inline-flex items-center">
                            {msg.pending ? (
                              <Clock className="w-3 h-3 animate-spin opacity-70" />
                            ) : isGroup ? (
                              <Check className="w-3.5 h-3.5 text-white/75" />
                            ) : msg.readAt ? (
                              <CheckCheck className="w-3.5 h-3.5 text-sky-300" />
                            ) : msg.deliveredAt ? (
                              <CheckCheck className="w-3.5 h-3.5 text-white/90" />
                            ) : (
                              <Check className="w-3.5 h-3.5 text-white/75" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons on right for other user messages */}
                    {!isMe && !msg.isDeleted && (
                      <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setActiveReactionPickerMsgId(
                              activeReactionPickerMsgId === msg.id ? null : msg.id || null
                            )
                          }
                          title="React"
                          className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          <Smile className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => startReplying(msg)}
                          title="Reply"
                          className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          <Reply className="w-3.5 h-3.5" />
                        </button>
                        {canDeleteEveryone && (
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteConfirmMsg({ id: msg.id!, isAuthor: isMe })
                            }
                            title="Delete"
                            className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenReport?.(msg.senderId, displayName, msg.id)}
                          title="Report"
                          className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-amber-400 cursor-pointer"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Quick Reaction Picker Popover */}
                  {activeReactionPickerMsgId === msg.id && (
                    <div className="flex items-center gap-1 p-1 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-full shadow-lg z-30 mt-1 animate-fade-in">
                      {QUICK_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleReaction(msg.id!, emoji)}
                          className="p-1 text-base hover:scale-125 transition-transform cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Reaction Badges Pill Bar */}
                  {msg.reactions && msg.reactions.length > 0 && !msg.isDeleted && (
                    <div className="flex flex-wrap gap-1 mt-1 ml-1 mr-1">
                      {msg.reactions.map((rx) => (
                        <button
                          key={rx.emoji}
                          type="button"
                          onClick={() => handleReaction(msg.id!, rx.emoji)}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 border transition-all cursor-pointer ${
                            rx.userReacted
                              ? 'bg-[var(--accent-soft)] border-[var(--accent-terracotta)] text-[var(--accent-terracotta)] font-semibold'
                              : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]'
                          }`}
                        >
                          <span>{rx.emoji}</span>
                          <span>{rx.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}

        {/* Typing indicator bubble */}
        {isPartnerTyping && (
          <div className="flex flex-col items-start">
            <div className="px-4 py-2 rounded-2xl rounded-bl-xs bg-[var(--bubble-them)] border border-[var(--border-subtle)] text-[var(--accent-terracotta)] text-xs flex items-center gap-1.5 shadow-sm">
              <span className="font-medium">typing</span>
              <span className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-terracotta)] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-terracotta)] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-terracotta)] animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Footer Area */}
      <footer className="p-3 md:p-4 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] shrink-0">
        <div className="max-w-4xl mx-auto space-y-2">
          {/* Quoted Reply Preview Banner */}
          {replyingTo && (
            <div className="p-2.5 rounded-xl bg-[var(--bg-elevated)] border-l-4 border-[var(--accent-terracotta)] flex items-center justify-between gap-3 text-xs animate-fade-in">
              <div className="flex items-center gap-2 min-w-0">
                <Reply className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0" />
                <div className="truncate">
                  <span className="font-semibold text-[var(--accent-terracotta)]">
                    Replying to {replyingTo.senderId === currentUser.id ? 'yourself' : 'message'}:
                  </span>{' '}
                  <span className="text-[var(--text-muted)] truncate">{replyingTo.content}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={cancelReplying}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Edit Mode Banner */}
          {editingMessage && (
            <div className="p-2.5 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-terracotta)]/30 flex items-center justify-between gap-3 text-xs animate-fade-in">
              <div className="flex items-center gap-2 min-w-0">
                <Edit2 className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0" />
                <div className="truncate">
                  <span className="font-semibold text-[var(--accent-terracotta)]">Editing Message:</span>{' '}
                  <span className="text-[var(--text-secondary)]">Press Enter to save, Esc to cancel</span>
                </div>
              </div>
              <button
                type="button"
                onClick={cancelEditing}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Inline Upload Error Notice */}
          {uploadError && (
            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{uploadError}</span>
              </div>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="p-1 hover:text-white rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Pending Attachment Chip */}
          {(pendingFile || uploadedAttachment) && (
            <div className="p-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                {pendingPreviewUrl ? (
                  <img
                    src={pendingPreviewUrl}
                    alt="Preview"
                    className="w-10 h-10 rounded-lg object-cover border border-[var(--border-subtle)]"
                  />
                ) : (
                  <FileText className="w-5 h-5 text-[var(--accent-terracotta)] shrink-0" />
                )}
                <div className="truncate">
                  <div className="font-medium text-[var(--text-primary)] truncate">
                    {pendingFile?.name || uploadedAttachment?.originalName}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)]">
                    {isUploading ? (
                      <span className="flex items-center gap-1 text-[var(--accent-terracotta)]">
                        <Loader2 className="w-3 h-3 animate-spin" /> Uploading...
                      </span>
                    ) : (
                      'Ready to send'
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={cancelUpload}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-rose-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Input Row */}
          <div className="flex items-end gap-2 bg-[var(--bg-base)] border border-[var(--border-subtle)] focus-within:border-[var(--accent-terracotta)] rounded-2xl p-2 transition-colors">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              title="Attach File"
              className="p-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            <textarea
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={editingMessage ? 'Edit your message...' : 'Type a message...'}
              className="flex-1 max-h-32 min-h-[36px] py-1.5 px-2 bg-transparent border-none text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none resize-none leading-relaxed"
            />

            <button
              type="button"
              onClick={handleSend}
              disabled={(!inputText.trim() && !uploadedAttachment) || isUploading}
              className="p-2 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white rounded-xl transition-all shadow-md shadow-[var(--accent-terracotta)]/20 disabled:opacity-40 cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </footer>

      {/* Delete Confirmation Modal */}
      {(() => {
        if (!deleteConfirmMsg) return null;
        const canDeleteEveryone = deleteConfirmMsg.isAuthor ||
          (conversation?.type === 'group' && (conversation?.role === 'owner' || conversation?.role === 'admin'));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Delete Message</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Choose how you want to delete this message.
            </p>
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => handleDelete('me')}
                className="w-full py-2 px-3 bg-[var(--bg-elevated)] hover:bg-[var(--bg-base)] text-[var(--text-primary)] text-xs font-medium rounded-xl border border-[var(--border-subtle)] transition-colors cursor-pointer"
              >
                Delete for me
              </button>
              {canDeleteEveryone && (
                <button
                  type="button"
                  onClick={() => handleDelete('everyone')}
                  className="w-full py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer"
                >
                  Delete for everyone
                </button>
              )}
              <button
                type="button"
                onClick={() => setDeleteConfirmMsg(null)}
                className="w-full py-2 px-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Lightbox Modal */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out animate-fade-in"
        >
          <img
            src={lightboxUrl}
            alt="Full size"
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-xl shadow-2xl"
          />
        </div>
      )}
    </main>
  );
};
