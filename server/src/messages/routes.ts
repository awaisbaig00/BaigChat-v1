import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import { requireAuth } from '../auth/session';
import { broadcastToConversation } from '../ws/presence';
import { UPLOADS_DIR } from '../config';
import { recordAuditEvent } from '../security/audit';
import {
  MessageIdParamSchema,
  EditMessageSchema,
  DeleteMessageSchema,
  ReactionSchema,
  MessageSearchQuerySchema,
} from '../validation/schemas';

export const messagesRouter = Router();

messagesRouter.use(requireAuth);

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests. Please slow down.' },
});

const messageActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many message actions. Please slow down.' },
});

// Helper: check if user is a member of a conversation
function isMember(conversationId: string, userId: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
  return !!row;
}

// GET /api/messages/search?q=...&conversationId=...
messagesRouter.get('/search', searchLimiter, (req: Request, res: Response) => {
  const result = MessageSearchQuerySchema.safeParse(req.query);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues?.[0]?.message ?? 'Invalid search query' });
    return;
  }

  const userId = req.user!.id;
  const { q, conversationId } = result.data;

  // Escape SQL LIKE wildcards
  const sanitizedQuery = q.replace(/[%_\\]/g, '\\$&').toLowerCase();
  const pattern = `%${sanitizedQuery}%`;

  if (conversationId) {
    if (!isMember(conversationId, userId)) {
      res.status(403).json({ error: 'You are not a member of this conversation' });
      return;
    }
  }

  let rows: any[];
  if (conversationId) {
    rows = db
      .prepare(`
        SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at, m.edited_at,
               u.display_name, u.username, u.email
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ?
          AND LOWER(m.content) LIKE ? ESCAPE '\\'
          AND m.is_deleted = 0
          AND m.id NOT IN (SELECT message_id FROM message_deletions WHERE user_id = ?)
          AND m.sender_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        ORDER BY m.id DESC
        LIMIT 50
      `)
      .all(conversationId, pattern, userId, userId) as any[];
  } else {
    rows = db
      .prepare(`
        SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at, m.edited_at,
               u.display_name, u.username, u.email
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
        WHERE LOWER(m.content) LIKE ? ESCAPE '\\'
          AND m.is_deleted = 0
          AND m.id NOT IN (SELECT message_id FROM message_deletions WHERE user_id = ?)
          AND m.sender_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        ORDER BY m.id DESC
        LIMIT 50
      `)
      .all(userId, pattern, userId, userId) as any[];
  }

  res.json({
    results: rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      senderId: r.sender_id,
      senderName: r.display_name || r.username || r.email.split('@')[0],
      content: r.content,
      createdAt: r.created_at,
      editedAt: r.edited_at,
    })),
  });
});

// PATCH /api/messages/:id - Edit message (author only, text messages only, within 15 minutes)
messagesRouter.patch('/:id', messageActionLimiter, (req: Request, res: Response) => {
  const paramResult = MessageIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid message ID' });
    return;
  }

  const bodyResult = EditMessageSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: bodyResult.error.issues?.[0]?.message ?? 'Invalid message content' });
    return;
  }

  const userId = req.user!.id;
  const messageId = paramResult.data.id;
  const { content } = bodyResult.data;

  const msg = db
    .prepare('SELECT id, conversation_id, sender_id, content, created_at, is_deleted, attachment_id FROM messages WHERE id = ?')
    .get(messageId) as any;

  if (!msg) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  if (!isMember(msg.conversation_id, userId)) {
    res.status(403).json({ error: 'You are not a member of this conversation' });
    return;
  }

  if (msg.sender_id !== userId) {
    res.status(403).json({ error: 'You can only edit your own messages' });
    return;
  }

  if (msg.is_deleted === 1) {
    res.status(400).json({ error: 'Deleted messages cannot be edited' });
    return;
  }

  if (msg.attachment_id !== null) {
    res.status(400).json({ error: 'Only text messages can be edited' });
    return;
  }

  // 15-minute time window check (normalize SQLite UTC timestamp)
  const rawCreatedAt = String(msg.created_at);
  const normalizedDateStr = rawCreatedAt.endsWith('Z')
    ? rawCreatedAt
    : `${rawCreatedAt.replace(' ', 'T')}Z`;
  const msgTime = new Date(normalizedDateStr).getTime();
  const now = Date.now();
  const fifteenMinutesMs = 15 * 60 * 1000;
  if (now - msgTime > fifteenMinutesMs) {
    res.status(400).json({ error: 'Messages can only be edited within 15 minutes of sending' });
    return;
  }

  const editedAt = new Date().toISOString();

  const editTx = db.transaction(() => {
    // Record original in audit table
    db.prepare(`
      INSERT INTO message_edits (message_id, old_content, edited_at)
      VALUES (?, ?, datetime('now'))
    `).run(messageId, msg.content);

    // Update message
    db.prepare(`
      UPDATE messages
      SET content = ?, edited_at = datetime('now')
      WHERE id = ?
    `).run(content, messageId);
  });

  editTx();

  // Broadcast update over WebSocket
  broadcastToConversation(msg.conversation_id, {
    type: 'message:updated',
    messageId,
    conversationId: msg.conversation_id,
    content,
    editedAt,
  });

  res.json({
    id: messageId,
    conversationId: msg.conversation_id,
    content,
    editedAt,
  });
});

// DELETE /api/messages/:id - Delete message ("me" or "everyone")
messagesRouter.delete('/:id', messageActionLimiter, (req: Request, res: Response) => {
  const paramResult = MessageIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid message ID' });
    return;
  }

  const queryOrBodyMode = req.query.mode || req.body?.mode || 'everyone';
  const modeResult = DeleteMessageSchema.safeParse({ mode: queryOrBodyMode });
  if (!modeResult.success) {
    res.status(400).json({ error: 'Invalid delete mode. Must be "me" or "everyone"' });
    return;
  }

  const userId = req.user!.id;
  const messageId = paramResult.data.id;
  const mode = modeResult.data.mode || 'everyone';

  const msg = db
    .prepare('SELECT id, conversation_id, sender_id, attachment_id, is_deleted, created_at FROM messages WHERE id = ?')
    .get(messageId) as any;

  if (!msg) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  if (!isMember(msg.conversation_id, userId)) {
    res.status(403).json({ error: 'You are not a member of this conversation' });
    return;
  }

  if (mode === 'me') {
    // Delete for caller only
    db.prepare(`
      INSERT OR IGNORE INTO message_deletions (user_id, message_id)
      VALUES (?, ?)
    `).run(userId, messageId);

    res.json({ success: true, mode: 'me', messageId });
    return;
  }

  // Delete for everyone
  const isAuthor = msg.sender_id === userId;
  let isGroupAdminOrOwner = false;

  const memberRow = db
    .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(msg.conversation_id, userId) as { role: string } | undefined;

  if (memberRow && ['owner', 'admin'].includes(memberRow.role)) {
    isGroupAdminOrOwner = true;
  }

  if (!isAuthor && !isGroupAdminOrOwner) {
    res.status(403).json({ error: 'You can only delete your own messages' });
    return;
  }

  // 1-hour window check for author (group admins/owners can delete anytime for moderation)
  if (!isGroupAdminOrOwner) {
    const rawCreatedAt = String(msg.created_at);
    const normalizedDateStr = rawCreatedAt.endsWith('Z')
      ? rawCreatedAt
      : `${rawCreatedAt.replace(' ', 'T')}Z`;
    const msgTime = new Date(normalizedDateStr).getTime();
    const oneHourMs = 60 * 60 * 1000;
    if (Date.now() - msgTime > oneHourMs) {
      res.status(400).json({ error: 'Messages can only be deleted for everyone within 1 hour of sending' });
      return;
    }
  }

  // Soft delete message
  db.prepare(`
    UPDATE messages
    SET is_deleted = 1,
        content = 'This message was deleted',
        attachment_id = NULL
    WHERE id = ?
  `).run(messageId);

  // Clear reactions on deleted message
  db.prepare('DELETE FROM message_reactions WHERE message_id = ?').run(messageId);

  // Best-effort cleanup of attachment file
  if (msg.attachment_id) {
    try {
      const att = db.prepare('SELECT stored_name FROM attachments WHERE id = ?').get(msg.attachment_id) as any;
      if (att && att.stored_name) {
        const filePath = path.join(UPLOADS_DIR, att.stored_name);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      db.prepare('DELETE FROM attachments WHERE id = ?').run(msg.attachment_id);
    } catch (err) {
      console.warn('Failed to clean up attachment file on message deletion:', err);
    }
  }

  // Broadcast deletion to conversation
  broadcastToConversation(msg.conversation_id, {
    type: 'message:deleted',
    messageId,
    conversationId: msg.conversation_id,
    forEveryone: true,
  });

  recordAuditEvent({
    eventType: 'message_deleted_everyone',
    userId,
    ipAddress: req.ip,
    details: { messageId, conversationId: msg.conversation_id },
  });

  res.json({ success: true, mode: 'everyone', messageId });
});

// POST /api/messages/:id/reactions - Toggle emoji reaction (one reaction per user per message, toggle & change)
messagesRouter.post('/:id/reactions', messageActionLimiter, (req: Request, res: Response) => {
  const paramResult = MessageIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid message ID' });
    return;
  }

  const bodyResult = ReactionSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: bodyResult.error.issues?.[0]?.message ?? 'Invalid emoji reaction' });
    return;
  }

  const userId = req.user!.id;
  const messageId = paramResult.data.id;
  const { emoji } = bodyResult.data;

  const msg = db
    .prepare('SELECT id, conversation_id, is_deleted FROM messages WHERE id = ?')
    .get(messageId) as any;

  if (!msg) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }

  if (msg.is_deleted === 1) {
    res.status(400).json({ error: 'Cannot react to a deleted message' });
    return;
  }

  if (!isMember(msg.conversation_id, userId)) {
    res.status(403).json({ error: 'You are not a member of this conversation' });
    return;
  }

  // Check if reaction already exists for this user on this message
  const existing = db
    .prepare('SELECT id, emoji FROM message_reactions WHERE message_id = ? AND user_id = ?')
    .get(messageId, userId) as { id: number; emoji: string } | undefined;

  let action: 'add' | 'remove' | 'change';
  let oldEmoji: string | undefined;

  if (existing) {
    if (existing.emoji === emoji) {
      // Toggle off
      db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
      action = 'remove';
    } else {
      // Change reaction
      oldEmoji = existing.emoji;
      db.prepare("UPDATE message_reactions SET emoji = ?, created_at = datetime('now') WHERE id = ?").run(emoji, existing.id);
      action = 'change';
    }
  } else {
    db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(
      messageId,
      userId,
      emoji
    );
    action = 'add';
  }

  // Broadcast reaction over WebSocket
  broadcastToConversation(msg.conversation_id, {
    type: 'message:reaction',
    messageId,
    conversationId: msg.conversation_id,
    userId,
    emoji,
    action,
    oldEmoji,
  });

  res.json({ messageId, emoji, action, oldEmoji });
});
