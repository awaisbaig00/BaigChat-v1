import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import type { BlockedUser } from '../types';
import { X, UserX, Loader2, UserCheck } from 'lucide-react';

interface BlockedListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnblocked?: (userId: number) => void;
}

export const BlockedListModal: React.FC<BlockedListModalProps> = ({
  isOpen,
  onClose,
  onUnblocked,
}) => {
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionUserId, setActionUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const fetchBlocked = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiRequest<{ blockedUsers: BlockedUser[] }>('/api/blocks');
        setBlockedUsers(data.blockedUsers || []);
      } catch (err: any) {
        setError(err?.message || 'Failed to load blocked users');
      } finally {
        setLoading(false);
      }
    };

    fetchBlocked();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUnblock = async (userId: number) => {
    setActionUserId(userId);
    try {
      await apiRequest(`/api/blocks/${userId}`, { method: 'DELETE' });
      setBlockedUsers((prev) => prev.filter((u) => u.id !== userId));
      onUnblocked?.(userId);
    } catch (err: any) {
      setError(err?.message || 'Failed to unblock user');
    } finally {
      setActionUserId(null);
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
          <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0">
            <UserX className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Blocked Users</h3>
            <p className="text-xs text-[var(--text-muted)]">Manage users you have blocked</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
            {error}
          </div>
        )}

        <div className="max-h-80 overflow-y-auto space-y-2">
          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-terracotta)]" />
            </div>
          ) : blockedUsers.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              You haven't blocked any users.
            </div>
          ) : (
            blockedUsers.map((u) => (
              <div
                key={u.id}
                className="p-3 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] flex items-center justify-between gap-3"
              >
                <div className="truncate">
                  <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                    {u.name || u.email.split('@')[0]}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] truncate">{u.email}</div>
                </div>

                <button
                  onClick={() => handleUnblock(u.id)}
                  disabled={actionUserId === u.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-elevated)] hover:bg-[var(--border-strong)] text-[var(--text-primary)] transition-colors disabled:opacity-50 flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  {actionUserId === u.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span>Unblock</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
