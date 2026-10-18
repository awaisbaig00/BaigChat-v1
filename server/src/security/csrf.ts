import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { IS_PROD, isOriginAllowed } from '../config';

/**
 * Validates Origin / Referer header against allowed CLIENT_ORIGIN / CORS_ORIGIN.
 */
export function checkOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  if (origin) {
    return isOriginAllowed(origin);
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      return isOriginAllowed(refererUrl.origin);
    } catch {
      return false;
    }
  }

  // In production, mutating requests without Origin or Referer should be rejected
  return !IS_PROD;
}

/**
 * Constant-time comparison of two string tokens using crypto.timingSafeEqual.
 */
export function safeCompareTokens(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * CSRF Protection Middleware:
 * - Checks Origin/Referer on all mutating requests.
 * - If session is active (req.csrfToken exists), verifies X-CSRF-Token header using constant-time comparison.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Safe HTTP methods do not mutate state
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // 1. Origin verification
  if (!checkOrigin(req)) {
    res.status(403).json({ error: 'Cross-origin request forbidden' });
    return;
  }

  // 2. If user is authenticated with a session, enforce X-CSRF-Token
  if (req.csrfToken) {
    const headerToken = req.headers['x-csrf-token'];
    if (!headerToken || typeof headerToken !== 'string') {
      res.status(403).json({ error: 'Missing X-CSRF-Token header' });
      return;
    }

    if (!safeCompareTokens(headerToken, req.csrfToken)) {
      res.status(403).json({ error: 'Invalid CSRF token' });
      return;
    }
  }

  next();
}
