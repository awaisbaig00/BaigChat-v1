import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import {
  SignupSchema,
  LoginSchema,
  UsernameSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  RESERVED_USERNAMES,
} from '../validation/schemas';
import {
  createSession,
  rotateSession,
  deleteSession,
  setSessionCookies,
  clearSessionCookies,
  requireAuth,
} from './session';
import { recordAuditEvent } from '../security/audit';

export const authRouter = Router();

// Rate limiter for username availability checks: 60/min/IP
const usernameCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many username checks. Please slow down.' },
});

// Rate limiter for password reset requests: 5/hour/IP
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' },
});

// Dummy Argon2 hash to equalize verification timing for non-existent users
let dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQxMjM0NTY3OA$77+977+977+977+977+977+977+977+977+977+977+9';
argon2.hash('timing-defense-dummy-password', { type: argon2.argon2id }).then((h) => {
  dummyHash = h;
}).catch(() => {});

// In-memory failed login tracking for account lockout
interface LoginAttempt {
  count: number;
  lockedUntil: number;
}
const loginAttempts = new Map<string, LoginAttempt>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout

function recordFailedLogin(key: string, ipAddress?: string): void {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || (current.lockedUntil > 0 && current.lockedUntil <= now)) {
    loginAttempts.set(key, { count: 1, lockedUntil: 0 });
    recordAuditEvent({ eventType: 'login_failure', ipAddress });
    return;
  }

  current.count += 1;
  recordAuditEvent({ eventType: 'login_failure', ipAddress });
  if (current.count >= MAX_FAILED_ATTEMPTS) {
    current.lockedUntil = now + LOCKOUT_DURATION_MS;
    recordAuditEvent({ eventType: 'account_locked', ipAddress });
  }
}

// Helper to generate a unique fallback username from email prefix
function generateUniqueUsername(email: string): string {
  let raw = email.split('@')[0].toLowerCase();
  let sanitized = raw.replace(/[^a-z0-9._]/g, '').replace(/[._]{2,}/g, '_').replace(/^[_.]+|[_.]+$/g, '');
  if (sanitized.length < 3) {
    sanitized = `user_${sanitized}`.padEnd(3, '0').slice(0, 30);
  }
  if (sanitized.length > 30) {
    sanitized = sanitized.slice(0, 30).replace(/^[_.]+|[_.]+$/g, '');
  }
  if (RESERVED_USERNAMES.has(sanitized)) {
    sanitized = `user_${sanitized}`.slice(0, 30);
  }

  let candidate = sanitized;
  let counter = 1;
  while (true) {
    const existing = db.prepare('SELECT id FROM users WHERE username_lower = ?').get(candidate);
    if (!existing) break;
    candidate = `${sanitized.slice(0, 26)}_${counter}`;
    counter++;
  }
  return candidate;
}

authRouter.get('/username-available', usernameCheckLimiter, (req: Request, res: Response) => {
  const u = typeof req.query.u === 'string' ? req.query.u : '';
  const result = UsernameSchema.safeParse(u);
  if (!result.success) {
    res.json({ available: false, reason: result.error.issues?.[0]?.message ?? 'Invalid username' });
    return;
  }

  const normalized = result.data.toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE username_lower = ?').get(normalized);
  if (existing) {
    res.json({ available: false, reason: 'Username is already taken' });
    return;
  }

  res.json({ available: true });
});

authRouter.post('/signup', async (req: Request, res: Response) => {
  const result = SignupSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues?.[0]?.message ?? 'Invalid input' });
    return;
  }

  const { email, password, username: requestedUsername } = result.data;
  const normalizedEmail = email.toLowerCase();

  // Determine username
  let finalUsername = requestedUsername;
  if (!finalUsername) {
    finalUsername = generateUniqueUsername(normalizedEmail);
  }
  const normalizedUsername = finalUsername.toLowerCase();

  // Check if username already taken
  const existingUserByUsername = db.prepare('SELECT id FROM users WHERE username_lower = ?').get(normalizedUsername);
  if (existingUserByUsername) {
    res.status(400).json({ error: 'Username is already taken. Please choose another.' });
    return;
  }

  // Check if email already exists
  const existingUserByEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existingUserByEmail) {
    // Run dummy hash to equalize timing with new account creation, preventing account enumeration
    await argon2.hash(password, { type: argon2.argon2id });
    res.status(400).json({ error: 'Unable to complete registration. If you already have an account, please sign in.' });
    return;
  }

  try {
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    const displayName = finalUsername;
    const insertStmt = db.prepare(`
      INSERT INTO users (email, password_hash, username, username_lower, display_name)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = insertStmt.run(normalizedEmail, passwordHash, finalUsername, normalizedUsername, displayName);
    const userId = Number(info.lastInsertRowid);

    // Create session and set cookies with user-agent and IP tracking
    const userAgent = req.headers['user-agent'] as string | undefined;
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || undefined;
    const { rawSessionId, csrfToken } = createSession(userId, userAgent, ipAddress);
    setSessionCookies(res, rawSessionId, csrfToken);

    res.status(201).json({
      user: {
        id: userId,
        email: normalizedEmail,
        username: finalUsername,
        displayName,
        bio: null,
        about: null,
        avatarUrl: null,
        isDiscoverable: 1,
        showLastSeen: 1,
        showOnline: 1,
      },
      csrfToken,
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create user account' });
  }
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const result = LoginSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues?.[0]?.message ?? 'Invalid input' });
    return;
  }

  const { email, username, identifier, password } = result.data;
  const rawId = identifier || email || username || '';
  const normalizedId = rawId.trim().toLowerCase();
  const lockoutKey = `${normalizedId}:${req.ip || 'ip'}`;

  // Check account lockout
  const attempt = loginAttempts.get(lockoutKey);
  if (attempt && attempt.lockedUntil > Date.now()) {
    // Run dummy verify to maintain constant timing
    await argon2.verify(dummyHash, password).catch(() => {});
    res.status(429).json({ error: 'Too many failed login attempts. Account temporarily locked, please try again later.' });
    return;
  }

  const user = db
    .prepare(
      `SELECT id, email, username, display_name, password_hash, last_seen, bio, about, avatar_attachment_id,
              is_discoverable, show_last_seen, show_online, is_deleted
       FROM users 
       WHERE (email = ? OR username_lower = ?) AND is_deleted = 0`
    )
    .get(normalizedId, normalizedId) as
    | {
        id: number;
        email: string;
        username: string;
        display_name: string;
        password_hash: string;
        last_seen: string;
        bio: string | null;
        about: string | null;
        avatar_attachment_id: string | null;
        is_discoverable: number;
        show_last_seen: number;
        show_online: number;
        is_deleted: number;
      }
    | undefined;

  if (!user) {
    // Constant-time execution prevents account enumeration via timing
    await argon2.verify(dummyHash, password).catch(() => {});
    recordFailedLogin(lockoutKey, req.ip);
    res.status(401).json({ error: 'Invalid email/username or password' });
    return;
  }

  try {
    const isValid = await argon2.verify(user.password_hash, password);
    if (!isValid) {
      recordFailedLogin(lockoutKey, req.ip);
      res.status(401).json({ error: 'Invalid email/username or password' });
      return;
    }

    // Reset failed attempts on success
    loginAttempts.delete(lockoutKey);

    // Rotate session ID on login
    const userAgent = req.headers['user-agent'] as string | undefined;
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || undefined;
    const { rawSessionId, csrfToken } = rotateSession(req.rawSessionId, user.id, userAgent, ipAddress);
    setSessionCookies(res, rawSessionId, csrfToken);

    // Update last_seen
    db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        bio: user.bio,
        about: user.about,
        avatarUrl: user.avatar_attachment_id ? `/api/avatars/${user.id}?size=thumb` : null,
        isDiscoverable: user.is_discoverable,
        showLastSeen: user.show_last_seen,
        showOnline: user.show_online,
        lastSeen: user.last_seen,
      },
      csrfToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

authRouter.post('/forgot', forgotPasswordLimiter, async (req: Request, res: Response) => {
  const result = ForgotPasswordSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues?.[0]?.message ?? 'Invalid email' });
    return;
  }

  const { email } = result.data;
  const user = db.prepare('SELECT id FROM users WHERE email = ? AND is_deleted = 0').get(email) as
    | { id: number }
    | undefined;

  if (user) {
    try {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const resetId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

      db.prepare(`
        INSERT INTO password_resets (id, user_id, token_hash, expires_at, used)
        VALUES (?, ?, ?, ?, 0)
      `).run(resetId, user.id, tokenHash, expiresAt);

      recordAuditEvent({
        eventType: 'password_reset_request',
        userId: user.id,
        ipAddress: req.ip,
      });

      console.log(`[AUTH] Password reset requested for user ID ${user.id}`);
    } catch (err) {
      console.error('Error creating password reset:', err);
    }
  }

  // Always return identical success message to prevent user enumeration
  res.json({
    success: true,
    message: 'If an account with that email exists, password reset instructions have been sent.',
  });
});

authRouter.post('/reset', async (req: Request, res: Response) => {
  const result = ResetPasswordSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues?.[0]?.message ?? 'Invalid input' });
    return;
  }

  const { token, newPassword } = result.data;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const resetRecord = db
    .prepare(
      `SELECT id, user_id, expires_at, used 
       FROM password_resets 
       WHERE token_hash = ? AND used = 0 AND datetime(expires_at) > datetime('now')`
    )
    .get(tokenHash) as { id: string; user_id: number; expires_at: string; used: number } | undefined;

  if (!resetRecord) {
    recordAuditEvent({
      eventType: 'password_reset_failed',
      ipAddress: req.ip,
    });
    res.status(400).json({ error: 'Invalid or expired password reset link' });
    return;
  }

  try {
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });

    const resetTx = db.transaction(() => {
      // Update password
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, resetRecord.user_id);
      // Mark token used
      db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(resetRecord.id);
      // Invalidate all active sessions for this user
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(resetRecord.user_id);
    });

    resetTx();

    recordAuditEvent({
      eventType: 'password_reset_success',
      userId: resetRecord.user_id,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Password has been reset successfully. Please sign in with your new password.',
    });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

authRouter.post('/logout', requireAuth, (req: Request, res: Response) => {
  if (req.rawSessionId) {
    deleteSession(req.rawSessionId);
  }
  clearSessionCookies(res);
  res.json({ success: true });
});

authRouter.get('/me', (req: Request, res: Response) => {
  if (!req.user) {
    res.json({ user: null, csrfToken: null });
    return;
  }

  const user = db
    .prepare(
      `SELECT id, email, username, display_name, bio, about, avatar_attachment_id,
              is_discoverable, show_last_seen, show_online, last_seen, created_at
       FROM users 
       WHERE id = ? AND is_deleted = 0`
    )
    .get(req.user.id) as
    | {
        id: number;
        email: string;
        username: string;
        display_name: string;
        bio: string | null;
        about: string | null;
        avatar_attachment_id: string | null;
        is_discoverable: number;
        show_last_seen: number;
        show_online: number;
        last_seen: string;
        created_at: string;
      }
    | undefined;

  if (!user) {
    res.json({ user: null, csrfToken: null });
    return;
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      bio: user.bio,
      about: user.about,
      avatarUrl: user.avatar_attachment_id ? `/api/avatars/${user.id}?size=thumb` : null,
      isDiscoverable: user.is_discoverable,
      showLastSeen: user.show_last_seen,
      showOnline: user.show_online,
      lastSeen: user.last_seen,
      createdAt: user.created_at,
    },
    csrfToken: req.csrfToken ?? null,
  });
});
