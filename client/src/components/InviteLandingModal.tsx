import React, { useState } from 'react';
import { apiRequest } from '../api';
import type { User, InvitePreview } from '../types';
import { MessageSquare, Check, ShieldAlert, Loader2 } from 'lucide-react';


interface InviteLandingModalProps {
  token: string;
  preview: InvitePreview | null;
  error: string | null;
  currentUser: User | null;
  onAccepted: (conversationId: string) => void;
  onDismiss: () => void;
  onRequireAuth: () => void;
}

export const InviteLandingModal: React.FC<InviteLandingModalProps> = ({
  token,
  preview,
  error,
  currentUser,
  onAccepted,
  onDismiss,
  onRequireAuth,
}) => {
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }

    setAccepting(true);
    setAcceptError(null);

    try {
      const data = await apiRequest<{ conversationId: string }>(`/api/invites/${token}/accept`, {
        method: 'POST',
      });
      onAccepted(data.conversationId);
    } catch (err: any) {
      setAcceptError(err?.message || 'Failed to accept invitation');
    } finally {
      setAccepting(false);
    }
  };

  const [declining, setDeclining] = useState(false);

  const handleDecline = async () => {
    setDeclining(true);
    try {
      await apiRequest(`/api/invites/${token}/decline`, { method: 'POST' });
    } catch {
      // Ignore errors on decline
    } finally {
      setDeclining(false);
      onDismiss();
    }
  };

  const isOwnInvite = currentUser && preview && currentUser.id === preview.inviterId;
  const inviterName = preview ? (preview.inviterName || preview.inviterEmail.split('@')[0]) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl p-7 shadow-2xl transition-all">
        {/* Error State */}
        {error ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-400 mx-auto flex items-center justify-center mb-4">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h2 className="font-serif-claude text-2xl font-medium text-[var(--text-primary)] mb-2">
              Invalid Invite Link
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              {error}
            </p>
            <button
              onClick={onDismiss}
              className="w-full py-2.5 px-4 bg-[var(--bg-elevated)] hover:bg-[var(--border-strong)] text-[var(--text-primary)] rounded-xl text-sm font-medium transition-colors cursor-pointer"
            >
              Back to BaigChat
            </button>
          </div>
        ) : preview ? (
          <div className="text-center">
            {/* Logo */}
            <div className="w-14 h-14 rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-terracotta)] mx-auto flex items-center justify-center mb-4">
              <MessageSquare className="w-7 h-7" />
            </div>

            <h2 className="font-serif-claude text-2xl font-medium text-[var(--text-primary)] mb-2">
              {preview.isGroup
                ? `Join "${preview.groupName || 'Group Chat'}"`
                : `${inviterName} invited you to chat`}
            </h2>

            <p className="text-sm text-[var(--text-secondary)] mb-6">
              {preview.isGroup
                ? `Invited by ${inviterName} • ${preview.memberCount || 1} members`
                : `Connect in a private 1-on-1 direct conversation with `}
              {!preview.isGroup && (
                <span className="font-semibold text-[var(--accent-terracotta)]">
                  {preview.inviterEmail}
                </span>
              )}
            </p>

            {isOwnInvite ? (
              <div className="p-4 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-secondary)] mb-6">
                You created this invite link. Share it with someone else to connect with them!
              </div>
            ) : acceptError ? (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl mb-6">
                {acceptError}
              </div>
            ) : null}

            {/* Actions */}
            <div className="space-y-3">
              {isOwnInvite ? (
                <button
                  onClick={onDismiss}
                  className="w-full py-3 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white rounded-xl text-sm font-medium transition-colors cursor-pointer"
                >
                  Return to Messages
                </button>
              ) : currentUser ? (
                <>
                  <button
                    id="accept-invite-btn"
                    onClick={handleAccept}
                    disabled={accepting || declining}
                    className="w-full py-3 px-4 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] active:scale-[0.99] text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 shadow-lg shadow-[var(--accent-terracotta)]/20 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {accepting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Connecting...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Accept</span>
                      </>
                    )}
                  </button>

                  <button
                    id="decline-invite-btn"
                    onClick={handleDecline}
                    disabled={accepting || declining}
                    className="w-full py-2.5 px-4 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded-xl transition-colors cursor-pointer"
                  >
                    {declining ? 'Declining...' : 'Decline'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={onRequireAuth}
                    className="w-full py-3 px-4 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 shadow-lg shadow-[var(--accent-terracotta)]/20 transition-all cursor-pointer"
                  >
                    <span>Sign In or Sign Up to Accept</span>
                  </button>
                  <button
                    onClick={onDismiss}
                    className="w-full py-2.5 px-4 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-terracotta)] mb-2" />
            <span className="text-sm">Verifying invitation...</span>
          </div>
        )}
      </div>
    </div>
  );
};
