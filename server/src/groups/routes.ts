import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import { requireAuth } from '../auth/session';
import { CLIENT_ORIGIN } from '../config';
import { broadcastToConversation, sendToUser } from '../ws/presence';
import {
  CreateGroupSchema,
  UpdateGroupSchema,
  AddGroupMembersSchema,
  GroupMemberParamSchema,
  UpdateMemberRoleSchema,
  CreateGroupInviteSchema,
  ConversationIdParamSchema,
} from '../validation/schemas';

export const groupsRouter = Router();

groupsRouter.use(requireAuth);

// Rate limiter for creating groups (e.g. 20 per hour per user)
const createGroupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { default: false },
  keyGenerator: (req: Request) => (req.user ? `user_${req.user.id}` : (req.ip || 'anonymous')),
  message: { error: 'Too many groups created, please try again later' },
});

export function createAndBroadcastSystemMessage(conversationId: string, actorUserId: number, content: string) {
  const clientMsgId = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
    VALUES (?, ?, ?, ?, 'system')
  `);
  const result = stmt.run(conversationId, actorUserId, clientMsgId, content);
  const messageId = Number(result.lastInsertRowid);

  const sysMsg = {
    id: messageId,
    conversationId,
    senderId: actorUserId,
    clientMsgId,
    content,
    type: 'system',
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    readAt: null,
    attachmentId: null,
    attachment: null,
  };

  broadcastToConversation(conversationId, {
    type: 'message:new',
    message: sysMsg,
  });

  return sysMsg;
}

// POST /api/groups - Create a group
groupsRouter.post('/', createGroupLimiter, (req: Request, res: Response) => {
  const bodyResult = CreateGroupSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: bodyResult.error.issues[0]?.message || 'Invalid group data' });
    return;
  }

  const { name, memberIds = [] } = bodyResult.data;
  const currentUserId = req.user!.id;

  // Enforce max 100 members limit including creator
  const uniqueMemberIds = Array.from(new Set(memberIds.filter((id) => id !== currentUserId)));
  if (uniqueMemberIds.length + 1 > 100) {
    res.status(400).json({ error: 'Group member limit of 100 exceeded' });
    return;
  }

  // Verify all member IDs exist in users table
  if (uniqueMemberIds.length > 0) {
    const placeholders = uniqueMemberIds.map(() => '?').join(',');
    const foundUsers = db
      .prepare(`SELECT id FROM users WHERE id IN (${placeholders})`)
      .all(...uniqueMemberIds) as Array<{ id: number }>;

    if (foundUsers.length !== uniqueMemberIds.length) {
      res.status(400).json({ error: 'One or more specified member IDs are invalid' });
      return;
    }
  }

  const groupId = crypto.randomUUID();

  const createTx = db.transaction(() => {
    // Insert into conversations
    db.prepare(`
      INSERT INTO conversations (id, pair_key, type, name, created_by)
      VALUES (?, NULL, 'group', ?, ?)
    `).run(groupId, name, currentUserId);

    // Insert creator as owner
    db.prepare(`
      INSERT INTO conversation_members (conversation_id, user_id, role)
      VALUES (?, ?, 'owner')
    `).run(groupId, currentUserId);

    // Insert initial members
    const insertMember = db.prepare(`
      INSERT INTO conversation_members (conversation_id, user_id, role)
      VALUES (?, ?, 'member')
    `);
    for (const uid of uniqueMemberIds) {
      insertMember.run(groupId, uid);
    }

    // Insert initial system message
    const creatorName = req.user!.email.split('@')[0];
    const clientMsgId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, client_msg_id, content, type)
      VALUES (?, ?, ?, ?, 'system')
    `).run(groupId, currentUserId, clientMsgId, `${creatorName} created group "${name}"`);
  });

  try {
    createTx();

    const totalMembers = uniqueMemberIds.length + 1;
    res.status(201).json({
      group: {
        id: groupId,
        name,
        type: 'group',
        role: 'owner',
        memberCount: totalMembers,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error('Error creating group:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// GET /api/groups/:id - Get group details & members
groupsRouter.get('/:id', (req: Request, res: Response) => {
  const paramResult = ConversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid group ID' });
    return;
  }
  const { id } = paramResult.data;
  const currentUserId = req.user!.id;

  // Membership check
  const memberRow = db
    .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(id, currentUserId) as { role: string } | undefined;

  if (!memberRow) {
    res.status(403).json({ error: 'You are not a member of this group' });
    return;
  }

  const group = db
    .prepare('SELECT id, name, type, created_by, created_at FROM conversations WHERE id = ? AND type = \'group\'')
    .get(id) as { id: string; name: string; type: string; created_by: number; created_at: string } | undefined;

  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  const members = db
    .prepare(`
      SELECT u.id, u.email, u.username, u.display_name, u.avatar_attachment_id, cm.role, cm.joined_at
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ?
      ORDER BY 
        CASE cm.role 
          WHEN 'owner' THEN 1 
          WHEN 'admin' THEN 2 
          ELSE 3 
        END,
        cm.joined_at ASC
    `)
    .all(id) as Array<{
    id: number;
    email: string;
    username: string;
    display_name: string;
    avatar_attachment_id: string | null;
    role: string;
    joined_at: string;
  }>;

  res.json({
    id: group.id,
    name: group.name,
    type: 'group',
    createdBy: group.created_by,
    createdAt: group.created_at,
    role: memberRow.role,
    members: members.map((m) => ({
      id: m.id,
      email: m.email,
      username: m.username,
      name: m.display_name || m.username || m.email.split('@')[0],
      avatarUrl: m.avatar_attachment_id ? `/api/avatars/${m.id}?size=thumb` : null,
      role: m.role,
      joinedAt: m.joined_at,
    })),
  });
});

// PATCH /api/groups/:id - Edit group name (owner or admin only)
groupsRouter.patch('/:id', (req: Request, res: Response) => {
  const paramResult = ConversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid group ID' });
    return;
  }
  const bodyResult = UpdateGroupSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: bodyResult.error.issues[0]?.message || 'Invalid group name' });
    return;
  }

  const { id } = paramResult.data;
  const { name } = bodyResult.data;
  const currentUserId = req.user!.id;

  const memberRow = db
    .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(id, currentUserId) as { role: string } | undefined;

  if (!memberRow || (memberRow.role !== 'owner' && memberRow.role !== 'admin')) {
    res.status(403).json({ error: 'Only group owners and admins can edit group details' });
    return;
  }

  db.prepare('UPDATE conversations SET name = ? WHERE id = ? AND type = \'group\'').run(name, id);

  const actorName = req.user!.email.split('@')[0];
  createAndBroadcastSystemMessage(id, currentUserId, `${actorName} changed the group name to "${name}"`);

  res.json({ success: true, name });
});

// DELETE /api/groups/:id - Delete group (owner only)
groupsRouter.delete('/:id', (req: Request, res: Response) => {
  const paramResult = ConversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid group ID' });
    return;
  }

  const { id } = paramResult.data;
  const currentUserId = req.user!.id;

  const memberRow = db
    .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(id, currentUserId) as { role: string } | undefined;

  if (!memberRow || memberRow.role !== 'owner') {
    res.status(403).json({ error: 'Only the group owner can delete the group' });
    return;
  }

  // Broadcast deletion event before deleting rows
  broadcastToConversation(id, {
    type: 'group:deleted',
    conversationId: id,
  });

  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);

  res.json({ success: true, message: 'Group deleted' });
});

// POST /api/groups/:id/members - Add member(s) (owner or admin only)
groupsRouter.post('/:id/members', (req: Request, res: Response) => {
  const paramResult = ConversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid group ID' });
    return;
  }
  const bodyResult = AddGroupMembersSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: 'Invalid user IDs specified' });
    return;
  }

  const { id } = paramResult.data;
  const currentUserId = req.user!.id;

  const callerRow = db
    .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(id, currentUserId) as { role: string } | undefined;

  if (!callerRow || (callerRow.role !== 'owner' && callerRow.role !== 'admin')) {
    res.status(403).json({ error: 'Only group owners and admins can add members' });
    return;
  }

  const userIdsToAdd =
    'userIds' in bodyResult.data ? bodyResult.data.userIds : [bodyResult.data.userId];

  // Current count check
  const countRow = db
    .prepare('SELECT COUNT(*) as count FROM conversation_members WHERE conversation_id = ?')
    .get(id) as { count: number };

  if (countRow.count + userIdsToAdd.length > 100) {
    res.status(400).json({ error: 'Group member limit of 100 exceeded' });
    return;
  }

  const added: number[] = [];

  const addTx = db.transaction(() => {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role)
      VALUES (?, ?, 'member')
    `);
    const clearRemovedStmt = db.prepare(`
      DELETE FROM group_removed_members WHERE conversation_id = ? AND user_id = ?
    `);

    for (const uid of userIdsToAdd) {
      // Check user exists
      const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(uid) as { id: number; email: string } | undefined;
      if (!user) continue;

      const result = insertStmt.run(id, uid);
      if (result.changes > 0) {
        clearRemovedStmt.run(id, uid);
        added.push(uid);

        const memberName = user.email.split('@')[0];
        createAndBroadcastSystemMessage(id, currentUserId, `${memberName} was added to the group`);
      }
    }
  });

  addTx();

  res.json({ success: true, addedCount: added.length, addedUserIds: added });
});

// DELETE /api/groups/:id/members/:userId - Remove member (owner or admin; never touches owner)
groupsRouter.delete('/:id/members/:userId', (req: Request, res: Response) => {
  const paramResult = GroupMemberParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid parameters' });
    return;
  }

  const { id, userId: targetUserId } = paramResult.data;
  const currentUserId = req.user!.id;

  const callerRow = db
    .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(id, currentUserId) as { role: string } | undefined;

  if (!callerRow || (callerRow.role !== 'owner' && callerRow.role !== 'admin')) {
    res.status(403).json({ error: 'Only group owners and admins can remove members' });
    return;
  }

  const targetRow = db
    .prepare(`
      SELECT cm.role, u.email
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ? AND cm.user_id = ?
    `)
    .get(id, targetUserId) as { role: string; email: string } | undefined;

  if (!targetRow) {
    res.status(404).json({ error: 'Member not found in group' });
    return;
  }

  // Critical rule: Admin never touches the owner. Owner cannot be removed by anyone!
  if (targetRow.role === 'owner') {
    res.status(403).json({ error: 'The group owner cannot be removed' });
    return;
  }

  // Remove and record in group_removed_members
  const removeTx = db.transaction(() => {
    db.prepare(`
      INSERT OR REPLACE INTO group_removed_members (conversation_id, user_id)
      VALUES (?, ?)
    `).run(id, targetUserId);

    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(id, targetUserId);
  });

  removeTx();

  const targetName = targetRow.email.split('@')[0];
  createAndBroadcastSystemMessage(id, currentUserId, `${targetName} was removed from the group`);

  // Notify removed user directly
  sendToUser(targetUserId, {
    type: 'group:removed',
    conversationId: id,
    message: 'You were removed from this group',
  });

  res.json({ success: true, message: 'Member removed' });
});

// PATCH /api/groups/:id/members/:userId - Promote / Demote member (owner or admin; never touches owner)
groupsRouter.patch('/:id/members/:userId', (req: Request, res: Response) => {
  const paramResult = GroupMemberParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid parameters' });
    return;
  }
  const bodyResult = UpdateMemberRoleSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: 'Invalid role specified (must be admin or member)' });
    return;
  }

  const { id, userId: targetUserId } = paramResult.data;
  const { role: newRole } = bodyResult.data;
  const currentUserId = req.user!.id;

  const callerRow = db
    .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(id, currentUserId) as { role: string } | undefined;

  if (!callerRow || (callerRow.role !== 'owner' && callerRow.role !== 'admin')) {
    res.status(403).json({ error: 'Only group owners and admins can change member roles' });
    return;
  }

  const targetRow = db
    .prepare(`
      SELECT cm.role, u.email
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ? AND cm.user_id = ?
    `)
    .get(id, targetUserId) as { role: string; email: string } | undefined;

  if (!targetRow) {
    res.status(404).json({ error: 'Member not found in group' });
    return;
  }

  // Critical rule: Admin never touches the owner. Owner role cannot be altered!
  if (targetRow.role === 'owner') {
    res.status(403).json({ error: 'The group owner role cannot be modified' });
    return;
  }

  if (targetRow.role !== newRole) {
    db.prepare('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?').run(
      newRole,
      id,
      targetUserId
    );

    const targetName = targetRow.email.split('@')[0];
    const roleText = newRole === 'admin' ? 'an admin' : 'a member';
    createAndBroadcastSystemMessage(id, currentUserId, `${targetName} is now ${roleText}`);
  }

  res.json({ success: true, userId: targetUserId, role: newRole });
});

// POST /api/groups/:id/leave - Leave group (members/admins can leave, owner CANNOT leave)
groupsRouter.post('/:id/leave', (req: Request, res: Response) => {
  const paramResult = ConversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid group ID' });
    return;
  }

  const { id } = paramResult.data;
  const currentUserId = req.user!.id;

  const memberRow = db
    .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(id, currentUserId) as { role: string } | undefined;

  if (!memberRow) {
    res.status(403).json({ error: 'You are not a member of this group' });
    return;
  }

  // Critical rule: Owner can't leave, must delete!
  if (memberRow.role === 'owner') {
    res.status(400).json({ error: 'Owner cannot leave the group. You must delete the group instead.' });
    return;
  }

  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(id, currentUserId);

  const actorName = req.user!.email.split('@')[0];
  createAndBroadcastSystemMessage(id, currentUserId, `${actorName} left the group`);

  res.json({ success: true, message: 'You left the group' });
});

// POST /api/groups/:id/invites - Create group invite link (owner/admin only)
groupsRouter.post('/:id/invites', (req: Request, res: Response) => {
  const paramResult = ConversationIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid group ID' });
    return;
  }
  const bodyResult = CreateGroupInviteSchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: 'Invalid invite parameters' });
    return;
  }

  const { id } = paramResult.data;
  const maxUses = bodyResult.data.maxUses ?? 20;
  const currentUserId = req.user!.id;

  const memberRow = db
    .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(id, currentUserId) as { role: string } | undefined;

  if (!memberRow || (memberRow.role !== 'owner' && memberRow.role !== 'admin')) {
    res.status(403).json({ error: 'Only group owners and admins can create invite links' });
    return;
  }

  const rawToken = crypto.randomBytes(16).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const inviteId = crypto.randomUUID();

  const expires = new Date();
  expires.setHours(expires.getHours() + 24);
  const expiresAt = expires.toISOString();

  db.prepare(`
    INSERT INTO invites (id, token_hash, inviter_id, conversation_id, expires_at, max_uses, use_count, revoked)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0)
  `).run(inviteId, tokenHash, currentUserId, id, expiresAt, maxUses);

  const fullLink = `${CLIENT_ORIGIN}/invite/${rawToken}`;

  res.status(201).json({
    id: inviteId,
    token: rawToken,
    link: fullLink,
    inviteUrl: fullLink,
    expiresAt,
    maxUses,
  });
});
