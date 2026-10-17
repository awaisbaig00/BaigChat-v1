import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import { requireAuth } from '../auth/session';
import { recordAuditEvent } from '../security/audit';
import { CreateReportSchema } from '../validation/schemas';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

// Rate limit: 10 reports per 24 hours per user
const reportLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { default: false },
  keyGenerator: (req: Request) => (req.user ? `user_${req.user.id}` : (req.ip || 'anonymous')),
  message: { error: 'Daily report limit reached. Please try again tomorrow.' },
});

// POST /api/reports - Report a user/message in a conversation
reportsRouter.post('/', reportLimiter, (req: Request, res: Response) => {
  const bodyResult = CreateReportSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: bodyResult.error.issues[0]?.message || 'Invalid report payload' });
    return;
  }

  const currentUserId = req.user!.id;
  const { reportedUserId, conversationId, messageId, reason, details } = bodyResult.data;

  // Cannot report oneself
  if (reportedUserId === currentUserId) {
    res.status(400).json({ error: 'You cannot report yourself' });
    return;
  }

  // Reporter must be a member of the conversation
  const member = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, currentUserId);

  if (!member) {
    res.status(403).json({ error: 'You must be a member of the conversation to report a user' });
    return;
  }

  // Reported user must exist
  const reportedUser = db.prepare('SELECT id FROM users WHERE id = ?').get(reportedUserId);
  if (!reportedUser) {
    res.status(404).json({ error: 'Reported user not found' });
    return;
  }

  // If messageId provided, verify message exists in this conversation and capture snapshot
  let messageSnapshot: string | null = null;
  if (messageId) {
    const msg = db
      .prepare('SELECT content FROM messages WHERE id = ? AND conversation_id = ?')
      .get(messageId, conversationId) as { content: string } | undefined;

    if (!msg) {
      res.status(400).json({ error: 'Specified message not found in this conversation' });
      return;
    }
    messageSnapshot = msg.content;
  }

  const reportId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO reports (id, reporter_id, reported_user_id, conversation_id, message_id, reason, details, message_snapshot, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    reportId,
    currentUserId,
    reportedUserId,
    conversationId,
    messageId || null,
    reason,
    details || null,
    messageSnapshot
  );

  recordAuditEvent({
    eventType: 'user_reported',
    userId: currentUserId,
    ipAddress: req.ip,
    details: { reportedUserId, conversationId, reason },
  });

  res.status(201).json({
    success: true,
    reportId,
    message: 'Report submitted successfully',
  });
});
