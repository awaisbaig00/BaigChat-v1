import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api';
import { Search, X, User as UserIcon } from 'lucide-react';

interface UserSearchModalProps {
  onClose: () => void;
  onSelectUser: (user: { id: number; username: string; displayName: string }) => void;
}

export const UserSearchModal: React.FC<UserSearchModalProps> = ({ onClose, onSelectUser }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: number; username: string; displayName: string; avatarUrl?: string | null }>>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiRequest<{
          users: Array<{ id: number; username: string; displayName: string; avatarUrl?: string | null }>;
        }>(`/api/users/search?q=${encodeURIComponent(trimmed)}`);
        setResults(data.users || []);
        setSearched(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Search className="w-4 h-4 text-[var(--accent-terracotta)]" />
            Find Users
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search input */}
        <div className="p-4 border-b border-[var(--border-subtle)]">
          <div className="relative">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by @username or name (min 3 chars)..."
              className="w-full pl-10 pr-4 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
            />
          </div>
        </div>

        {/* Results List */}
        <div className="p-4 overflow-y-auto space-y-2 flex-1">
          {loading ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)] animate-pulse">
              Searching users...
            </div>
          ) : results.length > 0 ? (
            results.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  onSelectUser(u);
                  onClose();
                }}
                className="w-full p-2.5 rounded-xl hover:bg-[var(--bg-elevated)] flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  {u.avatarUrl ? (
                    <img
                      src={u.avatarUrl}
                      alt={u.displayName}
                      className="w-10 h-10 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-serif-claude shrink-0 ${getAvatarBg(
                        u.displayName || u.username
                      )}`}
                    >
                      {(u.displayName || u.username)[0]?.toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {u.displayName}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] font-mono">
                      @{u.username}
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-[var(--accent-terracotta)] font-medium flex items-center gap-1">
                  <UserIcon className="w-3.5 h-3.5" />
                  View
                </div>
              </button>
            ))
          ) : searched ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              No discoverable users found matching "{query}"
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              Type at least 3 characters to search discoverable users.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
