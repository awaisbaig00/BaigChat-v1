import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import { requireAuth } from '../auth/session';
import { CLIENT_ORIGIN } from '../config';
import { CreateInviteSchema, InviteTokenParamSchema, InviteIdParamSchema } from '../validation/schemas';
import { broadcastToConversation } from '../ws/presence';
import { recordAuditEvent } from '../security/audit';

export const invitesRouter = Router();

const GENERIC_INVITE_ERROR = 'Invite link is invalid or expired';

// Rate limiter for creating invites (per user/IP)
const createInviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { default: false },
  keyGenerator: (req: Request) => (req.user ? `user_${req.user.id}` : (req.ip || 'anonymous')),
  message: { error: 'Too many invites created, please try again later' },
});

// Rate limiter for redeeming/accepting invites
const redeemInviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { default: false },
  keyGenerator: (req: Request) => (req.user ? `user_${req.user.id}` : (req.ip || 'anonymous')),
  message: { error: 'Too many invite redemption attempts, please try again later' },
});

// Create a new direct 1:1 invite link (128-bit random base64url token, SHA-256 hashed, 24h expiry, max_uses = 1)
invitesRouter.post('/', requireAuth, createInviteLimiter, (req: Request, res: Response) => {
  CreateInviteSchema.safeParse(req.body);
  const maxUses = 1; // Strict 1:1 single-use as specified

  // 128-bit random crypto token (16 bytes) in base64url
  const rawToken = crypto.randomBytes(16).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const inviteId = crypto.randomUUID();

  const expires = new Date();
  expires.setHours(expires.getHours() + 24);
  const expiresAt = expires.toISOString();

  const stmt = db.prepare(`
    INSERT INTO invites (id, token_hash, inviter_id, conversation_id, expires_at, max_uses, use_count, revoked)
    VALUES (?, ?, ?, NULL, ?, ?, 0, 0)
  `);

  try {
    stmt.run(inviteId, tokenHash, req.user!.id, expiresAt, maxUses);
    const fullLink = `${CLIENT_ORIGIN}/invite/${rawToken}`;
    res.status(201).json({
      id: inviteId,
      token: rawToken,
      link: fullLink,
      inviteUrl: fullLink,
      expiresAt,
      maxUses,
    });
  } catch (err) {
    console.error('Error creating invite:', err);
    res.status(500).json({ error: 'Failed to generate invite link' });
  }
});

// Read-only invite preview (safe for social preview bots, must NOT consume token)
invitesRouter.get('/:token', (req: Request, res: Response) => {
  const paramResult = InviteTokenParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(404).json({ error: GENERIC_INVITE_ERROR });
    return;
  }
  const { token } = paramResult.data;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const stmt = db.prepare(`
    SELECT i.id, i.conversation_id, i.expires_at, i.max_uses, i.use_count, i.revoked, i.inviter_id, u.email AS inviter_email
    FROM invites i
    JOIN users u ON u.id = i.inviter_id
    WHERE i.token_hash = ?
  `);

  const invite = stmt.get(tokenHash) as
    | {
        id: string;
        conversation_id: string | null;
        expires_at: string;
        max_uses: number;
        use_count: number;
        revoked: number;
        inviter_id: number;
        inviter_email: string;
      }
    | undefined;

  if (
    !invite ||
    invite.revoked === 1 ||
    invite.use_count >= invite.max_uses ||
    new Date(invite.expires_at).getTime() <= Date.now()
  ) {
    res.status(404).json({ error: GENERIC_INVITE_ERROR });
    return;
  }

  const displayName = invite.inviter_email.split('@')[0];

  if (invite.conversation_id) {
    const group = db
      .prepare('SELECT name FROM conversations WHERE id = ? AND type = \'group\'')
      .get(invite.conversation_id) as { name: string } | undefined;

    const countRow = db
      .prepare('SELECT COUNT(*) as count FROM conversation_members WHERE conversation_id = ?')
      .get(invite.conversation_id) as { count: number } | undefined;

    res.json({
      valid: true,
      isGroup: true,
      inviteId: invite.id,
      conversationId: invite.conversation_id,
      groupName: group?.name || 'Group Chat',
      memberCount: countRow?.count || 1,
      inviterId: invite.inviter_id,
      inviterEmail: invite.inviter_email,
      inviterName: displayName,
      expiresAt: invite.expires_at,
    });
    return;
  }

  res.json({
    valid: true,
    isGroup: false,
    inviteId: invite.id,
    inviterId: invite.inviter_id,
    inviterEmail: invite.inviter_email,
    inviterName: displayName,
    expiresAt: invite.expires_at,
  });
});

// Accept invite link: atomic redemption and conversation join
invitesRouter.post('/:token/accept', requireAuth, redeemInviteLimiter, (req: Request, res: Response) => {
  const paramResult = InviteTokenParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(404).json({ error: GENERIC_INVITE_ERROR });
    return;
  }
  const { token } = paramResult.data;

  const currentUserId = req.user!.id;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // Verify invite existence and inviter identity
  const invite = db
    .prepare('SELECT id, conversation_id, inviter_id, expires_at, max_uses, use_count, revoked FROM invites WHERE token_hash = ?')
    .get(tokenHash) as
    | { id: string; conversation_id: string | null; inviter_id: number; expires_at: string; max_uses: number; use_count: number; revoked: number }
    | undefined;

  // Invalid, expired, used, and revoked tokens all return the same generic 404 message
  if (
    !invite ||
    invite.revoked === 1 ||
    invite.use_count >= invite.max_uses ||
    new Date(invite.expires_at).getTime() <= Date.now()
  ) {
    res.status(404).json({ error: GENERIC_INVITE_ERROR });
    return;
  }

  // Block checks: Blocked users cannot redeem blocker's invites
  const isBlocked = db
    .prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
    .get(invite.inviter_id, currentUserId, currentUserId, invite.inviter_id);

  if (isBlocked) {
    res.status(404).json({ error: GENERIC_INVITE_ERROR });
    return;
  }

  // -------------------------------------------------------------
  // Group Invite Flow
  // -------------------------------------------------------------
  if (invite.conversation_id) {
    const convoId = invite.conversation_id;

    // Check if user was removed from this group
    const wasRemoved = db
      .prepare('SELECT 1 FROM group_removed_members WHERE conversation_id = ? AND user_id = ?')
      .get(convoId, currentUserId);

    if (wasRemoved) {
      res.status(404).json({ error: GENERIC_INVITE_ERROR });
      return;
    }

    // Check if group exists and owner has blocked user
    const group = db
      .prepare('SELECT id, created_by, name FROM conversations WHERE id = ? AND type = \'group\'')
      .get(convoId) as { id: string; created_by: number; name: string } | undefined;

    if (!group) {
      res.status(404).json({ error: GENERIC_INVITE_ERROR });
      return;
    }

    if (group.created_by) {
      const ownerBlocked = db
        .prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
        .get(group.created_by, currentUserId, currentUserId, group.created_by);
      if (ownerBlocked) {
        res.status(404).json({ error: GENERIC_INVITE_ERROR });
        return;
      }
    }

    // Check if already a member
    const existingMember = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convoId, currentUserId);

    if (existingMember) {
      res.json({ conversationId: convoId, alreadyMember: true });
      return;
    }

    // Redeem atomically: enforce max_uses and 100 member cap in the SAME transaction
    const redeemGroupTx = db.transaction(() => {
      const updateStmt = db.prepare(`
        UPDATE invites
        SET use_count = use_count + 1
        WHERE token_hash = ?
          AND use_count < max_uses
          AND datetime(expires_at) > datetime('now')
          AND revoked = 0
      `);

      const resUpdate = updateStmt.run(tokenHash);
      if (resUpdate.changes === 0) {
        throw new Error('INVITE_EXPIRED_OR_CONSUMED');
      }

      // Check 100 cap
      const memberCountRow = db
        .prepare('SELECT COUNT(*) as count FROM conversation_members WHERE conversation_id = ?')
        .get(convoId) as { count: number };

      if (memberCountRow.count >= 100) {
        throw new Error('GROUP_CAP_EXCEEDED');
      }

      // Add to conversation_members
      db.prepare(`
        INSERT INTO conversation_members (conversation_id, user_id, role)
        VALUES (?, ?, 'member')
      `).run(convoId, currentUserId);

      // System message
      const userName = req.user!.email.split('@')[0];
      const clientMsgId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
        VALUES (?, ?, ?, ?, 'system')
      `).run(convoId, currentUserId, clientMsgId, `${userName} joined via invite link`);
    });

    try {
      redeemGroupTx();

      // Broadcast system message via WS
      const userName = req.user!.email.split('@')[0];
      broadcastToConversation(convoId, {
        type: 'message:new',
        message: {
          id: 0,
          conversationId: convoId,
          senderId: currentUserId,
          clientMsgId: crypto.randomUUID(),
          content: `${userName} joined via invite link`,
          type: 'system',
          createdAt: new Date().toISOString(),
          deliveredAt: null,
          readAt: null,
          attachmentId: null,
          attachment: null,
        },
      });

      recordAuditEvent({
        eventType: 'group_invite_redeemed',
        userId: currentUserId,
        ipAddress: req.ip,
        details: { inviteId: invite.id, groupId: convoId },
      });

      res.json({ conversationId: convoId });
      return;
    } catch (err: any) {
      if (err?.message === 'INVITE_EXPIRED_OR_CONSUMED' || err?.message === 'GROUP_CAP_EXCEEDED') {
        res.status(404).json({ error: GENERIC_INVITE_ERROR });
        return;
      }
      console.error('Error redeeming group invite:', err);
      res.status(500).json({ error: 'Failed to accept invite' });
      return;
    }
  }

  // -------------------------------------------------------------
  // Direct 1:1 Invite Flow
  // -------------------------------------------------------------
  // Block self-redemption
  if (invite.inviter_id === currentUserId) {
    res.status(400).json({ error: 'You cannot accept your own invite' });
    return;
  }

  // Redeem atomically in transaction with UPDATE ... WHERE use_count < max_uses AND expires_at > now AND revoked = 0
  const redeemTransaction = db.transaction(() => {
    const updateStmt = db.prepare(`
      UPDATE invites
      SET use_count = use_count + 1, accepted_by = ?
      WHERE token_hash = ?
        AND use_count < max_uses
        AND datetime(expires_at) > datetime('now')
        AND revoked = 0
    `);

    const result = updateStmt.run(currentUserId, tokenHash);
    if (result.changes === 0) {
      throw new Error('INVITE_EXPIRED_OR_CONSUMED');
    }

    // Check or create 1:1 conversation with unique pair_key (minUserId:maxUserId)
    const minUserId = Math.min(invite.inviter_id, currentUserId);
    const maxUserId = Math.max(invite.inviter_id, currentUserId);
    const pairKey = `${minUserId}:${maxUserId}`;

    let convo = db.prepare('SELECT id FROM conversations WHERE pair_key = ?').get(pairKey) as { id: string } | undefined;

    if (!convo) {
      const convoId = crypto.randomUUID();
      db.prepare('INSERT INTO conversations (id, pair_key, type) VALUES (?, ?, \'direct\')').run(convoId, pairKey);
      db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, \'member\')').run(convoId, invite.inviter_id);
      db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, \'member\')').run(convoId, currentUserId);
      convo = { id: convoId };
    } else {
      // Ensure both are marked members
      db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, \'member\')').run(convo.id, invite.inviter_id);
      db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, \'member\')').run(convo.id, currentUserId);
    }

    return convo.id;
  });

  try {
    const conversationId = redeemTransaction();

    recordAuditEvent({
      eventType: 'invite_redeemed',
      userId: currentUserId,
      ipAddress: req.ip,
      details: { inviteId: invite.id },
    });

    res.json({ conversationId });
  } catch (err: any) {
    if (err?.message === 'INVITE_EXPIRED_OR_CONSUMED') {
      res.status(404).json({ error: GENERIC_INVITE_ERROR });
      return;
    }
    console.error('Error accepting invite:', err);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// Decline invite
invitesRouter.post('/:token/decline', (req: Request, res: Response) => {
  const paramResult = InviteTokenParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(404).json({ error: GENERIC_INVITE_ERROR });
    return;
  }
  const { token } = paramResult.data;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const invite = db.prepare('SELECT id, expires_at, max_uses, use_count, revoked FROM invites WHERE token_hash = ?').get(tokenHash) as
    | { id: string; expires_at: string; max_uses: number; use_count: number; revoked: number }
    | undefined;

  if (
    !invite ||
    invite.revoked === 1 ||
    invite.use_count >= invite.max_uses ||
    new Date(invite.expires_at).getTime() <= Date.now()
  ) {
    res.status(404).json({ error: GENERIC_INVITE_ERROR });
    return;
  }

  res.json({ success: true, message: 'Invite declined' });
});

// Delete / revoke invite (creator only)
invitesRouter.delete('/:id', requireAuth, (req: Request, res: Response) => {
  const paramResult = InviteIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid invite ID' });
    return;
  }
  const { id } = paramResult.data;
  const currentUserId = req.user!.id;

  const invite = db.prepare('SELECT id, inviter_id, revoked FROM invites WHERE id = ?').get(id) as
    | { id: string; inviter_id: number; revoked: number }
    | undefined;

  if (!invite) {
    res.status(404).json({ error: 'Invite not found' });
    return;
  }

  if (invite.inviter_id !== currentUserId) {
    res.status(403).json({ error: 'Only the creator can revoke this invite' });
    return;
  }

  db.prepare('UPDATE invites SET revoked = 1 WHERE id = ?').run(id);

  recordAuditEvent({
    eventType: 'invite_revoked',
    userId: currentUserId,
    ipAddress: req.ip,
    details: { inviteId: id },
  });

  res.json({ success: true, message: 'Invite revoked' });
});
