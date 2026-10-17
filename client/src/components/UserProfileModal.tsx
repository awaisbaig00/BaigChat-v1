import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import type { UserProfile, User } from '../types';
import {
  X,
  Share2,
  Check,
  MessageCircle,
  ShieldAlert,
  Ban,
  Edit3,
  Settings,
  Images,
  Users,
  Copy,
  Clock,
} from 'lucide-react';

interface UserProfileModalProps {
  username?: string | null;
  userId?: number | null;
  currentUser: User;
  onClose: () => void;
  onStartChat?: (userId: number) => void;
  onOpenEditProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenReport?: (userId: number, userName: string) => void;
  onBlockToggled?: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  username,
  userId,
  currentUser,
  onClose,
  onStartChat,
  onOpenEditProfile,
  onOpenSettings,
  onOpenReport,
  onBlockToggled,
}) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Deterministic background color from string hash
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

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    const fetchProfile = async () => {
      try {
        let endpoint = '';
        if (username) {
          endpoint = `/api/users/${encodeURIComponent(username)}`;
        } else if (userId === currentUser.id) {
          endpoint = `/api/me`;
        } else if (userId) {
          // If we only have userId, search or load via /api/users/
          endpoint = `/api/users/${userId}`;
        }

        if (!endpoint) return;

        const data = await apiRequest<UserProfile>(endpoint);
        if (isMounted) {
          setProfile({
            ...data,
            isSelf: data.id === currentUser.id,
          });
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'User profile not found');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchProfile();
    return () => {
      isMounted = false;
    };
  }, [username, userId, currentUser.id]);

  const handleCopyLink = () => {
    if (!profile) return;
    const url = `${window.location.origin}/u/${profile.username}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleToggleBlock = async () => {
    if (!profile) return;
    setActionLoading(true);
    try {
      if (profile.isBlocked) {
        await apiRequest(`/api/blocks/${profile.id}`, { method: 'DELETE' });
        setProfile({ ...profile, isBlocked: false });
      } else {
        await apiRequest('/api/blocks', {
          method: 'POST',
          body: JSON.stringify({ userId: profile.id }),
        });
        setProfile({ ...profile, isBlocked: true });
      }
      if (onBlockToggled) onBlockToggled();
    } catch (err: any) {
      alert(err?.message || 'Failed to update block state');
    } finally {
      setActionLoading(false);
    }
  };

  // Helper to render text with clickable URLs
  const renderBio = (text: string) => {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-terracotta)] hover:underline break-all"
          >
            {part}
          </a>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
          <div className="text-xs font-medium text-[var(--text-secondary)]">
            {profile?.isSelf ? 'Your Profile' : `@${profile?.username || 'Profile'}`}
          </div>
          <div className="flex items-center gap-1">
            {profile && (
              <button
                type="button"
                onClick={handleCopyLink}
                title="Copy profile link"
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
              >
                {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--text-muted)] animate-pulse">
              Loading profile...
            </div>
          ) : error || !profile ? (
            <div className="py-10 text-center space-y-2">
              <div className="text-sm font-medium text-rose-400">User Not Found</div>
              <p className="text-xs text-[var(--text-muted)]">
                {error || 'This user does not exist or has set their profile to private.'}
              </p>
            </div>
          ) : (
            <>
              {/* Instagram-Style Header */}
              <div className="flex items-center gap-5">
                {/* Avatar with Status Ring */}
                <div className="relative shrink-0">
                  <div
                    className={`p-0.5 rounded-full ${
                      profile.isOnline
                        ? 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-[var(--bg-surface)]'
                        : 'ring-1 ring-[var(--border-subtle)]'
                    }`}
                  >
                    {profile.avatarUrl ? (
                      <img
                        src={profile.fullAvatarUrl || profile.avatarUrl}
                        alt={profile.displayName}
                        className="w-20 h-20 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-serif-claude ${getAvatarBg(
                          profile.displayName || profile.username
                        )}`}
                      >
                        {(profile.displayName || profile.username)[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  {profile.isOnline && (
                    <span
                      title="Online now"
                      className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 border-2 border-[var(--bg-surface)] rounded-full"
                    />
                  )}
                </div>

                {/* Identity */}
                <div className="flex-1 min-w-0 space-y-1">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)] truncate font-serif-claude">
                    {profile.displayName}
                  </h2>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-mono">
                    <span>@{profile.username}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(`@${profile.username}`);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      title="Copy handle"
                      className="hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  {profile.isOnline ? (
                    <span className="inline-block text-[11px] font-medium text-emerald-400">
                      Active now
                    </span>
                  ) : profile.lastSeen ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                      <Clock className="w-3 h-3" /> Last active {new Date(profile.lastSeen).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Status / About Pill */}
              {profile.about && (
                <div className="px-3 py-1.5 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-secondary)] italic">
                  "{profile.about}"
                </div>
              )}

              {/* Bio with linkified URLs */}
              {profile.bio && (
                <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                  {renderBio(profile.bio)}
                </div>
              )}

              {/* Mutual Stats Row */}
              {!profile.isSelf && (
                <div className="grid grid-cols-2 gap-3 py-3 px-4 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-xl text-center">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center justify-center gap-1">
                      <Users className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
                      {profile.mutualConversationsCount || 0}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Mutual Chats</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center justify-center gap-1">
                      <Images className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
                      {profile.sharedMediaCount || 0}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Shared Media</div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 space-y-2">
                {profile.isSelf ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        if (onOpenEditProfile) onOpenEditProfile();
                      }}
                      className="flex-1 py-2 px-3 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        if (onOpenSettings) onOpenSettings();
                      }}
                      className="py-2 px-3 bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Settings
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        if (onStartChat) onStartChat(profile.id);
                      }}
                      className="w-full py-2.5 px-3 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md shadow-[var(--accent-terracotta)]/20 cursor-pointer"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Send Message
                    </button>

                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={handleToggleBlock}
                        className={`flex-1 py-2 px-3 border text-xs font-medium rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          profile.isBlocked
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                            : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-rose-400'
                        }`}
                      >
                        <Ban className="w-3.5 h-3.5" />
                        {profile.isBlocked ? 'Unblock User' : 'Block User'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          if (onOpenReport) onOpenReport(profile.id, profile.displayName);
                        }}
                        className="py-2 px-3 bg-[var(--bg-elevated)] hover:bg-rose-500/10 border border-[var(--border-subtle)] hover:border-rose-500/30 text-[var(--text-secondary)] hover:text-rose-400 text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Report
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
