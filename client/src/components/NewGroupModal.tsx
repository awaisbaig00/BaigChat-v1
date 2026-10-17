import React, { useState } from 'react';
import { apiRequest } from '../api';
import type { Conversation } from '../types';
import { X, Users, Loader2 } from 'lucide-react';

interface NewGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGroupCreated: (group: Conversation) => void;
}

export const NewGroupModal: React.FC<NewGroupModalProps> = ({
  isOpen,
  onClose,
  onGroupCreated,
}) => {
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = groupName.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    if (!sanitized) {
      setError('Group name cannot be empty');
      return;
    }
    if (sanitized.length > 60) {
      setError('Group name must not exceed 60 characters');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<{ group: any }>('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name: sanitized }),
      });

      const newConvo: Conversation = {
        id: data.group.id,
        type: 'group',
        name: data.group.name,
        title: data.group.name,
        role: 'owner',
        memberCount: 1,
        createdAt: data.group.createdAt || new Date().toISOString(),
        recipient: null,
        lastMessage: null,
        unreadCount: 0,
      };

      setGroupName('');
      onGroupCreated(newConvo);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create group');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl p-6 shadow-2xl relative text-[var(--text-primary)]">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] text-[var(--accent-terracotta)] flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">New Group</h3>
            <p className="text-xs text-[var(--text-muted)]">Create a group chat for up to 100 members</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Group Name</label>
              <span className="text-[10px] text-[var(--text-muted)]">{groupName.length}/60</span>
            </div>
            <input
              type="text"
              required
              maxLength={60}
              placeholder="e.g. Project Alpha, Design Team"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors"
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !groupName.trim()}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white shadow-md shadow-[var(--accent-terracotta)]/20 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Create Group</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
