import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { Copy, Check, X, Link as LinkIcon, Clock, ShieldCheck, Loader2 } from 'lucide-react';

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InviteModal: React.FC<InviteModalProps> = ({ isOpen, onClose }) => {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      generateInvite();
    } else {
      setInviteUrl(null);
      setCopied(false);
      setError(null);
    }
  }, [isOpen]);

  const generateInvite = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ token: string; link?: string; inviteUrl?: string; expiresAt: string }>('/api/invites', {
        method: 'POST',
        body: JSON.stringify({ maxUses: 1 }),
      });
      const url = data.inviteUrl || data.link || `${window.location.origin}/invite/${data.token}`;
      setInviteUrl(url);
    } catch (err: any) {
      setError(err?.message || 'Failed to create invite link');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback to select-and-copy
      const input = document.createElement('input');
      input.value = inviteUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl p-6 shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[var(--accent-soft)] text-[var(--accent-terracotta)]">
              <LinkIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif-claude text-xl font-medium text-[var(--text-primary)]">
                Invite to Chat
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Create a private 1-on-1 direct conversation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="py-6 space-y-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-terracotta)] mb-2" />
              <span className="text-sm">Generating secure invite link...</span>
            </div>
          )}

          {error && (
            <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={generateInvite}
                className="underline hover:no-underline font-medium ml-2 cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {inviteUrl && (
            <>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">
                  Share this unique link
                </label>
                <div className="flex items-center gap-2 p-1.5 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-xl">
                  <input
                    id="invite-link-input"
                    type="text"
                    readOnly
                    value={inviteUrl}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="w-full bg-transparent px-3 py-2 text-xs font-mono text-[var(--text-primary)] outline-none selection:bg-[var(--accent-terracotta)]/30"
                  />
                  <button
                    id="copy-link-btn"
                    onClick={copyToClipboard}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer ${
                      copied
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white shadow-sm'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Explanatory bullet points */}
              <div className="space-y-2 text-xs text-[var(--text-secondary)] pt-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0" />
                  <span>Valid for 24 hours from creation</span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0" />
                  <span>Single-use link &bull; Creates an encrypted 1:1 room on acceptance</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-[var(--border-subtle)] flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>
          {inviteUrl && (
            <button
              onClick={generateInvite}
              className="px-4 py-2 text-xs font-medium text-[var(--accent-terracotta)] hover:bg-[var(--accent-soft)] rounded-xl transition-colors cursor-pointer"
            >
              Generate New Link
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
