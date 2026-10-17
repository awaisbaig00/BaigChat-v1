import { z } from 'zod';

const COMMON_PASSWORDS = new Set([
  'password123',
  '1234567890',
  '12345678901',
  '123456789012',
  'qwertyuiop',
  'admin12345',
  'letmein123',
  'welcome123',
  'password1234',
  'iloveyou123',
  'baigchat123',
  'administrator',
  'changeme123',
  'p@ssword123',
]);

export const RESERVED_USERNAMES = new Set([
  'admin',
  'support',
  'baigchat',
  'root',
  'system',
  'api',
  'null',
  'undefined',
]);

// Helper to strip control, zero-width, and bidi-override characters
export const sanitizeText = (str: string): string =>
  str
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();

export const UsernameSchema = z
  .string()
  .transform(sanitizeText)
  .refine((val) => /^[\x20-\x7E]+$/.test(val), { message: 'Username must contain only ASCII characters' })
  .refine((val) => /^[a-zA-Z0-9._]+$/.test(val), {
    message: 'Username can only contain letters, numbers, dots, and underscores',
  })
  .refine((val) => val.length >= 3 && val.length <= 30, {
    message: 'Username must be between 3 and 30 characters',
  })
  .refine((val) => /^[a-zA-Z0-9]/.test(val) && /[a-zA-Z0-9]$/.test(val), {
    message: 'Username cannot start or end with a dot or underscore',
  })
  .refine((val) => !/[._]{2,}/.test(val), {
    message: 'Username cannot contain consecutive dots or underscores',
  })
  .refine((val) => !RESERVED_USERNAMES.has(val.toLowerCase()), {
    message: 'This username is reserved and cannot be used',
  });

export const SignupSchema = z.object({
  username: UsernameSchema.optional(),
  email: z.string().trim().email('Invalid email address').max(255),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters long')
    .max(128, 'Password must not exceed 128 characters')
    .refine((val) => !COMMON_PASSWORDS.has(val.toLowerCase()), {
      message: 'Password is too common or easily guessed. Please choose a stronger password.',
    }),
});

export const LoginSchema = z
  .object({
    email: z.string().trim().min(1).max(255).optional(),
    username: z.string().trim().min(1).max(255).optional(),
    identifier: z.string().trim().min(1).max(255).optional(),
    password: z.string().min(1, 'Password is required').max(128, 'Password must not exceed 128 characters'),
  })
  .refine((data) => data.email || data.username || data.identifier, {
    message: 'Email or username is required',
  });

export const UpdateProfileSchema = z.object({
  displayName: z.string().transform(sanitizeText).pipe(z.string().max(50, 'Display name must not exceed 50 characters')).optional(),
  username: UsernameSchema.optional(),
  bio: z.string().transform(sanitizeText).pipe(z.string().max(150, 'Bio must not exceed 150 characters')).optional(),
  about: z.string().transform(sanitizeText).pipe(z.string().max(60, 'About must not exceed 60 characters')).optional(),
  isDiscoverable: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
});

export const UpdatePrivacySchema = z.object({
  showLastSeen: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  showOnline: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
});

export const ChangeEmailSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255).transform((v) => v.toLowerCase()),
  currentPassword: z.string().min(1, 'Current password is required').max(128),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: z
    .string()
    .min(10, 'Password must be at least 10 characters long')
    .max(128, 'Password must not exceed 128 characters')
    .refine((val) => !COMMON_PASSWORDS.has(val.toLowerCase()), {
      message: 'Password is too common or easily guessed. Please choose a stronger password.',
    }),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255).transform((v) => v.toLowerCase()),
});

export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required').max(128),
  newPassword: z
    .string()
    .min(10, 'Password must be at least 10 characters long')
    .max(128, 'Password must not exceed 128 characters')
    .refine((val) => !COMMON_PASSWORDS.has(val.toLowerCase()), {
      message: 'Password is too common or easily guessed. Please choose a stronger password.',
    }),
});

export const SearchUsersQuerySchema = z.object({
  q: z.string().trim().min(3, 'Search query must be at least 3 characters').max(50),
});

export const UsernameParamSchema = z.object({
  username: z.string().min(1).max(50),
});


export const CreateInviteSchema = z.object({
  maxUses: z.number().int().min(1).max(100).default(1).optional(),
});

// REST Param and Query Schemas
export const InviteTokenParamSchema = z.object({
  token: z.string().min(1).max(128),
});

export const InviteIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const ConversationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const MessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
});

export const WsSendMessageSchema = z
  .object({
    type: z.literal('message:send'),
    conversationId: z.string().uuid(),
    clientMsgId: z.string().min(1).max(128),
    content: z.string().max(4000).default(''),
    attachmentId: z.string().uuid().optional(),
    replyToId: z.number().int().positive().optional(),
  })
  .refine((data) => data.content.trim().length > 0 || !!data.attachmentId, {
    message: 'Message must have text content or an attachment',
  });

export const WsReadMessageSchema = z.object({
  type: z.literal('message:read'),
  conversationId: z.string().uuid(),
  messageId: z.number().int().positive().optional(),
});

export const WsTypingStartSchema = z.object({
  type: z.literal('typing:start'),
  conversationId: z.string().uuid(),
});

export const WsTypingStopSchema = z.object({
  type: z.literal('typing:stop'),
  conversationId: z.string().uuid(),
});

export const WsSyncRequestSchema = z.object({
  type: z.literal('sync:request'),
  conversationId: z.string().uuid(),
  afterId: z.number().int().nonnegative().default(0),
});

// Union of all valid incoming WS events
export const WsIncomingEventSchema = z.discriminatedUnion('type', [
  WsSendMessageSchema,
  WsReadMessageSchema,
  WsTypingStartSchema,
  WsTypingStopSchema,
  WsSyncRequestSchema,
]);

// Legacy / alias support
export const SendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  clientMsgId: z.string().min(1).max(128),
  content: z.string().trim().min(1).max(4000),
});

export const TypingSchema = z.object({
  conversationId: z.string().uuid(),
  isTyping: z.boolean(),
});

// Helper to strip control characters [\x00-\x1F\x7F-\x9F]
export const stripControlChars = (str: string): string =>
  str.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();

export const GroupNameSchema = z
  .string()
  .transform(stripControlChars)
  .pipe(
    z
      .string()
      .min(1, 'Group name must be between 1 and 60 characters')
      .max(60, 'Group name must be between 1 and 60 characters')
  );

export const CreateGroupSchema = z.object({
  name: GroupNameSchema,
  memberIds: z.array(z.number().int().positive()).max(99).optional(),
});

export const UpdateGroupSchema = z.object({
  name: GroupNameSchema,
});

export const AddGroupMembersSchema = z.union([
  z.object({
    userIds: z.array(z.number().int().positive()).min(1).max(100),
  }),
  z.object({
    userId: z.number().int().positive(),
  }),
]);

export const GroupMemberParamSchema = z.object({
  id: z.string().uuid(),
  userId: z.coerce.number().int().positive(),
});

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

export const CreateGroupInviteSchema = z.object({
  maxUses: z.coerce.number().int().min(1).max(100).default(20).optional(),
});

export const BlockUserSchema = z.object({
  userId: z.number().int().positive(),
});

export const BlockUserParamSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const CreateReportSchema = z.object({
  reportedUserId: z.number().int().positive(),
  conversationId: z.string().uuid(),
  messageId: z.number().int().positive().optional(),
  reason: z.string().trim().min(1, 'Reason is required').max(100, 'Reason must not exceed 100 characters'),
  details: z.string().trim().max(1000, 'Details must not exceed 1000 characters').optional(),
});

// Stage 3: Chat Essentials Schemas
export const MessageIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const EditMessageSchema = z.object({
  content: z
    .string()
    .transform(stripControlChars)
    .pipe(z.string().min(1, 'Message cannot be empty').max(4000, 'Message cannot exceed 4000 characters')),
});

export const DeleteMessageSchema = z.object({
  mode: z.enum(['me', 'everyone']).default('everyone').optional(),
});

export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export const ReactionSchema = z.object({
  emoji: z.enum(ALLOWED_REACTIONS, {
    message: 'Invalid emoji reaction',
  }),
});

export const MuteConversationSchema = z.object({
  duration: z.enum(['8h', '1w', 'always', 'unmute'] as const, {
    message: 'Invalid mute duration. Must be 8h, 1w, always, or unmute',
  }),
});

export const MessageSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search query must be at least 2 characters').max(100),
  conversationId: z.string().uuid().optional(),
});
