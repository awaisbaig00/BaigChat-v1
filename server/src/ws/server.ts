import { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cookie from 'cookie';
import { CORS_ORIGIN } from '../config';
import { db } from '../db';
import { hashToken, SESSION_COOKIE_NAME } from '../auth/session';
import {
  registerSocket,
  unregisterSocket,
  broadcastToConversation,
  getConversationMemberIds,
  isUserOnline,
  sendToUser,
  broadcastPresence,
  setTyping,
  clearTyping,
  clearAllUserTyping,
} from './presence';
import {
  WsIncomingEventSchema,
  WsSendMessageSchema,
  WsReadMessageSchema,
  WsTypingStartSchema,
  WsTypingStopSchema,
  WsSyncRequestSchema,
} from '../validation/schemas';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: number;
  email?: string;
  isAlive?: boolean;
  messageTimestamps?: number[];
}

export function setupWebSocket(server: HttpServer) {
  // Max payload set to 16 KB (16,384 bytes)
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
  });

  // Handle HTTP upgrade with strict Origin check and Session cookie auth
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const origin = req.headers.origin;

    // Strict Origin check against CORS_ORIGIN
    if (!origin || origin !== CORS_ORIGIN) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }

    // Parse session cookie
    const cookiesHeader = req.headers.cookie;
    if (!cookiesHeader) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }

    const parsedCookies = cookie.parse(cookiesHeader);
    const rawSessionId = parsedCookies[SESSION_COOKIE_NAME];

    if (!rawSessionId) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }

    const sessionHash = hashToken(rawSessionId);
    const session = db
      .prepare(`
        SELECT s.user_id, u.email
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND datetime(s.expires_at) > datetime('now')
      `)
      .get(sessionHash) as { user_id: number; email: string } | undefined;

    if (!session) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const authWs = ws as AuthenticatedWebSocket;
      authWs.userId = session.user_id;
      authWs.email = session.email;
      authWs.isAlive = true;
      authWs.messageTimestamps = [];
      wss.emit('connection', authWs, req);
    });
  });

  // Keep-alive heartbeat interval (30s)
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      const ws = client as AuthenticatedWebSocket;
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws: AuthenticatedWebSocket) => {
    const userId = ws.userId!;
    const isFirstConnection = registerSocket(userId, ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // If user came online, broadcast presence to shared contacts only
    if (isFirstConnection) {
      broadcastPresence(userId, 'online');
    }

    ws.on('message', (raw) => {
      // 1. Rate-limit messages per connection (max 20 per 10s)
      const now = Date.now();
      if (!ws.messageTimestamps) ws.messageTimestamps = [];
      while (ws.messageTimestamps.length > 0 && ws.messageTimestamps[0] <= now - 10000) {
        ws.messageTimestamps.shift();
      }
      ws.messageTimestamps.push(now);

      if (ws.messageTimestamps.length > 20) {
        ws.close(1008, 'Rate limit exceeded');
        return;
      }

      // 2. Parse JSON
      let data: any;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON payload' }));
        return;
      }

      // Support legacy mappings
      if (data.type === 'send_message') data.type = 'message:send';
      if (data.type === 'typing') data.type = data.isTyping ? 'typing:start' : 'typing:stop';
      if (data.type === 'mark_read') data.type = 'message:read';

      // 3. Validate incoming event with Zod
      const parsedEvent = WsIncomingEventSchema.safeParse(data);
      if (!parsedEvent.success) {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: parsedEvent.error.issues?.[0]?.message ?? 'Invalid event payload',
          })
        );
        return;
      }

      handleWsEvent(ws, parsedEvent.data);
    });

    ws.on('close', () => {
      clearAllUserTyping(userId);
      const isCompletelyOffline = unregisterSocket(userId, ws);
      if (isCompletelyOffline) {
        broadcastPresence(userId, 'offline');
      }
    });

    ws.on('error', (err) => {
      // Catch oversized payload or socket errors without crashing
      console.warn(`WebSocket error on socket for user ${userId}:`, err?.message || err);
    });
  });
}

function checkMembership(conversationId: string, userId: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
  return !!row;
}

function handleWsEvent(ws: AuthenticatedWebSocket, event: any) {
  const userId = ws.userId!;

  // 1. Verify membership for target conversation (Derive identity from session, never payload)
  if (!checkMembership(event.conversationId, userId)) {
    ws.send(JSON.stringify({ type: 'error', error: 'Not a member of this conversation' }));
    return;
  }

  switch (event.type) {
    case 'message:send': {
      const { conversationId, clientMsgId, content, attachmentId, replyToId } = event;

      // Quoted reply handling
      let replyQuote: any = null;
      if (replyToId) {
        const quoted = db
          .prepare(`
            SELECT m.id, m.sender_id, m.content, m.attachment_id,
                   u.display_name, u.username, u.email
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.id = ? AND m.conversation_id = ? AND m.is_deleted = 0
          `)
          .get(replyToId, conversationId) as any;
        if (!quoted) {
          ws.send(JSON.stringify({ type: 'error', error: 'Replied-to message not found in this conversation' }));
          return;
        }
        replyQuote = {
          id: quoted.id,
          senderId: quoted.sender_id,
          senderName: quoted.display_name || quoted.username || quoted.email.split('@')[0],
          content: quoted.content.slice(0, 100),
          hasAttachment: !!quoted.attachment_id,
        };
      }

      // Attachment verification and authorization
      let attachmentData: any = null;
      if (attachmentId) {
        const att = db
          .prepare('SELECT id, uploader_id, conversation_id, original_name, mime, size FROM attachments WHERE id = ?')
          .get(attachmentId) as
          | {
              id: string;
              uploader_id: number;
              conversation_id: string | null;
              original_name: string;
              mime: string;
              size: number;
            }
          | undefined;

        if (!att) {
          ws.send(JSON.stringify({ type: 'error', error: 'Attachment not found' }));
          return;
        }

        if (att.uploader_id !== userId) {
          ws.send(JSON.stringify({ type: 'error', error: 'Cannot attach a file uploaded by another user' }));
          return;
        }

        if (att.conversation_id !== null) {
          ws.send(JSON.stringify({ type: 'error', error: 'Attachment has already been linked to a conversation' }));
          return;
        }

        attachmentData = {
          id: att.id,
          originalName: att.original_name,
          mime: att.mime,
          size: att.size,
          url: `/api/attachments/${att.id}`,
        };
      }

      // Determine conversation type
      const convo = db
        .prepare('SELECT type FROM conversations WHERE id = ?')
        .get(conversationId) as { type: string } | undefined;
      const isGroup = convo?.type === 'group';

      // Check if recipient is online to set delivered_at (1:1 direct chats only)
      const members = getConversationMemberIds(conversationId);
      const recipientId = isGroup ? null : members.find((id) => id !== userId);

      // Blocked user DM check: Silently drop with generic ack
      if (!isGroup && recipientId) {
        const isBlocked = db
          .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
          .get(recipientId, userId);

        if (isBlocked) {
          // Silently drop with generic ack
          ws.send(
            JSON.stringify({
              type: 'message:ack',
              clientMsgId,
              message: {
                id: 0,
                conversationId,
                senderId: userId,
                clientMsgId,
                content: content || '',
                type: 'user',
                createdAt: new Date().toISOString(),
                deliveredAt: null,
                readAt: null,
                attachmentId: attachmentId || null,
                attachment: attachmentData,
              },
              status: 'sent',
            })
          );
          return;
        }
      }

      const isRecipientOnline = recipientId ? isUserOnline(recipientId) : false;
      const deliveredAt = !isGroup && isRecipientOnline ? new Date().toISOString() : null;

      try {
        // Link attachment to conversation atomically
        if (attachmentId) {
          const updateRes = db
            .prepare(
              'UPDATE attachments SET conversation_id = ? WHERE id = ? AND conversation_id IS NULL AND uploader_id = ?'
            )
            .run(conversationId, attachmentId, userId);

          if (updateRes.changes === 0) {
            ws.send(JSON.stringify({ type: 'error', error: 'Attachment already linked or unauthorized' }));
            return;
          }
        }

        const stmt = db.prepare(`
          INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type, delivered_at, attachment_id, reply_to_id)
          VALUES (?, ?, ?, ?, 'user', ?, ?, ?)
        `);

        const result = stmt.run(conversationId, userId, clientMsgId, content || '', deliveredAt, attachmentId || null, replyToId || null);
        const messageId = Number(result.lastInsertRowid);

        const newMsg = {
          id: messageId,
          conversationId,
          senderId: userId,
          clientMsgId,
          content: content || '',
          type: 'user',
          createdAt: new Date().toISOString(),
          deliveredAt,
          readAt: null,
          attachmentId: attachmentId || null,
          attachment: attachmentData,
          replyToId: replyToId || null,
          replyQuote,
          reactions: [],
        };

        // ACK to sender ("sent")
        ws.send(
          JSON.stringify({
            type: 'message:ack',
            clientMsgId,
            message: newMsg,
            status: 'sent',
          })
        );

        if (isGroup) {
          // Broadcast to other group members, hiding from anyone who has blocked the sender
          broadcastToConversation(
            conversationId,
            {
              type: 'message:new',
              message: newMsg,
            },
            userId,
            userId
          );
        } else if (recipientId) {
          // Push to recipient in 1:1 chat
          sendToUser(recipientId, {
            type: 'message:new',
            message: newMsg,
          });

          // If recipient is online, notify sender that message is delivered
          if (isRecipientOnline && deliveredAt) {
            ws.send(
              JSON.stringify({
                type: 'message:delivered',
                conversationId,
                messageId: newMsg.id,
                clientMsgId,
                deliveredAt,
              })
            );
          }
        }
      } catch (err: any) {
        // Retries never duplicate: on UNIQUE conflict, return existing row and re-ack
        if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          const existing = db
            .prepare(`
              SELECT m.id, m.conversation_id, m.sender_id, m.client_msg_id, m.content, m.type as msg_type, m.created_at, m.delivered_at, m.read_at, m.attachment_id,
                     a.original_name as att_original_name, a.mime as att_mime, a.size as att_size
              FROM messages m
              LEFT JOIN attachments a ON a.id = m.attachment_id
              WHERE m.conversation_id = ? AND m.sender_id = ? AND m.client_msg_id = ?
            `)
            .get(conversationId, userId, clientMsgId) as any;

          if (existing) {
            ws.send(
              JSON.stringify({
                type: 'message:ack',
                clientMsgId,
                message: {
                  id: existing.id,
                  conversationId: existing.conversation_id,
                  senderId: existing.sender_id,
                  clientMsgId: existing.client_msg_id,
                  content: existing.content,
                  type: existing.msg_type || 'user',
                  createdAt: existing.created_at,
                  deliveredAt: existing.delivered_at,
                  readAt: existing.read_at,
                  attachmentId: existing.attachment_id || null,
                  attachment: existing.attachment_id
                    ? {
                        id: existing.attachment_id,
                        originalName: existing.att_original_name,
                        mime: existing.att_mime,
                        size: existing.att_size,
                        url: `/api/attachments/${existing.attachment_id}`,
                      }
                    : null,
                },
                status: 'sent',
              })
            );
            return;
          }
        }
        console.error('Error inserting message');
        ws.send(JSON.stringify({ type: 'error', error: 'Failed to send message' }));
      }
      break;
    }

    case 'message:read': {
      const { conversationId, messageId } = event;
      const readAt = new Date().toISOString();

      let result;
      if (messageId) {
        result = db
          .prepare(`
            UPDATE messages
            SET read_at = ?
            WHERE conversation_id = ? AND sender_id != ? AND id <= ? AND read_at IS NULL
          `)
          .run(readAt, conversationId, userId, messageId);
      } else {
        result = db
          .prepare(`
            UPDATE messages
            SET read_at = ?
            WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL
          `)
          .run(readAt, conversationId, userId);
      }

      if (result.changes > 0) {
        broadcastToConversation(
          conversationId,
          {
            type: 'message:read',
            conversationId,
            messageId,
            readByUserId: userId,
            readAt,
          },
          userId
        );
      }
      break;
    }

    case 'typing:start': {
      setTyping(event.conversationId, userId);
      break;
    }

    case 'typing:stop': {
      clearTyping(event.conversationId, userId);
      break;
    }

    case 'sync:request': {
      const { conversationId, afterId } = event;
      const messages = db
        .prepare(`
          SELECT m.id, m.conversation_id, m.sender_id, m.client_msg_id, m.content, m.type as msg_type, m.created_at, m.delivered_at, m.read_at, m.attachment_id,
                 a.original_name as att_original_name, a.mime as att_mime, a.size as att_size
          FROM messages m
          LEFT JOIN attachments a ON a.id = m.attachment_id
          WHERE m.conversation_id = ? 
            AND m.id > ?
            AND m.sender_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
          ORDER BY m.id ASC
          LIMIT 100
        `)
        .all(conversationId, afterId || 0, userId) as any[];

      ws.send(
        JSON.stringify({
          type: 'sync:response',
          conversationId,
          messages: messages.map((m) => ({
            id: m.id,
            conversationId: m.conversation_id,
            senderId: m.sender_id,
            clientMsgId: m.client_msg_id,
            content: m.content,
            type: m.msg_type || 'user',
            createdAt: m.created_at,
            deliveredAt: m.delivered_at,
            readAt: m.read_at,
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
          })),
        })
      );
      break;
    }

    default:
      break;
  }
}
