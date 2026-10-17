import React, { useState } from 'react';
import type { Conversation, User } from '../types';
import { ThemeToggle } from './ThemeToggle';
import {
  UserPlus,
  Users,
  Search,
  LogOut,
  MessageSquare,
  UserX,
  Settings,
  UserSearch,
} from 'lucide-react';

interface SidebarProps {
  currentUser: User;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onOpenInviteModal: () => void;
  onOpenNewGroupModal: () => void;
  onOpenBlockedModal: () => void;
  onOpenProfile?: () => void;
  onOpenSearchUsers?: () => void;
  onOpenSettings?: () => void;
  onLogout: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentUser,
  conversations,
  activeConversationId,
  onSelectConversation,
  onOpenInviteModal,
  onOpenNewGroupModal,
  onOpenBlockedModal,
  onOpenProfile,
  onOpenSearchUsers,
  onOpenSettings,
  onLogout,
  isDark,
  onToggleTheme,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const getAvatarBg = (name: string): string => {
    const colors = [
      'bg-indigo-600',
      'bg-violet-600',
      'bg-emerald-600',
      'bg-amber-600',
      'bg-rose-600',
      'bg-sky-600',
      'bg-teal-600',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const filteredConversations = conversations.filter((c) => {
    const q = searchQuery.toLowerCase();
    if (c.type === 'group') {
      return (c.name || c.title || '').toLowerCase().includes(q);
    }
    if (c.recipient) {
      const emailMatch = c.recipient.email.toLowerCase().includes(q);
      const nameMatch = c.recipient.name ? c.recipient.name.toLowerCase().includes(q) : false;
      const userMatch = c.recipient.username ? c.recipient.username.toLowerCase().includes(q) : false;
      return emailMatch || nameMatch || userMatch;
    }
    return false;
  });

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <aside
      className={`${
        activeConversationId ? 'hidden md:flex' : 'flex'
      } w-full md:w-88 flex-col h-full bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] shrink-0 select-none`}
    >
      {/* Top Header / User Profile */}
      <div className="p-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpenProfile}
          title="View your profile"
          className="flex items-center gap-2.5 overflow-hidden text-left hover:bg-[var(--bg-elevated)] p-1.5 rounded-xl transition-colors cursor-pointer min-w-0 flex-1"
        >
          <div className="relative shrink-0">
            {currentUser.avatarUrl ? (
              <img
                src={currentUser.avatarUrl}
                alt={currentUser.displayName || currentUser.username || 'User'}
                className="w-9 h-9 rounded-xl object-cover border border-[var(--border-subtle)]"
              />
            ) : (
              <div
                className={`w-9 h-9 rounded-xl text-white font-medium flex items-center justify-center text-sm shadow-sm ${getAvatarBg(
                  currentUser.displayName || currentUser.username || currentUser.email
                )}`}
              >
                {(currentUser.displayName || currentUser.username || currentUser.email).charAt(0).toUpperCase()}
              </div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[var(--bg-surface)]" />
          </div>

          <div className="truncate min-w-0">
            <div className="text-xs font-semibold text-[var(--text-primary)] truncate font-serif-claude">
              {currentUser.displayName || currentUser.username || currentUser.email.split('@')[0]}
            </div>
            <div className="text-[10px] text-[var(--text-muted)] truncate font-mono">
              @{currentUser.username || currentUser.email.split('@')[0]}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          {onOpenSearchUsers && (
            <button
              onClick={onOpenSearchUsers}
              title="Find Users"
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              <UserSearch className="w-4 h-4" />
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="Account Settings"
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onOpenBlockedModal}
            title="Blocked Users"
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <UserX className="w-4 h-4" />
          </button>
          <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
          <button
            onClick={onLogout}
            title="Log Out"
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-rose-400 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Action buttons: Share Invite Link + New Group */}
      <div className="p-3 grid grid-cols-2 gap-2">
        <button
          onClick={onOpenInviteModal}
          className="py-2 px-2.5 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] active:scale-[0.99] text-white rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 shadow-md shadow-[var(--accent-terracotta)]/15 transition-all cursor-pointer truncate"
        >
          <UserPlus className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Invite</span>
        </button>
        <button
          onClick={onOpenNewGroupModal}
          className="py-2 px-2.5 bg-[var(--bg-elevated)] hover:bg-[var(--border-strong)] active:scale-[0.99] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer truncate"
        >
          <Users className="w-3.5 h-3.5 shrink-0 text-[var(--accent-terracotta)]" />
          <span className="truncate">New Group</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-lg text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors"
          />
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1 py-1">
        {filteredConversations.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] text-[var(--accent-terracotta)] mx-auto flex items-center justify-center mb-3">
              <MessageSquare className="w-5 h-5" />
            </div>
            <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">
              {searchQuery ? 'No conversations found' : 'No chats yet'}
            </p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {searchQuery
                ? 'Try a different search term'
                : 'Click "Invite" or "New Group" to get started'}
            </p>
          </div>
        ) : (
          filteredConversations.map((convo) => {
            const isActive = convo.id === activeConversationId;
            const isGroup = convo.type === 'group';

            const displayName = isGroup
              ? convo.title || convo.name || 'Group Chat'
              : convo.recipient
              ? convo.recipient.name || convo.recipient.username || convo.recipient.email.split('@')[0]
              : 'Direct Chat';

            const initial = displayName.charAt(0).toUpperCase();

            return (
              <div
                key={convo.id}
                onClick={() => onSelectConversation(convo.id)}
                className={`p-3 rounded-xl flex items-center gap-3 transition-colors duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-[var(--bg-elevated)] border border-[var(--border-strong)]'
                    : 'hover:bg-[var(--bg-elevated)]/60 border border-transparent'
                }`}
              >
                {/* Avatar with presence dot */}
                <div className="relative shrink-0">
                  {isGroup ? (
                    <div className="w-10 h-10 rounded-xl border flex items-center justify-center text-sm font-medium bg-[var(--accent-soft)] text-[var(--accent-terracotta)] border-[var(--accent-terracotta)]/20">
                      <Users className="w-5 h-5" />
                    </div>
                  ) : convo.recipient?.avatarUrl ? (
                    <img
                      src={convo.recipient.avatarUrl}
                      alt={displayName}
                      className="w-10 h-10 rounded-xl object-cover border border-[var(--border-subtle)]"
                    />
                  ) : (
                    <div
                      className={`w-10 h-10 rounded-xl border flex items-center justify-center text-sm font-medium text-white ${getAvatarBg(
                        displayName
                      )}`}
                    >
                      {initial}
                    </div>
                  )}

                  {!isGroup && convo.recipient?.isOnline && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[var(--bg-surface)] ring-1 ring-emerald-500/30" />
                  )}
                </div>

                {/* Info & preview */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {displayName}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0 ml-1">
                      {formatTime(convo.lastMessage?.createdAt || convo.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {convo.lastMessage ? (
                        <>
                          {convo.lastMessage.isDeleted ? (
                            <span className="italic text-[var(--text-muted)]">
                              This message was deleted
                            </span>
                          ) : convo.lastMessage.type === 'system' ? (
                            <span className="italic text-[var(--text-muted)]">
                              {convo.lastMessage.content}
                            </span>
                          ) : (
                            <>
                              {convo.lastMessage.senderId === currentUser.id ? 'You: ' : ''}
                              {convo.lastMessage.content}
                            </>
                          )}
                        </>
                      ) : (
                        <span className="italic text-[var(--text-muted)]">
                          {isGroup ? 'Group created' : 'Room created'}
                        </span>
                      )}
                    </p>

                    {convo.unreadCount > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 bg-[var(--accent-terracotta)] text-white text-[10px] font-bold rounded-full shrink-0">
                        {convo.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
