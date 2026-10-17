import { WebSocket } from 'ws';
import { db } from '../db';

// Maps userId -> Set of connected WebSockets
export const userSockets = new Map<number, Set<WebSocket>>();

// Maps `${conversationId}:${userId}` -> NodeJS.Timeout for 5s auto-expiry
export const typingTimers = new Map<string, NodeJS.Timeout>();

export function isUserOnline(userId: number): boolean {
  const sockets = userSockets.get(userId);
  return !!sockets && sockets.size > 0;
}

export function registerSocket(userId: number, ws: WebSocket): boolean {
  let sockets = userSockets.get(userId);
  const wasOnline = !!sockets && sockets.size > 0;
  if (!sockets) {
    sockets = new Set<WebSocket>();
    userSockets.set(userId, sockets);
  }
  sockets.add(ws);
  return !wasOnline; // true if this is the user's first connection
}

export function unregisterSocket(userId: number, ws: WebSocket): boolean {
  const sockets = userSockets.get(userId);
  if (!sockets) return false;

  sockets.delete(ws);
  if (sockets.size === 0) {
    userSockets.delete(userId);
    // Update last_seen in users table
    try {
      db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(userId);
    } catch (err) {
      console.error('Failed to update last_seen on disconnect:', err);
    }
    return true; // true if user is now completely offline
  }
  return false;
}

export function sendToUser(userId: number, message: any): void {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

export function getConversationMemberIds(conversationId: string): number[] {
  const rows = db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(conversationId) as Array<{ user_id: number }>;
  return rows.map((r) => r.user_id);
}

export function broadcastToConversation(
  conversationId: string,
  message: any,
  excludeUserId?: number,
  senderIdForBlockCheck?: number
): void {
  const memberIds = getConversationMemberIds(conversationId);
  for (const memberId of memberIds) {
    if (excludeUserId !== undefined && memberId === excludeUserId) {
      continue;
    }
    if (senderIdForBlockCheck !== undefined) {
      // In groups, blocking hides that user's messages for the blocker only
      const isBlocked = db
        .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
        .get(memberId, senderIdForBlockCheck);
      if (isBlocked) {
        continue;
      }
    }
    sendToUser(memberId, message);
  }
}

/**
 * Broadcasts presence only to users who share at least one conversation with this user
 * Excludes users who have blocked this user or are blocked by this user
 */
export function broadcastPresence(userId: number, status: 'online' | 'offline', lastSeen?: string): void {
  const sender = db.prepare('SELECT show_online, show_last_seen FROM users WHERE id = ?').get(userId) as
    | { show_online: number; show_last_seen: number }
    | undefined;

  const contacts = db
    .prepare(`
      SELECT DISTINCT other_cm.user_id, u.show_online, u.show_last_seen
      FROM conversation_members cm
      JOIN conversation_members other_cm 
        ON other_cm.conversation_id = cm.conversation_id 
        AND other_cm.user_id != cm.user_id
      JOIN users u ON u.id = other_cm.user_id
      WHERE cm.user_id = ?
        AND other_cm.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        AND other_cm.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
    `)
    .all(userId, userId, userId) as Array<{ user_id: number; show_online: number; show_last_seen: number }>;

  const senderOnlineAllowed = sender ? sender.show_online === 1 : true;
  const senderLastSeenAllowed = sender ? sender.show_last_seen === 1 : true;

  for (const contact of contacts) {
    const recipientOnlineAllowed = contact.show_online === 1;
    const recipientLastSeenAllowed = contact.show_last_seen === 1;

    const effectiveStatus = (senderOnlineAllowed && recipientOnlineAllowed) ? status : 'offline';
    const effectiveLastSeen = (senderLastSeenAllowed && recipientLastSeenAllowed)
      ? (lastSeen || new Date().toISOString())
      : null;

    sendToUser(contact.user_id, {
      type: 'user:presence',
      userId,
      status: effectiveStatus,
      lastSeen: effectiveLastSeen,
    });
  }
}

/**
 * Start typing indicator: sets 5s memory timer and notifies other conversation members
 */
export function setTyping(conversationId: string, userId: number): void {
  const key = `${conversationId}:${userId}`;
  const existingTimer = typingTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Broadcast typing start
  broadcastToConversation(
    conversationId,
    {
      type: 'typing:start',
      conversationId,
      userId,
    },
    userId
  );

  // Auto-expire after 5 seconds without refresh
  const timer = setTimeout(() => {
    typingTimers.delete(key);
    broadcastToConversation(
      conversationId,
      {
        type: 'typing:stop',
        conversationId,
        userId,
      },
      userId
    );
  }, 5000);

  typingTimers.set(key, timer);
}

/**
 * Stop typing indicator immediately
 */
export function clearTyping(conversationId: string, userId: number): void {
  const key = `${conversationId}:${userId}`;
  const existingTimer = typingTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
    typingTimers.delete(key);
  }

  broadcastToConversation(
    conversationId,
    {
      type: 'typing:stop',
      conversationId,
      userId,
    },
    userId
  );
}

/**
 * Clears all typing timers for a given user (on disconnect)
 */
export function clearAllUserTyping(userId: number): void {
  for (const [key, timer] of typingTimers.entries()) {
    if (key.endsWith(`:${userId}`)) {
      clearTimeout(timer);
      typingTimers.delete(key);
      const conversationId = key.split(':')[0];
      broadcastToConversation(
        conversationId,
        {
          type: 'typing:stop',
          conversationId,
          userId,
        },
        userId
      );
    }
  }
}
