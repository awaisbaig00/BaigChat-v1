import crypto from 'crypto';
import { Response, Request, NextFunction } from 'express';
import { db } from '../db';
import { IS_PROD } from '../config';

export const SESSION_COOKIE_NAME = 'baigchat_sid';
export const CSRF_COOKIE_NAME = 'baigchat_csrf';
const SESSION_TTL_DAYS = 7;

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface SessionData {
  userId: number;
  csrfToken: string;
  expiresAt: string;
}

export function createSession(userId: number, userAgent?: string, ipAddress?: string): { rawSessionId: string; csrfToken: string } {
  const rawSessionId = crypto.randomUUID();
  const sessionHash = hashToken(rawSessionId);
  const csrfToken = crypto.randomBytes(32).toString('hex');

  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_TTL_DAYS);
  const expiresAt = expires.toISOString();

  const stmt = db.prepare(`
    INSERT INTO sessions (id, user_id, csrf_token, user_agent, ip_address, last_active, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
  `);
  stmt.run(sessionHash, userId, csrfToken, userAgent || null, ipAddress || null, expiresAt);

  return { rawSessionId, csrfToken };
}

export function getSession(rawSessionId: string): SessionData | null {
  const sessionHash = hashToken(rawSessionId);
  const stmt = db.prepare(`
    SELECT user_id AS userId, csrf_token AS csrfToken, expires_at AS expiresAt
    FROM sessions
    WHERE id = ? AND datetime(expires_at) > datetime('now')
  `);
  const row = stmt.get(sessionHash) as SessionData | undefined;
  return row ?? null;
}

export function deleteSession(rawSessionId: string): void {
  const sessionHash = hashToken(rawSessionId);
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  stmt.run(sessionHash);
}

export function cleanupExpiredSessions(): number {
  try {
    const stmt = db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')");
    const info = stmt.run();
    return info.changes;
  } catch {
    return 0;
  }
}

// Clean up expired sessions on startup and run hourly in background
cleanupExpiredSessions();
const sessionCleanupInterval = setInterval(() => {
  cleanupExpiredSessions();
}, 60 * 60 * 1000);
if (sessionCleanupInterval.unref) {
  sessionCleanupInterval.unref();
}

export function rotateSession(
  oldRawSessionId: string | undefined,
  userId: number,
  userAgent?: string,
  ipAddress?: string
): { rawSessionId: string; csrfToken: string } {
  if (oldRawSessionId) {
    deleteSession(oldRawSessionId);
  }
  return createSession(userId, userAgent, ipAddress);
}

export function setSessionCookies(res: Response, rawSessionId: string, csrfToken: string): void {
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

  // HttpOnly session cookie
  res.cookie(SESSION_COOKIE_NAME, rawSessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge,
    path: '/',
  });

  // Non-HttpOnly CSRF cookie so the frontend SPA can read it and send X-CSRF-Token header
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge,
    path: '/',
  });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
  });
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
  });
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        username?: string;
        displayName?: string;
      };
      csrfToken?: string;
      rawSessionId?: string;
    }
  }
}

export function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const rawSessionId = req.cookies[SESSION_COOKIE_NAME];
  if (!rawSessionId) {
    return next();
  }

  const session = getSession(rawSessionId);
  if (!session) {
    clearSessionCookies(res);
    return next();
  }

  const userStmt = db.prepare('SELECT id, email, username, display_name, is_deleted FROM users WHERE id = ?');
  const user = userStmt.get(session.userId) as
    | { id: number; email: string; username?: string; display_name?: string; is_deleted?: number }
    | undefined;

  if (!user || user.is_deleted === 1) {
    deleteSession(rawSessionId);
    clearSessionCookies(res);
    return next();
  }

  // Update last_active timestamp on session
  try {
    const sessionHash = hashToken(rawSessionId);
    db.prepare("UPDATE sessions SET last_active = datetime('now') WHERE id = ?").run(sessionHash);
  } catch {}

  req.user = {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.display_name,
  };
  req.csrfToken = session.csrfToken;
  req.rawSessionId = rawSessionId;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}
