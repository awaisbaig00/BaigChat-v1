import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../auth/session';
import { recordAuditEvent } from '../security/audit';
import { BlockUserSchema, BlockUserParamSchema } from '../validation/schemas';

export const blocksRouter = Router();

blocksRouter.use(requireAuth);

// GET /api/blocks - List all users blocked by caller
blocksRouter.get('/', (req: Request, res: Response) => {
  const currentUserId = req.user!.id;

  const rows = db
    .prepare(`
      SELECT u.id, u.email, b.created_at as blocked_at
      FROM blocks b
      JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ?
      ORDER BY b.created_at DESC
    `)
    .all(currentUserId) as Array<{ id: number; email: string; blocked_at: string }>;

  res.json({
    blockedUsers: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.email.split('@')[0],
      blockedAt: r.blocked_at,
    })),
  });
});

// POST /api/blocks - Block a user
blocksRouter.post('/', (req: Request, res: Response) => {
  const bodyResult = BlockUserSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: 'Invalid user ID to block' });
    return;
  }

  const currentUserId = req.user!.id;
  const { userId: targetUserId } = bodyResult.data;

  if (targetUserId === currentUserId) {
    res.status(400).json({ error: 'You cannot block yourself' });
    return;
  }

  const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  db.prepare(`
    INSERT OR IGNORE INTO blocks (blocker_id, blocked_id)
    VALUES (?, ?)
  `).run(currentUserId, targetUserId);

  recordAuditEvent({
    eventType: 'user_blocked',
    userId: currentUserId,
    ipAddress: req.ip,
    details: { blockedId: targetUserId },
  });

  res.status(201).json({ success: true, blockedUserId: targetUserId });
});

// DELETE /api/blocks/:userId - Unblock a user
blocksRouter.delete('/:userId', (req: Request, res: Response) => {
  const paramResult = BlockUserParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid user ID' });
    return;
  }

  const currentUserId = req.user!.id;
  const { userId: targetUserId } = paramResult.data;

  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(currentUserId, targetUserId);

  res.json({ success: true, unblockedUserId: targetUserId });
});
