export interface User {
  id: number;
  email: string;
  username?: string;
  displayName?: string;
  bio?: string | null;
  about?: string | null;
  avatarUrl?: string | null;
  fullAvatarUrl?: string | null;
  isDiscoverable?: boolean;
  showLastSeen?: boolean;
  showOnline?: boolean;
  lastSeen?: string;
  createdAt?: string;
}

export interface Attachment {
  id: string;
  originalName: string;
  mime: string;
  size: number;
  url: string;
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  userReacted: boolean;
  userIds: number[];
}

export interface MessageQuote {
  id: number;
  senderId: number;
  senderName?: string;
  content: string;
  hasAttachment?: boolean;
}

export interface Message {
  id?: number;
  conversationId: string;
  senderId: number;
  clientMsgId: string;
  content: string;
  type?: 'user' | 'system';
  createdAt: string;
  deliveredAt?: string | null;
  readAt?: string | null;
  pending?: boolean;
  attachmentId?: string | null;
  attachment?: Attachment | null;
  editedAt?: string | null;
  isDeleted?: boolean;
  replyToId?: number | null;
  replyQuote?: MessageQuote | null;
  reactions?: ReactionGroup[];
}

export interface Recipient {
  id: number;
  email: string;
  username?: string;
  name?: string;
  avatarUrl?: string | null;
  lastSeen?: string | null;
  isOnline: boolean;
}

export interface GroupMember {
  id: number;
  email: string;
  username?: string;
  name: string;
  avatarUrl?: string | null;
  role: 'owner' | 'admin' | 'member';
  joinedAt?: string;
}

export interface Conversation {
  id: string;
  type?: 'direct' | 'group';
  name?: string | null;
  title?: string;
  role?: 'owner' | 'admin' | 'member';
  memberCount?: number;
  createdAt: string;
  recipient: Recipient | null;
  lastMessage: Message | null;
  unreadCount: number;
  isMuted?: boolean;
  mutedUntil?: string | null;
}

export interface InvitePreview {
  valid: boolean;
  isGroup?: boolean;
  groupName?: string;
  memberCount?: number;
  inviteId: string;
  inviterId: number;
  inviterEmail: string;
  inviterName?: string;
  expiresAt: string;
}

export interface BlockedUser {
  id: number;
  email: string;
  name: string;
  blockedAt: string;
}

export interface UserProfile {
  id: number;
  username: string;
  displayName: string;
  bio?: string | null;
  about?: string | null;
  avatarUrl?: string | null;
  fullAvatarUrl?: string | null;
  isOnline?: boolean;
  lastSeen?: string | null;
  mutualConversationsCount?: number;
  sharedMediaCount?: number;
  isBlocked?: boolean;
  isSelf?: boolean;
  createdAt?: string;
}

export interface ActiveSession {
  id: string;
  isCurrent: boolean;
  userAgent: string;
  ipAddress: string;
  lastActive: string;
  createdAt: string;
}
