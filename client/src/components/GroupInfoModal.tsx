import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import type { GroupMember, User } from '../types';
import {
  X,
  Shield,
  ShieldCheck,
  UserCheck,
  UserMinus,
  LogOut,
  Trash2,
  Share2,
  Copy,
  Check,
  MoreVertical,
  Loader2,
  ShieldAlert,
  UserX,
  Edit2,
} from 'lucide-react';

interface GroupInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  currentUser: User;
  onGroupDeleted?: (groupId: string) => void;
  onLeftGroup?: (groupId: string) => void;
  onOpenReport?: (userId: number, userName: string) => void;
}

export const GroupInfoModal: React.FC<GroupInfoModalProps> = ({
  isOpen,
  onClose,
  groupId,
  currentUser,
  onGroupDeleted,
  onLeftGroup,
  onOpenReport,
}) => {
  const [groupDetails, setGroupDetails] = useState<{
    id: string;
    name: string;
    createdBy: number;
    role: 'owner' | 'admin' | 'member';
    members: GroupMember[];
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit name state
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameLoading, setNameLoading] = useState(false);

  // Group invite state
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Member menu dropdown active memberId
  const [activeMenuMemberId, setActiveMenuMemberId] = useState<number | null>(null);

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = useState<{
    type: 'leave' | 'delete' | 'remove';
    targetUserId?: number;
    targetUserName?: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchGroup = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest(`/api/groups/${groupId}`);
      setGroupDetails(data);
      setNewName(data.name);
    } catch (err: any) {
      setError(err?.message || 'Failed to load group details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchGroup();
      setInviteLink(null);
      setCopied(false);
      setIsEditingName(false);
      setActiveMenuMemberId(null);
      setConfirmAction(null);
    }
  }, [isOpen, groupId]);

  if (!isOpen) return null;

  const myRole = groupDetails?.role || 'member';
  const isOwner = myRole === 'owner';
  const isAdminOrOwner = isOwner || myRole === 'admin';

  // Handle Edit Name
  const handleSaveName = async () => {
    const sanitized = newName.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    if (!sanitized || sanitized.length > 60) return;

    setNameLoading(true);
    try {
      await apiRequest(`/api/groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: sanitized }),
      });
      setIsEditingName(false);
      fetchGroup();
    } catch (err: any) {
      setError(err?.message || 'Failed to update group name');
    } finally {
      setNameLoading(false);
    }
  };

  // Generate Group Invite
  const handleGenerateInvite = async () => {
    setInviteLoading(true);
    try {
      const data = await apiRequest(`/api/groups/${groupId}/invites`, {
        method: 'POST',
        body: JSON.stringify({ maxUses: 20 }),
      });
      setInviteLink(data.link || data.inviteUrl);
    } catch (err: any) {
      setError(err?.message || 'Failed to create invite link');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInvite = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Role promotion / demotion
  const handleUpdateRole = async (targetUserId: number, newRole: 'admin' | 'member') => {
    setActiveMenuMemberId(null);
    try {
      await apiRequest(`/api/groups/${groupId}/members/${targetUserId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      fetchGroup();
    } catch (err: any) {
      setError(err?.message || 'Failed to update role');
    }
  };

  // Block User directly
  const handleBlockUser = async (targetUserId: number) => {
    setActiveMenuMemberId(null);
    try {
      await apiRequest('/api/blocks', {
        method: 'POST',
        body: JSON.stringify({ userId: targetUserId }),
      });
      fetchGroup();
    } catch (err: any) {
      setError(err?.message || 'Failed to block user');
    }
  };

  // Execute confirmed actions (leave, delete, remove member)
  const handleExecuteConfirm = async () => {
    if (!confirmAction) return;
    setActionLoading(true);

    try {
      if (confirmAction.type === 'delete') {
        await apiRequest(`/api/groups/${groupId}`, { method: 'DELETE' });
        onGroupDeleted?.(groupId);
        onClose();
      } else if (confirmAction.type === 'leave') {
        await apiRequest(`/api/groups/${groupId}/leave`, { method: 'POST' });
        onLeftGroup?.(groupId);
        onClose();
      } else if (confirmAction.type === 'remove' && confirmAction.targetUserId) {
        await apiRequest(`/api/groups/${groupId}/members/${confirmAction.targetUserId}`, {
          method: 'DELETE',
        });
        setConfirmAction(null);
        fetchGroup();
      }
    } catch (err: any) {
      setError(err?.message || 'Action failed');
      setConfirmAction(null);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl p-6 shadow-2xl relative text-[var(--text-primary)] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-[var(--border-subtle)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[var(--accent-terracotta)] text-white font-semibold flex items-center justify-center text-lg shadow-sm shrink-0">
              {groupDetails?.name ? groupDetails.name.charAt(0).toUpperCase() : 'G'}
            </div>
            <div>
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={60}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="px-2.5 py-1 bg-[var(--bg-base)] border border-[var(--accent-terracotta)] rounded-lg text-xs font-semibold text-[var(--text-primary)] outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={nameLoading}
                    className="px-2 py-1 bg-[var(--accent-terracotta)] text-white rounded-lg text-[11px] font-medium cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setIsEditingName(false)}
                    className="px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-[11px] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-[var(--text-primary)] truncate max-w-[240px]">
                    {groupDetails?.name || 'Group Chat'}
                  </h3>
                  {isAdminOrOwner && (
                    <button
                      onClick={() => setIsEditingName(true)}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-terracotta)] transition-colors cursor-pointer"
                      title="Edit group name"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-[var(--text-muted)]">
                {groupDetails?.members.length || 0} members • Your role:{' '}
                <span className="capitalize text-[var(--accent-terracotta)] font-medium">{myRole}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="my-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs shrink-0">
            {error}
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-5">
          {/* Group Invite Link Section (Owner/Admin only) */}
          {isAdminOrOwner && (
            <div className="p-3.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <Share2 className="w-4 h-4 text-[var(--accent-terracotta)]" />
                  <span>Group Invite Link</span>
                </div>
                {!inviteLink && (
                  <button
                    onClick={handleGenerateInvite}
                    disabled={inviteLoading}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--accent-terracotta)] text-white hover:bg-[var(--accent-hover)] transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {inviteLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>Create link</span>
                  </button>
                )}
              </div>

              {inviteLink && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    readOnly
                    value={inviteLink}
                    className="flex-1 px-3 py-1.5 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg text-xs text-[var(--text-secondary)] select-all outline-none"
                  />
                  <button
                    onClick={handleCopyInvite}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] text-white flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Members List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                Members ({groupDetails?.members.length || 0}/100)
              </span>
            </div>

            {loading ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-terracotta)]" />
              </div>
            ) : (
              <div className="space-y-1.5">
                {groupDetails?.members.map((member) => {
                  const isMe = member.id === currentUser.id;
                  const isMemberOwner = member.role === 'owner';
                  const isMemberAdmin = member.role === 'admin';

                  return (
                    <div
                      key={member.id}
                      className="p-2.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] flex items-center justify-between gap-3 relative"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-[var(--bg-elevated)] text-[var(--text-primary)] font-medium flex items-center justify-center text-xs shrink-0">
                          {member.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                              {member.name || member.email.split('@')[0]}
                            </span>
                            {isMe && (
                              <span className="text-[10px] text-[var(--text-muted)] font-normal">(You)</span>
                            )}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">{member.email}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Role Badge */}
                        {isMemberOwner ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" /> Owner
                          </span>
                        ) : isMemberAdmin ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/20 flex items-center gap-1">
                            <Shield className="w-3 h-3" /> Admin
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                            Member
                          </span>
                        )}

                        {/* Actions Dropdown for non-self */}
                        {!isMe && (
                          <div className="relative">
                            <button
                              onClick={() =>
                                setActiveMenuMemberId(
                                  activeMenuMemberId === member.id ? null : member.id
                                )
                              }
                              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {activeMenuMemberId === member.id && (
                              <div className="absolute right-0 top-8 z-30 w-44 bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-xl shadow-xl py-1 text-xs animate-fade-in">
                                {/* Owner actions: promote/demote, remove */}
                                {isOwner && !isMemberOwner && (
                                  <>
                                    {isMemberAdmin ? (
                                      <button
                                        onClick={() => handleUpdateRole(member.id, 'member')}
                                        className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] text-[var(--text-primary)] flex items-center gap-2 cursor-pointer"
                                      >
                                        <UserMinus className="w-3.5 h-3.5" /> Dismiss as Admin
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleUpdateRole(member.id, 'admin')}
                                        className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] text-[var(--text-primary)] flex items-center gap-2 cursor-pointer"
                                      >
                                        <UserCheck className="w-3.5 h-3.5" /> Make Group Admin
                                      </button>
                                    )}

                                    <button
                                      onClick={() => {
                                        setActiveMenuMemberId(null);
                                        setConfirmAction({
                                          type: 'remove',
                                          targetUserId: member.id,
                                          targetUserName: member.name,
                                        });
                                      }}
                                      className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] text-rose-400 flex items-center gap-2 cursor-pointer"
                                    >
                                      <UserMinus className="w-3.5 h-3.5" /> Remove from Group
                                    </button>
                                    <div className="my-1 border-t border-[var(--border-subtle)]" />
                                  </>
                                )}

                                {/* Admin actions (can remove/promote other members, never owner) */}
                                {myRole === 'admin' && !isMemberOwner && (
                                  <>
                                    {!isMemberAdmin && (
                                      <button
                                        onClick={() => handleUpdateRole(member.id, 'admin')}
                                        className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] text-[var(--text-primary)] flex items-center gap-2 cursor-pointer"
                                      >
                                        <UserCheck className="w-3.5 h-3.5" /> Make Group Admin
                                      </button>
                                    )}

                                    <button
                                      onClick={() => {
                                        setActiveMenuMemberId(null);
                                        setConfirmAction({
                                          type: 'remove',
                                          targetUserId: member.id,
                                          targetUserName: member.name,
                                        });
                                      }}
                                      className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] text-rose-400 flex items-center gap-2 cursor-pointer"
                                    >
                                      <UserMinus className="w-3.5 h-3.5" /> Remove from Group
                                    </button>
                                    <div className="my-1 border-t border-[var(--border-subtle)]" />
                                  </>
                                )}

                                {/* Universal actions: Block & Report */}
                                <button
                                  onClick={() => handleBlockUser(member.id)}
                                  className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-rose-400 flex items-center gap-2 cursor-pointer"
                                >
                                  <UserX className="w-3.5 h-3.5" /> Block User
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveMenuMemberId(null);
                                    onOpenReport?.(member.id, member.name || member.email);
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-[var(--bg-surface)] text-amber-400 flex items-center gap-2 cursor-pointer"
                                >
                                  <ShieldAlert className="w-3.5 h-3.5" /> Report User
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Confirmation Overlay (Leave / Delete / Remove) */}
        {confirmAction && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-3 shrink-0 animate-fade-in">
            <p className="text-xs font-semibold">
              {confirmAction.type === 'delete'
                ? 'Are you sure you want to delete this group? All messages and data will be permanently removed for everyone.'
                : confirmAction.type === 'leave'
                ? 'Are you sure you want to leave this group?'
                : `Are you sure you want to remove ${confirmAction.targetUserName || 'this member'}?`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteConfirm}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  {confirmAction.type === 'delete'
                    ? 'Delete Group'
                    : confirmAction.type === 'leave'
                    ? 'Leave Group'
                    : 'Remove Member'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions (Leave / Delete Group) */}
        {!confirmAction && (
          <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between shrink-0">
            {isOwner ? (
              <button
                onClick={() => setConfirmAction({ type: 'delete' })}
                className="px-3 py-2 rounded-xl text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Group</span>
              </button>
            ) : (
              <button
                onClick={() => setConfirmAction({ type: 'leave' })}
                className="px-3 py-2 rounded-xl text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Leave Group</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
