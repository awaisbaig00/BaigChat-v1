import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../auth/session';
import { isUserOnline, broadcastToConversation } from '../ws/presence';
import { ConversationIdParamSchema, MessagesQuerySchema, MuteConversationSchema } from '../validation/schemas';

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);

// GET /api/conversations (list direct chats and groups with last message, unread count, recipient/group title)
conversationsRouter.get('/', (req: Request, res: Response) => {
  const userId = req.user!.id;

  const convos = db
    .prepare(`
      SELECT 
        c.id,
        c.type,
        c.name,
        c.created_by,
        c.created_at,
        cm.role,
        cm.muted_until
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
      ORDER BY c.created_at DESC
    `)
    .all(userId) as Array<{
    id: string;
    type: string;
    name: string | null;
    created_by: number | null;
    created_at: string;
    role: string;
    muted_until: string | null;
  }>;

  const results = convos.map((convo) => {
    const isGroup = convo.type === 'group';

    // Last message (excluding any message from users whom caller has blocked)
    const lastMsg = db
      .prepare(`
        SELECT m.id, m.sender_id, m.client_msg_id, m.content, m.type as msg_type, m.created_at, m.delivered_at, m.read_at, m.attachment_id,
               a.original_name as att_original_name, a.mime as att_mime, a.size as att_size
        FROM messages m
        LEFT JOIN attachments a ON a.id = m.attachment_id
        WHERE m.conversation_id = ?
          AND m.sender_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        ORDER BY m.id DESC
        LIMIT 1
      `)
      .get(convo.id, userId) as any;

    // Unread count (excluding any messages from blocked users)
    const unreadCountRow = db
      .prepare(`
        SELECT COUNT(*) as count
        FROM messages
        WHERE conversation_id = ? 
          AND sender_id != ? 
          AND read_at IS NULL
          AND sender_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
      `)
      .get(convo.id, userId, userId) as { count: number };

    let recipientData = null;
    let title = convo.name || 'Chat';
    let memberCount = 1;

    if (isGroup) {
      const countRow = db
        .prepare('SELECT COUNT(*) as count FROM conversation_members WHERE conversation_id = ?')
        .get(convo.id) as { count: number };
      memberCount = countRow ? countRow.count : 1;
      title = convo.name || 'Group Chat';
    } else {
      // Direct conversation: fetch other member
      const otherUser = db
        .prepare(`
          SELECT u.id, u.email, u.username, u.display_name, u.avatar_attachment_id,
                 u.show_online, u.show_last_seen, u.last_seen
          FROM conversation_members cm
          JOIN users u ON u.id = cm.user_id
          WHERE cm.conversation_id = ? AND cm.user_id != ?
          LIMIT 1
        `)
        .get(convo.id, userId) as any;

      if (otherUser) {
        // Check if other user has blocked the caller
        const isBlockedByOther = db
          .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
          .get(otherUser.id, userId);

        const callerUser = db.prepare('SELECT show_online, show_last_seen FROM users WHERE id = ?').get(userId) as any;
        const callerOnlineAllowed = callerUser ? callerUser.show_online === 1 : true;
        const callerLastSeenAllowed = callerUser ? callerUser.show_last_seen === 1 : true;

        const effectiveOnline = (!isBlockedByOther && callerOnlineAllowed && otherUser.show_online === 1)
          ? isUserOnline(otherUser.id)
          : false;

        const effectiveLastSeen = (!isBlockedByOther && callerLastSeenAllowed && otherUser.show_last_seen === 1)
          ? otherUser.last_seen
          : null;

        const displayName = otherUser.display_name || otherUser.username || otherUser.email.split('@')[0];
        title = displayName;
        recipientData = {
          id: otherUser.id,
          email: otherUser.email,
          username: otherUser.username,
          name: displayName,
          avatarUrl: otherUser.avatar_attachment_id ? `/api/avatars/${otherUser.id}?size=thumb` : null,
          lastSeen: effectiveLastSeen,
          isOnline: effectiveOnline,
        };
      }
    }

    const rawMutedUntil = convo.muted_until ? String(convo.muted_until) : null;
    let isMuted = false;
    if (rawMutedUntil) {
      const normalizedMutedUntil = rawMutedUntil.endsWith('Z')
        ? rawMutedUntil
        : `${rawMutedUntil.replace(' ', 'T')}Z`;
      isMuted = new Date(normalizedMutedUntil).getTime() > Date.now();
    }

    return {
      id: convo.id,
      type: convo.type || 'direct',
      name: convo.name || null,
      title,
      role: convo.role || 'member',
      memberCount,
      createdAt: convo.created_at,
      recipient: recipientData,
      isMuted,
      mutedUntil: rawMutedUntil,
      lastMessage: lastMsg
        ? {
            id: lastMsg.id,
            senderId: lastMsg.sender_id,
            clientMsgId: lastMsg.client_msg_id,
            content:
              lastMsg.content ||
              (lastMsg.att_mime?.startsWith('image/')
                ? '📷 Photo'
                : lastMsg.att_original_name
                ? `📎 ${lastMsg.att_original_name}`
                : ''),
            type: lastMsg.msg_type || 'user',
            createdAt: lastMsg.created_at,
            deliveredAt: lastMsg.delivered_at,
            readAt: lastMsg.read_at,
            attachmentId: lastMsg.attachment_id || null,
            attachment: lastMsg.attachment_id
              ? {
                  id: lastMsg.attachment_id,
                  originalName: lastMsg.att_original_name,
                  mime: lastMsg.att_mime,
                  size: lastMsg.att_size,
                  url: `/api/attachments/${lastMsg.attachment_id}`,
                }
              : null,
          }
        : null,
      unreadCount: isMuted ? 0 : unreadCountRow.count,
    };
  });

  // Sort by latest activity
  results.sort((a, b) => {
    const timeA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
    const timeB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
    return timeB - timeA;
  });

  res.json({ conversations: results });
});

// GET /api/conversations/:id/messages?before=&limit=50 (membership check, cursor pagination)
conversationsRouter.get('/:id/messages', (req: Request, res: Response) => {
  const paramResult = ConversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid conversation ID' });
    return;
  }

  const queryResult = MessagesQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    res.status(400).json({ error: 'Invalid query parameters' });
    return;
  }

  const userId = req.user!.id;
  const { id: conversationId } = paramResult.data;
  const { limit, before } = queryResult.data;

  // Membership check
  const member = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);

  if (!member) {
    res.status(403).json({ error: 'You are not a member of this conversation' });
    return;
  }

  let messages: any[];
  if (before !== undefined) {
    messages = db
      .prepare(`
        SELECT m.id, m.sender_id, m.client_msg_id, m.content, m.type as msg_type,
               m.created_at, m.delivered_at, m.read_at, m.attachment_id,
               m.edited_at, m.is_deleted, m.reply_to_id,
               a.original_name as att_original_name, a.mime as att_mime, a.size as att_size
        FROM messages m
        LEFT JOIN attachments a ON a.id = m.attachment_id
        WHERE m.conversation_id = ? 
          AND m.id < ?
          AND m.id NOT IN (SELECT message_id FROM message_deletions WHERE user_id = ?)
          AND m.sender_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        ORDER BY m.id DESC
        LIMIT ?
      `)
      .all(conversationId, before, userId, userId, limit) as any[];
  } else {
    messages = db
      .prepare(`
        SELECT m.id, m.sender_id, m.client_msg_id, m.content, m.type as msg_type,
               m.created_at, m.delivered_at, m.read_at, m.attachment_id,
               m.edited_at, m.is_deleted, m.reply_to_id,
               a.original_name as att_original_name, a.mime as att_mime, a.size as att_size
        FROM messages m
        LEFT JOIN attachments a ON a.id = m.attachment_id
        WHERE m.conversation_id = ?
          AND m.id NOT IN (SELECT message_id FROM message_deletions WHERE user_id = ?)
          AND m.sender_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        ORDER BY m.id DESC
        LIMIT ?
      `)
      .all(conversationId, userId, userId, limit) as any[];
  }

  // Reverse so messages are in chronological ascending order
  messages.reverse();

  res.json({
    messages: messages.map((m) => {
      // Fetch reply quote snapshot if reply_to_id is set
      let replyQuote = null;
      if (m.reply_to_id) {
        const quoted = db
          .prepare(`
            SELECT m2.id, m2.sender_id, m2.content, m2.attachment_id,
                   u.display_name, u.username, u.email
            FROM messages m2
            JOIN users u ON u.id = m2.sender_id
            WHERE m2.id = ?
          `)
          .get(m.reply_to_id) as any;
        if (quoted) {
          replyQuote = {
            id: quoted.id,
            senderId: quoted.sender_id,
            senderName: quoted.display_name || quoted.username || quoted.email.split('@')[0],
            content: quoted.content.slice(0, 100),
            hasAttachment: !!quoted.attachment_id,
          };
        }
      }

      // Fetch emoji reactions
      const rxRows = db
        .prepare('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?')
        .all(m.id) as Array<{ emoji: string; user_id: number }>;

      const rxMap = new Map<string, { emoji: string; count: number; userReacted: boolean; userIds: number[] }>();
      for (const rx of rxRows) {
        if (!rxMap.has(rx.emoji)) {
          rxMap.set(rx.emoji, { emoji: rx.emoji, count: 0, userReacted: false, userIds: [] });
        }
        const entry = rxMap.get(rx.emoji)!;
        entry.count += 1;
        entry.userIds.push(rx.user_id);
        if (rx.user_id === userId) entry.userReacted = true;
      }

      return {
        id: m.id,
        senderId: m.sender_id,
        clientMsgId: m.client_msg_id,
        content: m.content,
        type: m.msg_type || 'user',
        createdAt: m.created_at,
        deliveredAt: m.delivered_at,
        readAt: m.read_at,
        editedAt: m.edited_at || null,
        isDeleted: !!m.is_deleted,
        replyToId: m.reply_to_id || null,
        replyQuote,
        reactions: Array.from(rxMap.values()),
        attachmentId: m.attachment_id || null,
        attachment: m.attachment_id
          ? {
              id: m.attachment_id,
              originalName: m.att_original_name,
              mime: m.att_mime,
              size: m.att_size,
              url: `/api/attachments/${m.attachment_id}`,
            }
          : null,
      };
    }),
  });
});

// POST /api/conversations/:id/read
conversationsRouter.post('/:id/read', (req: Request, res: Response) => {
  const paramResult = ConversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid conversation ID' });
    return;
  }

  const userId = req.user!.id;
  const { id: conversationId } = paramResult.data;

  const member = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);

  if (!member) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  const result = db
    .prepare(`
      UPDATE messages
      SET read_at = datetime('now')
      WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL
    `)
    .run(conversationId, userId);

  if (result.changes > 0) {
    broadcastToConversation(
      conversationId,
      {
        type: 'message:read',
        conversationId,
        readByUserId: userId,
        readAt: new Date().toISOString(),
      },
      userId
    );
  }

  res.json({ success: true, updated: result.changes });
});

// POST /api/conversations/:id/mute (Per-chat mute: 8h, 1w, always, or unmute)
conversationsRouter.post('/:id/mute', (req: Request, res: Response) => {
  const paramResult = ConversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid conversation ID' });
    return;
  }

  const bodyResult = MuteConversationSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: bodyResult.error.issues?.[0]?.message ?? 'Invalid mute request' });
    return;
  }

  const userId = req.user!.id;
  const { id: conversationId } = paramResult.data;
  const { duration } = bodyResult.data;

  const member = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);

  if (!member) {
    res.status(403).json({ error: 'You are not a member of this conversation' });
    return;
  }

  let mutedUntil: string | null = null;
  if (duration === '8h') {
    mutedUntil = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  } else if (duration === '1w') {
    mutedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  } else if (duration === 'always') {
    mutedUntil = '9999-12-31T23:59:59.000Z';
  } else if (duration === 'unmute') {
    mutedUntil = null;
  }

  db.prepare(`
    UPDATE conversation_members
    SET muted_until = ?
    WHERE conversation_id = ? AND user_id = ?
  `).run(mutedUntil, conversationId, userId);

  res.json({
    success: true,
    conversationId,
    isMuted: duration !== 'unmute',
    mutedUntil,
  });
});

