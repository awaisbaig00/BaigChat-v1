import { useEffect, useRef, useState, useCallback } from 'react';
import type { Message, Attachment, MessageQuote } from './types';

interface SocketEvents {
  onNewMessage?: (msg: Message) => void;
  onMessageAck?: (ack: { clientMsgId: string; message: Message; status?: string }) => void;
  onMessageDelivered?: (delivered: { conversationId: string; messageId: number; clientMsgId: string; deliveredAt: string }) => void;
  onUserPresence?: (presence: { userId: number; status: 'online' | 'offline'; lastSeen: string }) => void;
  onUserTyping?: (typing: { conversationId: string; userId: number; isTyping: boolean }) => void;
  onMessagesRead?: (read: { conversationId: string; messageId?: number; readByUserId?: number; readAt: string }) => void;
  onSyncResponse?: (sync: { conversationId: string; messages: Message[] }) => void;
  onGroupEvent?: (evt: any) => void;
  onMessageUpdated?: (updated: { messageId: number; conversationId: string; content: string; editedAt: string }) => void;
  onMessageDeleted?: (deleted: { messageId: number; conversationId: string; forEveryone: boolean }) => void;
  onMessageReaction?: (reaction: { messageId: number; conversationId: string; userId: number; emoji: string; action: 'add' | 'remove' }) => void;
}

export function useChatSocket(
  enabled: boolean,
  activeConversationId: string | null,
  events: SocketEvents
) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const messageQueueRef = useRef<Array<{ type: string; conversationId: string; clientMsgId: string; content: string; attachmentId?: string; replyToId?: number }>>([]);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  const connect = useCallback(() => {
    if (!enabled) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttemptRef.current = 0;

      // On reconnect, send sync:request for currently open conversation
      if (activeConversationIdRef.current) {
        ws.send(
          JSON.stringify({
            type: 'sync:request',
            conversationId: activeConversationIdRef.current,
            afterId: 0,
          })
        );
      }

      // Flush and retry queued unsent messages with their original clientMsgId
      if (messageQueueRef.current.length > 0) {
        const queue = [...messageQueueRef.current];
        for (const item of queue) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(item));
          }
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'message:new':
          case 'new_message':
            eventsRef.current.onNewMessage?.(data.message);
            break;

          case 'message:ack':
          case 'message_ack':
            // Remove from retry queue
            if (data.clientMsgId) {
              messageQueueRef.current = messageQueueRef.current.filter((m) => m.clientMsgId !== data.clientMsgId);
            }
            eventsRef.current.onMessageAck?.(data);
            break;

          case 'message:delivered':
            eventsRef.current.onMessageDelivered?.(data);
            break;

          case 'message:read':
          case 'messages_read':
            eventsRef.current.onMessagesRead?.(data);
            break;

          case 'typing:start':
            eventsRef.current.onUserTyping?.({ conversationId: data.conversationId, userId: data.userId, isTyping: true });
            break;

          case 'typing:stop':
            eventsRef.current.onUserTyping?.({ conversationId: data.conversationId, userId: data.userId, isTyping: false });
            break;

          case 'user_typing':
            eventsRef.current.onUserTyping?.(data);
            break;

          case 'user:presence':
          case 'user_presence':
            eventsRef.current.onUserPresence?.(data);
            break;

          case 'sync:response':
            eventsRef.current.onSyncResponse?.(data);
            break;

          case 'message:updated':
            eventsRef.current.onMessageUpdated?.(data);
            break;

          case 'message:deleted':
            eventsRef.current.onMessageDeleted?.(data);
            break;

          case 'message:reaction':
            eventsRef.current.onMessageReaction?.(data);
            break;

          case 'group:removed':
          case 'group:deleted':
          case 'group:created':
          case 'group:updated':
          case 'group:member_added':
          case 'group:member_removed':
          case 'group:member_updated':
            eventsRef.current.onGroupEvent?.(data);
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('WebSocket parse error:', err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      socketRef.current = null;

      // Auto-reconnect with exponential backoff and jitter
      if (enabled) {
        const baseDelay = Math.min(1000 * Math.pow(1.5, reconnectAttemptRef.current), 10000);
        const jitter = Math.random() * 500;
        const timeout = baseDelay + jitter;
        reconnectAttemptRef.current += 1;

        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, timeout);
      }
    };

    ws.onerror = (err) => {
      console.warn('WebSocket connection error:', err);
    };
  }, [enabled]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connect]);

  const sendMessage = useCallback(
    (
      conversationId: string,
      content: string,
      senderId: number,
      attachmentId?: string | null,
      attachment?: Attachment | null,
      replyToId?: number | null,
      replyQuote?: MessageQuote | null
    ): Message => {
      const clientMsgId = crypto.randomUUID();
      const optimisticMessage: Message = {
        conversationId,
        senderId,
        clientMsgId,
        content,
        createdAt: new Date().toISOString(),
        deliveredAt: null,
        readAt: null,
        pending: true,
        attachmentId: attachmentId || null,
        attachment: attachment || null,
        replyToId: replyToId || null,
        replyQuote: replyQuote || null,
        reactions: [],
      };

      const payload = {
        type: 'message:send',
        conversationId,
        clientMsgId,
        content,
        attachmentId: attachmentId || undefined,
        replyToId: replyToId || undefined,
      };

      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify(payload));
      } else {
        // Queue unsent message for retry on reconnect
        messageQueueRef.current.push(payload);
      }

      return optimisticMessage;
    },
    []
  );

  const sendTypingStart = useCallback((conversationId: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(
      JSON.stringify({
        type: 'typing:start',
        conversationId,
      })
    );
  }, []);

  const sendTypingStop = useCallback((conversationId: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(
      JSON.stringify({
        type: 'typing:stop',
        conversationId,
      })
    );
  }, []);

  const markAsRead = useCallback((conversationId: string, messageId?: number) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(
      JSON.stringify({
        type: 'message:read',
        conversationId,
        messageId,
      })
    );
  }, []);

  const requestSync = useCallback((conversationId: string, afterId: number = 0) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(
      JSON.stringify({
        type: 'sync:request',
        conversationId,
        afterId,
      })
    );
  }, []);

  return {
    isConnected,
    sendMessage,
    sendTypingStart,
    sendTypingStop,
    markAsRead,
    requestSync,
  };
}
