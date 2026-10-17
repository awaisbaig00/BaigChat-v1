import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from './api';
import type { User, Conversation, Message, InvitePreview, Attachment, MessageQuote } from './types';
import { useChatSocket } from './useChatSocket';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { AuthModal } from './components/AuthModal';
import { InviteModal } from './components/InviteModal';
import { InviteLandingModal } from './components/InviteLandingModal';
import { NewGroupModal } from './components/NewGroupModal';
import { GroupInfoModal } from './components/GroupInfoModal';
import { BlockedListModal } from './components/BlockedListModal';
import { ReportModal } from './components/ReportModal';
import { EditProfileModal } from './components/EditProfileModal';
import { UserProfileModal } from './components/UserProfileModal';
import { UserSearchModal } from './components/UserSearchModal';
import { AccountSettingsModal } from './components/AccountSettingsModal';
import { LegalModal } from './components/LegalModal';
import { Loader2 } from 'lucide-react';

export function App() {
  const [isDark, setIsDark] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Invite handling state
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);

  // Stage 1 Modal States
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [showGroupInfoModal, setShowGroupInfoModal] = useState(false);
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [reportData, setReportData] = useState<{
    isOpen: boolean;
    reportedUserId: number;
    reportedUserName: string;
    messageId?: number;
  } | null>(null);

  // Profile, Settings & Legal Modal States
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showUserSearchModal, setShowUserSearchModal] = useState(false);
  const [showAccountSettingsModal, setShowAccountSettingsModal] = useState(false);
  const [viewProfileTarget, setViewProfileTarget] = useState<{ username?: string | null; userId?: number | null } | null>(null);
  const [legalModalType, setLegalModalType] = useState<'privacy' | 'terms' | null>(null);

  // Chat state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);

  // Sync theme to <html> tag
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  const checkInviteToken = useCallback(async (token: string) => {
    try {
      const preview = await apiRequest<InvitePreview>(`/api/invites/${token}`);
      setInvitePreview(preview);
      setInviteError(null);
    } catch (err: any) {
      setInviteError(err?.message || 'Invite link is invalid or expired');
    }
  }, []);

  // Check session on mount
  useEffect(() => {
    const checkAuth = async () => {
      const match = window.location.pathname.match(/\/invite\/([a-zA-Z0-9_-]+)/);
      const urlToken = match ? match[1] : null;

      try {
        const data = await apiRequest<{ user: User | null; csrfToken: string | null }>('/api/auth/me');
        if (data.user) {
          setCurrentUser(data.user);
          const pending = sessionStorage.getItem('pending_invite_token');
          const tokenToUse = urlToken || pending;
          if (pending) {
            sessionStorage.removeItem('pending_invite_token');
          }
          if (tokenToUse) {
            setInviteToken(tokenToUse);
            checkInviteToken(tokenToUse);
            window.history.replaceState({}, '', `/invite/${tokenToUse}`);
          }
        } else {
          // If not logged in, keep token in sessionStorage only for redirect
          if (urlToken) {
            sessionStorage.setItem('pending_invite_token', urlToken);
          }
          setShowAuthModal(true);
        }
      } catch {
        if (urlToken) {
          sessionStorage.setItem('pending_invite_token', urlToken);
        }
        setShowAuthModal(true);
      } finally {
        setAuthChecking(false);
      }
    };
    checkAuth();
  }, [checkInviteToken]);

  // Fetch conversations when authenticated
  const fetchConversations = useCallback(async () => {
    if (!currentUser) return;
    try {
      const data = await apiRequest<{ conversations: Conversation[] }>('/api/conversations');
      setConversations(data.conversations);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      fetchConversations();
    }
  }, [currentUser, fetchConversations]);

  // Fetch messages when active conversation changes
  useEffect(() => {
    if (!currentUser || !activeConversationId) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      try {
        const data = await apiRequest<{ messages: Message[] }>(`/api/conversations/${activeConversationId}/messages`);
        setMessages(data.messages);

        // Mark as read in conversations list locally
        setConversations((prev) =>
          prev.map((c) => (c.id === activeConversationId ? { ...c, unreadCount: 0 } : c))
        );
      } catch (err) {
        console.error('Failed to load messages:', err);
      }
    };

    loadMessages();
  }, [activeConversationId, currentUser]);

  // WebSocket event listeners
  const socketEvents = {
    onNewMessage: (msg: Message) => {
      // If belongs to active chat, append message
      if (msg.conversationId === activeConversationId) {
        setMessages((prev) => [...prev, msg]);
        markAsRead(activeConversationId);
      }

      // Update sidebar conversation list
      setConversations((prev) => {
        let exists = false;
        const updated = prev.map((c) => {
          if (c.id === msg.conversationId) {
            exists = true;
            return {
              ...c,
              lastMessage: msg,
              unreadCount: msg.conversationId === activeConversationId ? 0 : c.unreadCount + 1,
            };
          }
          return c;
        });

        if (!exists) {
          fetchConversations();
        }

        return updated.sort((a, b) => {
          const timeA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
          const timeB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
          return timeB - timeA;
        });
      });
    },

    onMessageAck: ({ clientMsgId, message }: { clientMsgId: string; message: Message }) => {
      setMessages((prev) =>
        prev.map((m) => (m.clientMsgId === clientMsgId ? { ...message, pending: false } : m))
      );
    },

    onMessageDelivered: ({ clientMsgId, deliveredAt }: { clientMsgId: string; deliveredAt: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.clientMsgId === clientMsgId
            ? { ...m, deliveredAt: m.deliveredAt || deliveredAt }
            : m
        )
      );
    },

    onSyncResponse: ({ conversationId, messages: syncedMsgs }: { conversationId: string; messages: Message[] }) => {
      if (activeConversationId === conversationId) {
        setMessages((prev) => {
          const map = new Map<string, Message>();
          for (const m of prev) {
            map.set(m.clientMsgId || String(m.id), m);
          }
          for (const m of syncedMsgs) {
            map.set(m.clientMsgId || String(m.id), m);
          }
          return Array.from(map.values()).sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        });
      }
    },

    onUserPresence: ({ userId, status, lastSeen }: { userId: number; status: 'online' | 'offline'; lastSeen: string }) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.recipient && c.recipient.id === userId) {
            return {
              ...c,
              recipient: {
                ...c.recipient,
                isOnline: status === 'online',
                lastSeen,
              },
            };
          }
          return c;
        })
      );
    },

    onUserTyping: ({ conversationId, userId, isTyping }: { conversationId: string; userId: number; isTyping: boolean }) => {
      if (activeConversationId === conversationId && currentUser && userId !== currentUser.id) {
        setIsPartnerTyping(isTyping);
      }
    },

    onMessagesRead: ({ conversationId, readAt }: { conversationId: string; readAt: string }) => {
      if (activeConversationId === conversationId) {
        setMessages((prev) =>
          prev.map((m) => (m.readAt ? m : { ...m, readAt }))
        );
      }
    },

    onMessageUpdated: ({ messageId, conversationId, content, editedAt }: { messageId: number; conversationId: string; content: string; editedAt: string }) => {
      if (activeConversationId === conversationId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, content, editedAt } : m))
        );
      }
    },

    onMessageDeleted: ({ messageId, conversationId, forEveryone }: { messageId: number; conversationId: string; forEveryone: boolean }) => {
      if (activeConversationId === conversationId) {
        if (forEveryone) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? { ...m, isDeleted: true, content: 'This message was deleted', attachment: undefined, attachmentId: undefined }
                : m
            )
          );
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== messageId));
        }
      }
    },

    onMessageReaction: ({ messageId, conversationId, userId, emoji, action, oldEmoji }: { messageId: number; conversationId: string; userId: number; emoji: string; action: 'add' | 'remove' | 'change'; oldEmoji?: string }) => {
      if (activeConversationId === conversationId) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            let currentReactions = [...(m.reactions || [])];

            if (action === 'remove' || action === 'change') {
              const targetEmoji = action === 'remove' ? emoji : (oldEmoji || emoji);
              currentReactions = currentReactions
                .map((r) => {
                  if (r.emoji === targetEmoji) {
                    const nextUsers = (r.userIds || []).filter((u: number) => u !== userId);
                    return {
                      ...r,
                      count: Math.max(0, r.count - 1),
                      userIds: nextUsers,
                      userReacted: currentUser ? nextUsers.includes(currentUser.id) : false,
                    };
                  }
                  return r;
                })
                .filter((r) => r.count > 0);
            }

            if (action === 'add' || action === 'change') {
              const existing = currentReactions.find((r) => r.emoji === emoji);
              if (existing) {
                const nextUsers = Array.from(new Set([...(existing.userIds || []), userId]));
                currentReactions = currentReactions.map((r) =>
                  r.emoji === emoji
                    ? {
                        ...r,
                        count: nextUsers.length,
                        userIds: nextUsers,
                        userReacted: currentUser ? nextUsers.includes(currentUser.id) : false,
                      }
                    : r
                );
              } else {
                currentReactions.push({
                  emoji,
                  count: 1,
                  userIds: [userId],
                  userReacted: currentUser ? userId === currentUser.id : false,
                });
              }
            }

            return { ...m, reactions: currentReactions };
          })
        );
      }
    },

    onGroupEvent: (evt: any) => {
      if (evt.type === 'group:removed' || evt.type === 'group:deleted') {
        if (activeConversationId === evt.conversationId) {
          setActiveConversationId(null);
        }
      }
      fetchConversations();
    },
  };

  const { sendMessage, sendTypingStart, sendTypingStop, markAsRead } = useChatSocket(
    !!currentUser,
    activeConversationId,
    socketEvents
  );

  const handleSendMessage = (
    content: string,
    attachmentId?: string | null,
    attachment?: Attachment | null,
    replyToId?: number | null,
    replyQuote?: MessageQuote | null
  ) => {
    if (!activeConversationId || !currentUser) return;
    const optimisticMsg = sendMessage(
      activeConversationId,
      content,
      currentUser.id,
      attachmentId,
      attachment,
      replyToId,
      replyQuote
    );
    if (optimisticMsg) {
      setMessages((prev) => [...prev, optimisticMsg]);
    }
  };

  const handleEditMessage = async (messageId: number, newContent: string) => {
    const res = await apiRequest<{ id: number; content: string; editedAt: string }>(`/api/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: newContent }),
    });
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, content: res.content, editedAt: res.editedAt } : m))
    );
  };

  const handleDeleteMessage = async (messageId: number, mode: 'me' | 'everyone') => {
    await apiRequest(`/api/messages/${messageId}?mode=${mode}`, {
      method: 'DELETE',
    });
    if (mode === 'me') {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, isDeleted: true, content: 'This message was deleted', attachment: undefined, attachmentId: undefined }
            : m
        )
      );
    }
  };

  const handleReactMessage = async (messageId: number, emoji: string) => {
    await apiRequest<{ messageId: number; emoji: string; action: string; oldEmoji?: string }>(
      `/api/messages/${messageId}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }
    );
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Logout warning:', err);
    } finally {
      setCurrentUser(null);
      setConversations([]);
      setActiveConversationId(null);
      setMessages([]);
      setShowAuthModal(true);
    }
  };

  const handleInviteAccepted = (conversationId: string) => {
    setInviteToken(null);
    setInvitePreview(null);
    window.history.replaceState({}, '', '/');
    fetchConversations().then(() => {
      setActiveConversationId(conversationId);
    });
  };

  const handleBlockUser = async (userId: number) => {
    try {
      await apiRequest('/api/blocks', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      fetchConversations();
    } catch (err) {
      console.error('Failed to block user:', err);
    }
  };

  if (authChecking) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-[var(--bg-base)] text-[var(--text-muted)]">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent-terracotta)]" />
      </div>
    );
  }

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Auth Modal */}
      {(!currentUser || showAuthModal) && (
        <AuthModal
          onSuccess={(user) => {
            setCurrentUser(user);
            setShowAuthModal(false);
            const pendingToken = sessionStorage.getItem('pending_invite_token');
            if (pendingToken) {
              sessionStorage.removeItem('pending_invite_token');
              setInviteToken(pendingToken);
              checkInviteToken(pendingToken);
              window.history.replaceState({}, '', `/invite/${pendingToken}`);
            }
          }}
          inviteEmail={invitePreview?.inviterEmail}
          onOpenLegal={(type) => setLegalModalType(type)}
        />
      )}

      {/* Share Invite Modal (1:1 Direct Chat) */}
      <InviteModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
      />

      {/* Accept Invite Landing Modal */}
      {currentUser && inviteToken && (
        <InviteLandingModal
          token={inviteToken}
          preview={invitePreview}
          error={inviteError}
          currentUser={currentUser}
          onAccepted={handleInviteAccepted}
          onDismiss={() => {
            setInviteToken(null);
            setInvitePreview(null);
            setInviteError(null);
            sessionStorage.removeItem('pending_invite_token');
            window.history.replaceState({}, '', '/');
          }}
          onRequireAuth={() => setShowAuthModal(true)}
        />
      )}

      {/* New Group Modal */}
      <NewGroupModal
        isOpen={showNewGroupModal}
        onClose={() => setShowNewGroupModal(false)}
        onGroupCreated={(group) => {
          fetchConversations().then(() => {
            setActiveConversationId(group.id);
          });
        }}
      />

      {/* Group Info Modal */}
      {activeConversation && activeConversation.type === 'group' && currentUser && (
        <GroupInfoModal
          isOpen={showGroupInfoModal}
          onClose={() => setShowGroupInfoModal(false)}
          groupId={activeConversation.id}
          currentUser={currentUser}
          onGroupDeleted={() => {
            setActiveConversationId(null);
            fetchConversations();
          }}
          onLeftGroup={() => {
            setActiveConversationId(null);
            fetchConversations();
          }}
          onOpenReport={(userId, userName) => {
            setReportData({
              isOpen: true,
              reportedUserId: userId,
              reportedUserName: userName,
            });
          }}
        />
      )}

      {/* Blocked Users Modal */}
      <BlockedListModal
        isOpen={showBlockedModal}
        onClose={() => setShowBlockedModal(false)}
        onUnblocked={() => fetchConversations()}
      />

      {/* Report Modal */}
      {reportData && activeConversation && (
        <ReportModal
          isOpen={reportData.isOpen}
          onClose={() => setReportData(null)}
          reportedUserId={reportData.reportedUserId}
          reportedUserName={reportData.reportedUserName}
          conversationId={activeConversation.id}
          messageId={reportData.messageId}
        />
      )}

      {/* Edit Profile Modal */}
      {showEditProfileModal && currentUser && (
        <EditProfileModal
          currentUser={currentUser}
          onClose={() => setShowEditProfileModal(false)}
          onProfileUpdated={(updatedUser) => {
            setCurrentUser(updatedUser);
            setShowEditProfileModal(false);
          }}
        />
      )}

      {/* User Search Modal */}
      {showUserSearchModal && (
        <UserSearchModal
          onClose={() => setShowUserSearchModal(false)}
          onSelectUser={(u) => {
            setShowUserSearchModal(false);
            setViewProfileTarget({ userId: u.id, username: u.username });
          }}
        />
      )}

      {/* User Profile Modal */}
      {viewProfileTarget && currentUser && (
        <UserProfileModal
          username={viewProfileTarget.username}
          userId={viewProfileTarget.userId}
          currentUser={currentUser}
          onClose={() => setViewProfileTarget(null)}
          onOpenEditProfile={() => {
            setViewProfileTarget(null);
            setShowEditProfileModal(true);
          }}
          onOpenSettings={() => {
            setViewProfileTarget(null);
            setShowAccountSettingsModal(true);
          }}
          onOpenReport={(userId, userName) => {
            setReportData({
              isOpen: true,
              reportedUserId: userId,
              reportedUserName: userName,
            });
          }}
        />
      )}

      {/* Account Settings Modal */}
      {showAccountSettingsModal && currentUser && (
        <AccountSettingsModal
          currentUser={currentUser}
          onClose={() => setShowAccountSettingsModal(false)}
          onLogout={handleLogout}
          onEmailChanged={(newEmail) => {
            setCurrentUser((prev) => (prev ? { ...prev, email: newEmail } : null));
          }}
          onOpenLegal={(type) => setLegalModalType(type)}
        />
      )}

      {/* Legal Modal (Privacy Policy & Terms) */}
      {legalModalType && (
        <LegalModal
          type={legalModalType}
          onClose={() => setLegalModalType(null)}
        />
      )}

      {/* Main App Layout */}
      {currentUser && (
        <div className="flex w-full h-full">
          <Sidebar
            currentUser={currentUser}
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={(id) => {
              setActiveConversationId(id);
              setIsPartnerTyping(false);
            }}
            onOpenInviteModal={() => setShowInviteModal(true)}
            onOpenNewGroupModal={() => setShowNewGroupModal(true)}
            onOpenBlockedModal={() => setShowBlockedModal(true)}
            onOpenProfile={() => setShowEditProfileModal(true)}
            onOpenSearchUsers={() => setShowUserSearchModal(true)}
            onOpenSettings={() => setShowAccountSettingsModal(true)}
            onLogout={handleLogout}
            isDark={isDark}
            onToggleTheme={() => setIsDark((prev) => !prev)}
          />

          <div className={`${activeConversationId ? 'flex' : 'hidden md:flex'} flex-1 h-full`}>
            <ChatArea
              conversation={activeConversation}
              messages={messages}
              currentUser={currentUser}
              isPartnerTyping={isPartnerTyping}
              onSendMessage={handleSendMessage}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onReactMessage={handleReactMessage}
              onViewProfile={(target) => setViewProfileTarget(typeof target === 'number' ? { userId: target } : { username: target })}
              onTyping={(isTyping) => {
                if (activeConversationId) {
                  if (isTyping) sendTypingStart(activeConversationId);
                  else sendTypingStop(activeConversationId);
                }
              }}
              onMarkRead={(convoId) => markAsRead(convoId)}
              onBackToList={() => setActiveConversationId(null)}
              onOpenInviteModal={() => setShowInviteModal(true)}
              onOpenGroupInfo={() => setShowGroupInfoModal(true)}
              onOpenReport={(userId, userName, messageId) => {
                setReportData({
                  isOpen: true,
                  reportedUserId: userId,
                  reportedUserName: userName,
                  messageId,
                });
              }}
              onBlockUser={handleBlockUser}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
