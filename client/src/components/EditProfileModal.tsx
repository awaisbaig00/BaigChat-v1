import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api';
import type { User } from '../types';
import {
  X,
  Upload,
  Trash2,
  Check,
  Eye,
  Search,
  Clock,
  Sparkles,
} from 'lucide-react';

interface EditProfileModalProps {
  currentUser: User;
  onClose: () => void;
  onProfileUpdated: (updatedUser: User) => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  currentUser,
  onClose,
  onProfileUpdated,
}) => {
  const [displayName, setDisplayName] = useState(currentUser.displayName || '');
  const [username, setUsername] = useState(currentUser.username || '');
  const [bio, setBio] = useState(currentUser.bio || '');
  const [about, setAbout] = useState(currentUser.about || '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUser.avatarUrl || null);
  const [isDiscoverable, setIsDiscoverable] = useState(currentUser.isDiscoverable !== false);
  const [showOnline, setShowOnline] = useState(currentUser.showOnline !== false);
  const [showLastSeen, setShowLastSeen] = useState(currentUser.showLastSeen !== false);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Username availability check
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available?: boolean;
    reason?: string;
  } | null>(null);
  const checkTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!username.trim() || username.toLowerCase() === (currentUser.username || '').toLowerCase()) {
      setUsernameStatus(null);
      return;
    }

    if (checkTimeout.current) clearTimeout(checkTimeout.current);

    setUsernameStatus({ checking: true });
    checkTimeout.current = setTimeout(async () => {
      try {
        const res = await apiRequest<{ available: boolean; reason?: string }>(
          `/api/auth/username-available?u=${encodeURIComponent(username.trim())}`
        );
        setUsernameStatus({ checking: false, available: res.available, reason: res.reason });
      } catch {
        setUsernameStatus({ checking: false, available: false, reason: 'Check failed' });
      }
    }, 350);

    return () => {
      if (checkTimeout.current) clearTimeout(checkTimeout.current);
    };
  }, [username, currentUser.username]);

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('Avatar file must not exceed 2 MB');
      return;
    }

    setAvatarUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      // CSRF token check
      const csrfMatch = document.cookie.match(/baigchat_csrf=([^;]+)/);
      const csrfToken = csrfMatch ? csrfMatch[1] : '';

      const res = await fetch('/api/me/avatar', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to upload avatar');
      }

      const data = await res.json();
      setAvatarUrl(data.avatarUrl);
    } catch (err: any) {
      setError(err?.message || 'Failed to upload avatar');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarUploading(true);
    setError(null);
    try {
      await apiRequest('/api/me/avatar', { method: 'DELETE' });
      setAvatarUrl(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to remove avatar');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      // Update profile fields
      const profileData = await apiRequest<User>('/api/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: displayName.trim(),
          username: username.trim() !== currentUser.username ? username.trim() : undefined,
          bio: bio.trim(),
          about: about.trim(),
          isDiscoverable,
        }),
      });

      // Update privacy fields
      await apiRequest('/api/me/privacy', {
        method: 'PATCH',
        body: JSON.stringify({
          showOnline,
          showLastSeen,
        }),
      });

      setSuccess(true);
      onProfileUpdated({
        ...currentUser,
        displayName: profileData.displayName,
        username: profileData.username,
        bio: profileData.bio,
        about: profileData.about,
        avatarUrl,
        isDiscoverable,
        showOnline,
        showLastSeen,
      });

      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err: any) {
      setError(err?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Edit Profile</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4">
          {error && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl">
              {error}
            </div>
          )}

          {success && (
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-center gap-1.5">
              <Check className="w-4 h-4" /> Profile updated successfully!
            </div>
          )}

          {/* Avatar Section */}
          <div className="flex items-center gap-4 p-3 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-xl">
            <div className="relative shrink-0">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  className="w-14 h-14 rounded-full object-cover border border-[var(--border-strong)]"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-[var(--accent-soft)] text-[var(--accent-terracotta)] flex items-center justify-center text-xl font-serif-claude">
                  {(displayName || username || 'U')[0]?.toUpperCase()}
                </div>
              )}
            </div>

            <div className="flex-1 space-y-1.5">
              <div className="text-xs font-medium text-[var(--text-primary)]">Profile Photo</div>
              <div className="flex gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarFile}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={avatarUploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="py-1 px-2.5 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  {avatarUploading ? 'Uploading...' : 'Change'}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    disabled={avatarUploading}
                    onClick={handleRemoveAvatar}
                    className="py-1 px-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Display Name
            </label>
            <input
              type="text"
              required
              maxLength={50}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
            />
          </div>

          {/* Username */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                Username
              </label>
              {usernameStatus && !usernameStatus.checking && (
                <span
                  className={`text-[11px] ${
                    usernameStatus.available ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {usernameStatus.available ? 'Available' : usernameStatus.reason}
                </span>
              )}
            </div>
            <div className="relative">
              <span className="text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono">
                @
              </span>
              <input
                type="text"
                required
                maxLength={30}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="handle"
                className="w-full pl-7 pr-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none font-mono"
              />
            </div>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Max 3 username changes per 24 hours.
            </p>
          </div>

          {/* About / Status */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              About / Status
            </label>
            <div className="relative">
              <Sparkles className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                maxLength={60}
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder="e.g. Hey there! I am using BaigChat"
                className="w-full pl-8 pr-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
              />
            </div>
          </div>

          {/* Bio */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Bio</label>
              <span className="text-[10px] text-[var(--text-muted)]">{bio.length}/150</span>
            </div>
            <textarea
              maxLength={150}
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell others about yourself. Links are automatically clickable."
              className="w-full p-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none resize-none"
            />
          </div>

          {/* Privacy Controls */}
          <div className="pt-2 border-t border-[var(--border-subtle)] space-y-3">
            <div className="text-xs font-semibold text-[var(--text-primary)]">Privacy & Visibility</div>

            {/* Discoverability */}
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
                  Allow others to find me by username
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  If turned off, you won't appear in user search.
                </div>
              </div>
              <input
                type="checkbox"
                checked={isDiscoverable}
                onChange={(e) => setIsDiscoverable(e.target.checked)}
                className="mt-1 w-4 h-4 accent-[var(--accent-terracotta)] cursor-pointer"
              />
            </label>

            {/* Online Status (Reciprocal) */}
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  Show Online Status
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  If disabled, you will not see other users' online status (reciprocal).
                </div>
              </div>
              <input
                type="checkbox"
                checked={showOnline}
                onChange={(e) => setShowOnline(e.target.checked)}
                className="mt-1 w-4 h-4 accent-[var(--accent-terracotta)] cursor-pointer"
              />
            </label>

            {/* Last Seen (Reciprocal) */}
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  Show Last Seen Time
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  If disabled, you will not see other users' last seen times (reciprocal).
                </div>
              </div>
              <input
                type="checkbox"
                checked={showLastSeen}
                onChange={(e) => setShowLastSeen(e.target.checked)}
                className="mt-1 w-4 h-4 accent-[var(--accent-terracotta)] cursor-pointer"
              />
            </label>
          </div>

          {/* Action buttons */}
          <div className="pt-3 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-3 bg-[var(--bg-elevated)] hover:bg-[var(--bg-base)] text-[var(--text-secondary)] text-xs font-medium rounded-xl border border-[var(--border-subtle)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (usernameStatus ? !usernameStatus.available : false)}
              className="flex-1 py-2 px-3 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium rounded-xl transition-all shadow-md shadow-[var(--accent-terracotta)]/20 disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
