import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import type { User, ActiveSession } from '../types';
import {
  X,
  Shield,
  Smartphone,
  Laptop,
  AlertTriangle,
  Download,
  ExternalLink,
} from 'lucide-react';

interface AccountSettingsModalProps {
  currentUser: User;
  onClose: () => void;
  onLogout: () => void;
  onEmailChanged?: (newEmail: string) => void;
  onOpenLegal?: (type: 'privacy' | 'terms') => void;
}

export const AccountSettingsModal: React.FC<AccountSettingsModalProps> = ({
  currentUser,
  onClose,
  onLogout,
  onEmailChanged,
  onOpenLegal,
}) => {
  const [activeTab, setActiveTab] = useState<'security' | 'sessions' | 'data' | 'danger'>('security');
  const [exportLoading, setExportLoading] = useState(false);

  // Change Email state
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Change Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passLoading, setPassLoading] = useState(false);
  const [passMsg, setPassMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Active Sessions state
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Delete Account state
  const [deletePassword, setDeletePassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchSessions = async () => {
    setSessionsLoading(true);
    try {
      const data = await apiRequest<{ sessions: ActiveSession[] }>('/api/me/sessions');
      setSessions(data.sessions);
    } catch {
      // ignore
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'sessions') {
      fetchSessions();
    }
  }, [activeTab]);

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailLoading(true);
    setEmailMsg(null);

    try {
      await apiRequest('/api/me/email', {
        method: 'PATCH',
        body: JSON.stringify({ email: newEmail.trim(), currentPassword: emailPassword }),
      });
      setEmailMsg({ type: 'success', text: 'Email updated successfully.' });
      if (onEmailChanged) onEmailChanged(newEmail.trim());
      setNewEmail('');
      setEmailPassword('');
    } catch (err: any) {
      setEmailMsg({ type: 'error', text: err?.message || 'Failed to update email' });
    } finally {
      setEmailLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassLoading(true);
    setPassMsg(null);

    if (newPassword !== confirmPassword) {
      setPassMsg({ type: 'error', text: 'New passwords do not match' });
      setPassLoading(false);
      return;
    }

    try {
      await apiRequest('/api/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPassMsg({ type: 'success', text: 'Password updated. Other sessions logged out.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPassMsg({ type: 'error', text: err?.message || 'Failed to update password' });
    } finally {
      setPassLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await apiRequest(`/api/me/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions(sessions.filter((s) => s.id !== sessionId));
    } catch (err: any) {
      alert(err?.message || 'Failed to revoke session');
    }
  };

  const handleRevokeOthers = async () => {
    try {
      await apiRequest('/api/me/sessions/revoke-others', { method: 'POST' });
      setSessions(sessions.filter((s) => s.isCurrent));
    } catch (err: any) {
      alert(err?.message || 'Failed to revoke sessions');
    }
  };

  const handleDownloadData = async () => {
    setExportLoading(true);
    try {
      const res = await fetch('/api/me/export', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to export data');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `baigchat-data-export-${currentUser.username || currentUser.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.message || 'Failed to download data');
    } finally {
      setExportLoading(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      await apiRequest('/api/me/account', {
        method: 'DELETE',
        body: JSON.stringify({ password: deletePassword }),
      });
      onLogout();
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete account');
      setDeleteLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Shield className="w-4 h-4 text-[var(--accent-terracotta)]" />
            Account Settings
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="grid grid-cols-4 p-1 bg-[var(--bg-base)] border-b border-[var(--border-subtle)] text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className={`py-2 rounded-lg transition-all cursor-pointer ${
              activeTab === 'security'
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Security
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sessions')}
            className={`py-2 rounded-lg transition-all cursor-pointer ${
              activeTab === 'sessions'
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Sessions
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('data')}
            className={`py-2 rounded-lg transition-all cursor-pointer ${
              activeTab === 'data'
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Data & Privacy
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('danger')}
            className={`py-2 rounded-lg transition-all cursor-pointer ${
              activeTab === 'danger'
                ? 'bg-rose-500/10 text-rose-400 font-semibold shadow-sm'
                : 'text-rose-400/70 hover:text-rose-400'
            }`}
          >
            Danger
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 overflow-y-auto space-y-6">
          {activeTab === 'security' && (
            <div className="space-y-6">
              {/* Change Email */}
              <form onSubmit={handleChangeEmail} className="space-y-3 pb-5 border-b border-[var(--border-subtle)]">
                <div className="text-xs font-semibold text-[var(--text-primary)]">Change Email</div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  Current email: <span className="font-mono text-[var(--text-secondary)]">{currentUser.email}</span>
                </div>

                {emailMsg && (
                  <div
                    className={`p-2.5 text-xs rounded-xl ${
                      emailMsg.type === 'success'
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                    }`}
                  >
                    {emailMsg.text}
                  </div>
                )}

                <div className="space-y-2">
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="New email address"
                    className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] outline-none"
                  />
                  <input
                    type="password"
                    required
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    placeholder="Current password"
                    className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={emailLoading}
                  className="py-1.5 px-3 bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-medium rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                >
                  {emailLoading ? 'Updating...' : 'Update Email'}
                </button>
              </form>

              {/* Change Password */}
              <form onSubmit={handleChangePassword} className="space-y-3">
                <div className="text-xs font-semibold text-[var(--text-primary)]">Change Password</div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  Changing your password will automatically sign out all other devices.
                </div>

                {passMsg && (
                  <div
                    className={`p-2.5 text-xs rounded-xl ${
                      passMsg.type === 'success'
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                    }`}
                  >
                    {passMsg.text}
                  </div>
                )}

                <div className="space-y-2">
                  <input
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] outline-none"
                  />
                  <input
                    type="password"
                    required
                    minLength={10}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 10 characters)"
                    className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] outline-none"
                  />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={passLoading}
                  className="py-1.5 px-3 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium rounded-xl transition-all shadow-md shadow-[var(--accent-terracotta)]/20 disabled:opacity-50 cursor-pointer"
                >
                  {passLoading ? 'Updating...' : 'Change Password'}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'sessions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-[var(--text-primary)]">Logged-in Devices</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    Manage all browsers and devices active on your account.
                  </div>
                </div>
                {sessions.length > 1 && (
                  <button
                    type="button"
                    onClick={handleRevokeOthers}
                    className="py-1 px-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium rounded-xl border border-rose-500/20 transition-colors cursor-pointer"
                  >
                    Log out others
                  </button>
                )}
              </div>

              {sessionsLoading ? (
                <div className="py-8 text-center text-xs text-[var(--text-muted)] animate-pulse">
                  Loading sessions...
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="p-3 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-xl flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-secondary)]">
                          {s.userAgent.toLowerCase().includes('mobile') ? (
                            <Smartphone className="w-4 h-4" />
                          ) : (
                            <Laptop className="w-4 h-4" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-[var(--text-primary)] flex items-center gap-2">
                            <span className="truncate max-w-[200px]">{s.userAgent}</span>
                            {s.isCurrent && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                This device
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                            Last active: {new Date(s.lastActive).toLocaleString()}
                          </div>
                        </div>
                      </div>

                      {!s.isCurrent && (
                        <button
                          type="button"
                          onClick={() => handleRevokeSession(s.id)}
                          className="py-1 px-2 text-[11px] text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-4">
              <div className="p-4 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <Download className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0" />
                  Download My Data
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Export a complete machine-readable JSON backup containing your profile information, list of conversation memberships, and all messages you have sent.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadData}
                  disabled={exportLoading}
                  className="inline-flex items-center gap-2 py-2 px-3.5 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-sm disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exportLoading ? 'Exporting JSON...' : 'Download My Data (JSON)'}
                </button>
              </div>

              <div className="p-4 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <Shield className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0" />
                  Legal & Privacy Documents
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Review our platform policies, data handling standards, and service rules.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onOpenLegal?.('privacy')}
                    className="inline-flex items-center gap-1.5 py-1.5 px-3 bg-[var(--bg-surface)] hover:bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] transition-all cursor-pointer"
                  >
                    <span>Privacy Policy</span>
                    <ExternalLink className="w-3 h-3 text-[var(--text-muted)]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenLegal?.('terms')}
                    className="inline-flex items-center gap-1.5 py-1.5 px-3 bg-[var(--bg-surface)] hover:bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] transition-all cursor-pointer"
                  >
                    <span>Terms of Service</span>
                    <ExternalLink className="w-3 h-3 text-[var(--text-muted)]" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'danger' && (
            <div className="p-4 bg-rose-500/5 border border-rose-500/20 rounded-xl space-y-4">
              <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Delete Account
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Permanently delete your account and profile information. Your personal data, bio, and avatar will be removed, and your past messages will display as "Deleted User". This action cannot be undone.
              </p>

              {deleteError && (
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl">
                  {deleteError}
                </div>
              )}

              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-xl transition-all cursor-pointer"
                >
                  I want to delete my account
                </button>
              ) : (
                <form onSubmit={handleDeleteAccount} className="space-y-3 pt-2">
                  <div className="text-xs font-medium text-rose-400">
                    Please enter your password to confirm account deletion:
                  </div>
                  <input
                    type="password"
                    required
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full px-3 py-2 bg-[var(--bg-input)] border border-rose-500/30 focus:border-rose-500 rounded-xl text-xs text-[var(--text-primary)] outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="py-1.5 px-3 bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-xs rounded-xl cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={deleteLoading}
                      className="py-1.5 px-3 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {deleteLoading ? 'Deleting...' : 'Permanently Delete'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
