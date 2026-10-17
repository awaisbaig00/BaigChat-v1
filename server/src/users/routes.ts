import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';
import argon2 from 'argon2';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import { AVATARS_DIR, UPLOADS_DIR } from '../config';
import { requireAuth, deleteSession, clearSessionCookies, hashToken } from '../auth/session';
import { recordAuditEvent } from '../security/audit';
import { detectMimeType } from '../uploads/detector';
import { isUserOnline } from '../ws/presence';
import {
  UpdateProfileSchema,
  UpdatePrivacySchema,
  ChangeEmailSchema,
  ChangePasswordSchema,
  SearchUsersQuerySchema,
  UsernameParamSchema,
  UsernameSchema,
} from '../validation/schemas';

export const usersRouter = Router();

// Ensure avatars directory exists
if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

// Multer memory storage for avatars (max 2 MB)
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB limit
  },
});

function handleAvatarUpload(req: Request, res: Response, next: NextFunction) {
  avatarUpload.single('avatar')(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Avatar image must not exceed 2 MB' });
        return;
      }
      res.status(400).json({ error: `Upload error: ${err.message}` });
      return;
    } else if (err) {
      res.status(400).json({ error: 'Failed to process avatar upload' });
      return;
    }
    next();
  });
}

// Rate limiter for avatar uploads: 10 per hour
const avatarLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many avatar uploads. Please try again later.' },
});

// Rate limiter for profile updates: 20 per hour
const profileUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many profile updates. Please slow down.' },
});

// Rate limiter for user search: 40 per minute
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests. Please slow down.' },
});

// Helper: check if two users share at least one conversation
function shareConversation(userIdA: number, userIdB: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM conversation_members cm1
       JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
       WHERE cm1.user_id = ? AND cm2.user_id = ?
       LIMIT 1`
    )
    .get(userIdA, userIdB);
  return !!row;
}

// --- AVATAR SERVING (Auth required) ---
// GET /api/avatars/:userId?size=thumb|full
usersRouter.get('/avatars/:userId', requireAuth, (req: Request, res: Response) => {
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: 'Invalid user ID' });
    return;
  }

  const callerId = req.user!.id;
  const size = req.query.size === 'full' ? 'full' : 'thumb';

  const targetUser = db
    .prepare('SELECT id, avatar_attachment_id, is_discoverable, is_deleted FROM users WHERE id = ?')
    .get(targetUserId) as
    | { id: number; avatar_attachment_id: string | null; is_discoverable: number; is_deleted: number }
    | undefined;

  if (!targetUser || targetUser.is_deleted === 1 || !targetUser.avatar_attachment_id) {
    res.status(404).json({ error: 'Avatar not found' });
    return;
  }

  // Visibility check: caller must be self, or target is discoverable, or they share a conversation
  if (callerId !== targetUserId && targetUser.is_discoverable === 0) {
    if (!shareConversation(callerId, targetUserId)) {
      res.status(404).json({ error: 'Avatar not found' });
      return;
    }
  }

  const filePath = path.join(AVATARS_DIR, `${targetUserId}_${size}.webp`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Avatar file not found' });
    return;
  }

  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(filePath).pipe(res);
});

// --- CURRENT USER PROFILE & SETTINGS ---

// GET /api/me - Full profile
usersRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const user = db
    .prepare(
      `SELECT id, email, username, display_name, bio, about, avatar_attachment_id,
              is_discoverable, show_last_seen, show_online, last_seen, created_at
       FROM users
       WHERE id = ? AND is_deleted = 0`
    )
    .get(userId) as any;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio,
    about: user.about,
    avatarUrl: user.avatar_attachment_id ? `/api/avatars/${user.id}?size=thumb` : null,
    fullAvatarUrl: user.avatar_attachment_id ? `/api/avatars/${user.id}?size=full` : null,
    isDiscoverable: !!user.is_discoverable,
    showLastSeen: !!user.show_last_seen,
    showOnline: !!user.show_online,
    lastSeen: user.last_seen,
    createdAt: user.created_at,
  });
});

// PATCH /api/me/profile - Update profile details
usersRouter.patch('/me/profile', requireAuth, profileUpdateLimiter, (req: Request, res: Response) => {
  const result = UpdateProfileSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues?.[0]?.message ?? 'Invalid profile input' });
    return;
  }

  const userId = req.user!.id;
  const { displayName, username, bio, about, isDiscoverable } = result.data;

  // Handle username update with rate limit
  if (username !== undefined) {
    const current = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string };
    if (current && current.username.toLowerCase() !== username.toLowerCase()) {
      // Check 24-hour change limit (max 3)
      const changesRow = db
        .prepare(
          `SELECT COUNT(*) as count FROM username_changes 
           WHERE user_id = ? AND changed_at > datetime('now', '-24 hours')`
        )
        .get(userId) as { count: number };

      if (changesRow && changesRow.count >= 3) {
        res.status(429).json({ error: 'You can only change your username 3 times per 24 hours.' });
        return;
      }

      // Check case-insensitive uniqueness
      const existing = db
        .prepare('SELECT id FROM users WHERE username_lower = ? AND id != ?')
        .get(username.toLowerCase(), userId);

      if (existing) {
        res.status(400).json({ error: 'Username is already taken. Please choose another.' });
        return;
      }

      // Record username change
      db.prepare('INSERT INTO username_changes (user_id) VALUES (?)').run(userId);
      db.prepare('UPDATE users SET username = ?, username_lower = ? WHERE id = ?').run(
        username,
        username.toLowerCase(),
        userId
      );
    }
  }

  // Update other fields
  if (displayName !== undefined) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, userId);
  }
  if (bio !== undefined) {
    db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, userId);
  }
  if (about !== undefined) {
    db.prepare('UPDATE users SET about = ? WHERE id = ?').run(about, userId);
  }
  if (isDiscoverable !== undefined) {
    const disc = isDiscoverable ? 1 : 0;
    db.prepare('UPDATE users SET is_discoverable = ? WHERE id = ?').run(disc, userId);
  }

  const updated = db
    .prepare(
      `SELECT id, email, username, display_name, bio, about, avatar_attachment_id,
              is_discoverable, show_last_seen, show_online, last_seen, created_at
       FROM users WHERE id = ?`
    )
    .get(userId) as any;

  res.json({
    id: updated.id,
    email: updated.email,
    username: updated.username,
    displayName: updated.display_name,
    bio: updated.bio,
    about: updated.about,
    avatarUrl: updated.avatar_attachment_id ? `/api/avatars/${updated.id}?size=thumb` : null,
    fullAvatarUrl: updated.avatar_attachment_id ? `/api/avatars/${updated.id}?size=full` : null,
    isDiscoverable: !!updated.is_discoverable,
    showLastSeen: !!updated.show_last_seen,
    showOnline: !!updated.show_online,
  });
});

// PATCH /api/me/privacy - Toggle privacy settings
usersRouter.patch('/me/privacy', requireAuth, (req: Request, res: Response) => {
  const result = UpdatePrivacySchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues?.[0]?.message ?? 'Invalid privacy input' });
    return;
  }

  const userId = req.user!.id;
  const { showLastSeen, showOnline } = result.data;

  if (showLastSeen !== undefined) {
    db.prepare('UPDATE users SET show_last_seen = ? WHERE id = ?').run(showLastSeen ? 1 : 0, userId);
  }
  if (showOnline !== undefined) {
    db.prepare('UPDATE users SET show_online = ? WHERE id = ?').run(showOnline ? 1 : 0, userId);
  }

  const user = db.prepare('SELECT show_last_seen, show_online FROM users WHERE id = ?').get(userId) as any;
  res.json({
    showLastSeen: !!user.show_last_seen,
    showOnline: !!user.show_online,
  });
});

// POST /api/me/avatar - Upload avatar
usersRouter.post('/me/avatar', requireAuth, avatarLimiter, handleAvatarUpload, async (req: Request, res: Response) => {
  if (!req.file || !req.file.buffer) {
    res.status(400).json({ error: 'No image file uploaded' });
    return;
  }

  const userId = req.user!.id;
  const rawBuffer = req.file.buffer;

  // Magic bytes check: must be JPEG, PNG, or WebP
  const detected = detectMimeType(rawBuffer);
  if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) {
    res.status(400).json({ error: 'Unsupported file type. Only JPEG, PNG, and WebP images are allowed.' });
    return;
  }

  try {
    const fullPath = path.join(AVATARS_DIR, `${userId}_full.webp`);
    const thumbPath = path.join(AVATARS_DIR, `${userId}_thumb.webp`);

    // Center-crop and convert to WebP with EXIF stripped
    await sharp(rawBuffer)
      .rotate() // auto-orient based on EXIF before stripping
      .resize(512, 512, { fit: 'cover', position: 'center' })
      .webp({ quality: 85 })
      .toFile(fullPath);

    await sharp(rawBuffer)
      .rotate()
      .resize(96, 96, { fit: 'cover', position: 'center' })
      .webp({ quality: 80 })
      .toFile(thumbPath);

    // Save avatar marker in DB
    const avatarId = Date.now().toString();
    db.prepare('UPDATE users SET avatar_attachment_id = ? WHERE id = ?').run(avatarId, userId);

    res.json({
      success: true,
      avatarUrl: `/api/avatars/${userId}?size=thumb&v=${avatarId}`,
      fullAvatarUrl: `/api/avatars/${userId}?size=full&v=${avatarId}`,
    });
  } catch (err) {
    console.error('Avatar processing error:', err);
    res.status(500).json({ error: 'Failed to process and crop avatar image' });
  }
});

// DELETE /api/me/avatar - Remove avatar
usersRouter.delete('/me/avatar', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;

  db.prepare('UPDATE users SET avatar_attachment_id = NULL WHERE id = ?').run(userId);

  // Best-effort cleanup of files from disk
  try {
    const fullPath = path.join(AVATARS_DIR, `${userId}_full.webp`);
    const thumbPath = path.join(AVATARS_DIR, `${userId}_thumb.webp`);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  } catch (err) {
    console.error('Failed to remove avatar files:', err);
  }

  res.json({ success: true });
});

// PATCH /api/me/email - Change email (requires current password)
usersRouter.patch('/me/email', requireAuth, async (req: Request, res: Response) => {
  const result = ChangeEmailSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues?.[0]?.message ?? 'Invalid email input' });
    return;
  }

  const userId = req.user!.id;
  const { email, currentPassword } = result.data;

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    | { password_hash: string }
    | undefined;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const isPasswordValid = await argon2.verify(user.password_hash, currentPassword);
  if (!isPasswordValid) {
    res.status(401).json({ error: 'Incorrect current password' });
    return;
  }

  // Check if email already taken
  const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, userId);
  if (existing) {
    res.status(400).json({ error: 'Email is already in use by another account' });
    return;
  }

  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
  res.json({ success: true, email });
});

// PATCH /api/me/password - Change password (requires current password, invalidates other sessions)
usersRouter.patch('/me/password', requireAuth, async (req: Request, res: Response) => {
  const result = ChangePasswordSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues?.[0]?.message ?? 'Invalid password input' });
    return;
  }

  const userId = req.user!.id;
  const { currentPassword, newPassword } = result.data;

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    | { password_hash: string }
    | undefined;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const isPasswordValid = await argon2.verify(user.password_hash, currentPassword);
  if (!isPasswordValid) {
    res.status(401).json({ error: 'Incorrect current password' });
    return;
  }

  const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);

  // Invalidate all OTHER sessions for this user
  if (req.rawSessionId) {
    const currentHash = hashToken(req.rawSessionId);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, currentHash);
  }

  res.json({ success: true, message: 'Password updated. Other sessions have been signed out.' });
});

// GET /api/me/sessions - List active sessions
usersRouter.get('/me/sessions', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const currentHash = req.rawSessionId ? hashToken(req.rawSessionId) : '';

  const sessions = db
    .prepare(
      `SELECT id, user_agent, ip_address, last_active, created_at, expires_at
       FROM sessions
       WHERE user_id = ? AND datetime(expires_at) > datetime('now')
       ORDER BY last_active DESC`
    )
    .all(userId) as Array<{
    id: string;
    user_agent: string | null;
    ip_address: string | null;
    last_active: string;
    created_at: string;
    expires_at: string;
  }>;

  const list = sessions.map((s) => ({
    id: s.id,
    isCurrent: s.id === currentHash,
    userAgent: s.user_agent || 'Unknown browser',
    ipAddress: s.ip_address || 'Unknown location',
    lastActive: s.last_active,
    createdAt: s.created_at,
  }));

  res.json({ sessions: list });
});

// DELETE /api/me/sessions/:id - Revoke single session
usersRouter.delete('/me/sessions/:id', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const targetSessionId = req.params.id;

  const session = db.prepare('SELECT id, user_id FROM sessions WHERE id = ?').get(targetSessionId) as
    | { id: string; user_id: number }
    | undefined;

  if (!session || session.user_id !== userId) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  db.prepare('DELETE FROM sessions WHERE id = ?').run(targetSessionId);

  // If user revoked their current session, clear cookies
  if (req.rawSessionId && hashToken(req.rawSessionId) === targetSessionId) {
    clearSessionCookies(res);
  }

  res.json({ success: true });
});

// POST /api/me/sessions/revoke-others - Revoke all other sessions
usersRouter.post('/me/sessions/revoke-others', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  if (!req.rawSessionId) {
    res.status(400).json({ error: 'No active session' });
    return;
  }

  const currentHash = hashToken(req.rawSessionId);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, currentHash);

  res.json({ success: true, message: 'All other sessions have been logged out' });
});

// GET /api/me/export - "Download my data" (JSON export of profile, chats, and messages sent)
usersRouter.get('/me/export', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;

  const profile = db
    .prepare(`
      SELECT id, email, username, display_name, bio, about, created_at, last_seen
      FROM users WHERE id = ?
    `)
    .get(userId);

  const conversations = db
    .prepare(`
      SELECT c.id, c.type, c.name, c.created_at, cm.role, cm.joined_at
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    `)
    .all(userId);

  const messages = db
    .prepare(`
      SELECT id, conversation_id, content, created_at, edited_at, is_deleted
      FROM messages
      WHERE sender_id = ?
      ORDER BY id ASC
    `)
    .all(userId);

  const exportData = {
    exportDate: new Date().toISOString(),
    profile,
    conversations,
    messages,
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="baigchat-data-export.json"');
  res.json(exportData);
});

// DELETE /api/me/account - Soft-delete / anonymize account, delete uploaded files
usersRouter.delete('/me/account', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    | { password_hash: string }
    | undefined;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const isPasswordValid = await argon2.verify(user.password_hash, password);
  if (!isPasswordValid) {
    res.status(401).json({ error: 'Incorrect password. Account deletion requires password verification.' });
    return;
  }

  // Remove avatar files from disk
  try {
    const fullPath = path.join(AVATARS_DIR, `${userId}_full.webp`);
    const thumbPath = path.join(AVATARS_DIR, `${userId}_thumb.webp`);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  } catch (err) {
    console.warn('Failed to delete avatar files on account deletion:', err);
  }

  // Remove uploaded attachments from disk and database
  try {
    const attachments = db.prepare('SELECT stored_name FROM attachments WHERE uploader_id = ?').all(userId) as any[];
    for (const att of attachments) {
      if (att.stored_name) {
        const filePath = path.join(UPLOADS_DIR, att.stored_name);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
    db.prepare('DELETE FROM attachments WHERE uploader_id = ?').run(userId);
  } catch (err) {
    console.warn('Failed to delete attachments on account deletion:', err);
  }

  // Anonymize and mark deleted
  const anonymizedEmail = `deleted_${userId}@deleted.local`;
  const anonymizedUsername = `deleted_${userId}`;
  db.prepare(
    `UPDATE users 
     SET is_deleted = 1,
         email = ?,
         username = ?,
         username_lower = ?,
         display_name = 'Deleted User',
         bio = NULL,
         about = NULL,
         avatar_attachment_id = NULL
     WHERE id = ?`
  ).run(anonymizedEmail, anonymizedUsername, anonymizedUsername, userId);

  // Invalidate all sessions
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  clearSessionCookies(res);

  recordAuditEvent({
    eventType: 'account_deletion',
    userId,
    ipAddress: req.ip,
  });

  res.json({ success: true, message: 'Your account has been deleted' });
});

// --- USER SEARCH & PUBLIC PROFILES ---

// GET /api/users/search?q=
usersRouter.get('/users/search', requireAuth, searchLimiter, (req: Request, res: Response) => {
  const result = SearchUsersQuerySchema.safeParse(req.query);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues?.[0]?.message ?? 'Search query must be at least 3 characters' });
    return;
  }

  const callerId = req.user!.id;
  const sanitizedQuery = result.data.q.replace(/[%_\\]/g, '\\$&').toLowerCase();
  const pattern = `%${sanitizedQuery}%`;

  const rows = db
    .prepare(
      `SELECT id, username, display_name, avatar_attachment_id
       FROM users
       WHERE (username_lower LIKE ? ESCAPE '\\' OR LOWER(display_name) LIKE ? ESCAPE '\\')
         AND is_discoverable = 1
         AND is_deleted = 0
         AND id != ?
         AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
         AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
       LIMIT 10`
    )
    .all(pattern, pattern, callerId, callerId, callerId) as Array<{
    id: number;
    username: string;
    display_name: string;
    avatar_attachment_id: string | null;
  }>;

  const users = rows.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarUrl: u.avatar_attachment_id ? `/api/avatars/${u.id}?size=thumb` : null,
  }));

  res.json({ users });
});

// GET /api/users/:username - Public/Instagram-style profile view
usersRouter.get('/users/:username', requireAuth, (req: Request, res: Response) => {
  const paramResult = UsernameParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid username' });
    return;
  }

  const callerId = req.user!.id;
  const targetUsername = paramResult.data.username.toLowerCase();

  const target = db
    .prepare(
      `SELECT id, username, display_name, bio, about, avatar_attachment_id,
              is_discoverable, show_last_seen, show_online, last_seen, created_at, is_deleted
       FROM users
       WHERE username_lower = ? AND is_deleted = 0`
    )
    .get(targetUsername) as any;

  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const isSelf = target.id === callerId;

  // If target has turned off discoverability and caller is a stranger (no shared conversations), return 404
  if (!isSelf && target.is_discoverable === 0) {
    if (!shareConversation(callerId, target.id)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
  }

  // Check blocks
  const isBlockedByCaller = db
    .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
    .get(callerId, target.id);
  const hasBlockedCaller = db
    .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
    .get(target.id, callerId);

  // Reciprocal privacy check for caller
  const caller = db.prepare('SELECT show_last_seen, show_online FROM users WHERE id = ?').get(callerId) as any;

  let isOnline = false;
  let lastSeen = null;

  if (!isSelf && (isBlockedByCaller || hasBlockedCaller)) {
    isOnline = false;
    lastSeen = null;
  } else if (isSelf) {
    isOnline = true;
    lastSeen = target.last_seen;
  } else {
    // Reciprocal online status
    if (caller.show_online === 1 && target.show_online === 1) {
      isOnline = isUserOnline(target.id);
    }
    // Reciprocal last seen
    if (caller.show_last_seen === 1 && target.show_last_seen === 1) {
      lastSeen = target.last_seen;
    }
  }

  // Count mutual conversations
  const mutualConvosRow = db
    .prepare(
      `SELECT COUNT(DISTINCT cm1.conversation_id) as count
       FROM conversation_members cm1
       JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
       WHERE cm1.user_id = ? AND cm2.user_id = ?`
    )
    .get(callerId, target.id) as { count: number };

  // Count shared media / attachments
  const sharedMediaRow = db
    .prepare(
      `SELECT COUNT(DISTINCT a.id) as count
       FROM attachments a
       JOIN conversation_members cm1 ON cm1.conversation_id = a.conversation_id
       JOIN conversation_members cm2 ON cm2.conversation_id = a.conversation_id
       WHERE cm1.user_id = ? AND cm2.user_id = ?`
    )
    .get(callerId, target.id) as { count: number };

  res.json({
    id: target.id,
    username: target.username,
    displayName: target.display_name,
    bio: target.bio,
    about: target.about,
    avatarUrl: target.avatar_attachment_id ? `/api/avatars/${target.id}?size=thumb` : null,
    fullAvatarUrl: target.avatar_attachment_id ? `/api/avatars/${target.id}?size=full` : null,
    isOnline,
    lastSeen,
    mutualConversationsCount: mutualConvosRow ? mutualConvosRow.count : 0,
    sharedMediaCount: sharedMediaRow ? sharedMediaRow.count : 0,
    isBlocked: !!isBlockedByCaller,
    isSelf,
    createdAt: target.created_at,
  });
});
