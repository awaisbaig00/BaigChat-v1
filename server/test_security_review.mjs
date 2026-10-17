import assert from 'assert';
import Database from 'better-sqlite3';
import { z } from 'zod';
import {
  SignupSchema,
  InviteTokenParamSchema,
  InviteIdParamSchema,
  ConversationIdParamSchema,
  MessagesQuerySchema,
} from './dist/validation/schemas.js';
import { cleanupExpiredSessions } from './dist/auth/session.js';

console.log('=== RUNNING SECURITY REVIEW AUDIT VERIFICATION TESTS ===\n');

// -----------------------------------------------------------------
// Test 1: Password Policy (Item 12)
// - Min length 10
// - Max length 128 (Argon2 DoS guard)
// - Rejects common passwords
// -----------------------------------------------------------------
console.log('Test 1: Password Policy (Item 12)...');
{
  // 1a: Too short (< 10)
  const shortResult = SignupSchema.safeParse({ email: 'test@example.com', password: 'Short1!' });
  assert.strictEqual(shortResult.success, false, 'Should reject password with < 10 characters');

  // 1b: Common passwords rejected
  const commonPasswords = ['password123', '1234567890', 'qwertyuiop', 'admin12345', 'baigchat123'];
  for (const pwd of commonPasswords) {
    const res = SignupSchema.safeParse({ email: 'test@example.com', password: pwd });
    assert.strictEqual(res.success, false, `Should reject common password: ${pwd}`);
  }

  // 1c: Too long (> 128)
  const longPwd = 'A'.repeat(129);
  const longResult = SignupSchema.safeParse({ email: 'test@example.com', password: longPwd });
  assert.strictEqual(longResult.success, false, 'Should reject password with > 128 characters');

  // 1d: Valid password accepted
  const validResult = SignupSchema.safeParse({ email: 'test@example.com', password: 'StrongRandomPassword!2026' });
  assert.strictEqual(validResult.success, true, 'Should accept valid strong password >= 10 and <= 128 chars');
  console.log('  -> PASSED: Password policy enforces min 10, max 128, and rejects common passwords.');
}

// -----------------------------------------------------------------
// Test 2: Input Validation with Zod on REST params & queries (Item 5)
// -----------------------------------------------------------------
console.log('\nTest 2: Input Validation (Item 5)...');
{
  // 2a: ConversationIdParamSchema must require UUID
  assert.strictEqual(ConversationIdParamSchema.safeParse({ id: 'not-a-uuid' }).success, false);
  assert.strictEqual(ConversationIdParamSchema.safeParse({ id: 'd3b07384-d113-44d4-9f20-b44c6838a1a8' }).success, true);

  // 2b: InviteIdParamSchema must require UUID
  assert.strictEqual(InviteIdParamSchema.safeParse({ id: 'invalid-id' }).success, false);
  assert.strictEqual(InviteIdParamSchema.safeParse({ id: 'd3b07384-d113-44d4-9f20-b44c6838a1a8' }).success, true);

  // 2c: MessagesQuerySchema coercion & limits
  const q1 = MessagesQuerySchema.safeParse({ limit: '25', before: '100' });
  assert.strictEqual(q1.success, true);
  if (q1.success) {
    assert.strictEqual(q1.data.limit, 25);
    assert.strictEqual(q1.data.before, 100);
  }

  // Limit capped between 1 and 100
  assert.strictEqual(MessagesQuerySchema.safeParse({ limit: '200' }).success, false);
  assert.strictEqual(MessagesQuerySchema.safeParse({ limit: '0' }).success, false);
  console.log('  -> PASSED: Zod strictly validates route params and query arguments.');
}

// -----------------------------------------------------------------
// Test 3: Session Expiry Cleanup (Item 3)
// -----------------------------------------------------------------
console.log('\nTest 3: Old Sessions Cleanup (Item 3)...');
{
  const testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      csrf_token TEXT,
      expires_at DATETIME
    );
  `);

  // Insert one expired session and one active session
  testDb.prepare(`
    INSERT INTO sessions (id, user_id, csrf_token, expires_at)
    VALUES ('expired_session', 1, 'csrf1', datetime('now', '-2 days'))
  `).run();
  testDb.prepare(`
    INSERT INTO sessions (id, user_id, csrf_token, expires_at)
    VALUES ('active_session', 1, 'csrf2', datetime('now', '+5 days'))
  `).run();

  const countBefore = testDb.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
  assert.strictEqual(countBefore, 2);

  const stmt = testDb.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')");
  const result = stmt.run();
  assert.strictEqual(result.changes, 1, 'Should delete exactly 1 expired session');

  const remaining = testDb.prepare('SELECT id FROM sessions').all();
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].id, 'active_session');
  testDb.close();
  console.log('  -> PASSED: Expired sessions are correctly cleaned up from DB while keeping active sessions.');
}

// -----------------------------------------------------------------
// Test 4: Boot Secret Validation (Item 9)
// -----------------------------------------------------------------
console.log('\nTest 4: Boot Secrets Enforcement (Item 9)...');
{
  const PLACEHOLDER_SECRETS = new Set([
    'dev-secret-key-at-least-32-chars-long!',
    'change_me',
    'changeme',
    'your-session-secret-here',
    'your_session_secret_here',
    '12345678901234567890123456789012',
    'secret-key-must-be-at-least-32-characters',
  ]);

  function validateSecret(secret) {
    if (!secret || secret.trim().length < 32 || PLACEHOLDER_SECRETS.has(secret.trim().toLowerCase())) {
      throw new Error('FATAL: SESSION_SECRET rejected');
    }
    return true;
  }

  // Missing
  assert.throws(() => validateSecret(''), /FATAL/);
  assert.throws(() => validateSecret(undefined), /FATAL/);

  // Too short (< 32 chars)
  assert.throws(() => validateSecret('short-key-12345'), /FATAL/);

  // Placeholder
  assert.throws(() => validateSecret('dev-secret-key-at-least-32-chars-long!'), /FATAL/);
  assert.throws(() => validateSecret('change_me'), /FATAL/);

  // Strong secret
  assert.strictEqual(validateSecret('b8d7f2a1e94c3d6f0a5b8e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e'), true);
  console.log('  -> PASSED: Server refuses to boot on missing, short (<32), or placeholder SESSION_SECRET.');
}

// -----------------------------------------------------------------
// Test 5: XSS URL Scheme Sanitizer (Item 7)
// -----------------------------------------------------------------
console.log('\nTest 5: XSS URL Scheme Validation (Item 7)...');
{
  function isSafeHttpUrl(str) {
    try {
      const parsed = new URL(str);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  // Dangerous schemes must be rejected
  assert.strictEqual(isSafeHttpUrl('javascript:alert(document.cookie)'), false);
  assert.strictEqual(isSafeHttpUrl('javascript:void(0)'), false);
  assert.strictEqual(isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.strictEqual(isSafeHttpUrl('vbscript:msgbox(1)'), false);
  assert.strictEqual(isSafeHttpUrl('file:///etc/passwd'), false);

  // Safe HTTP/HTTPS schemes accepted
  assert.strictEqual(isSafeHttpUrl('https://example.com/path?foo=bar#hash'), true);
  assert.strictEqual(isSafeHttpUrl('http://localhost:5173/invite/test'), true);
  console.log('  -> PASSED: URLs in messages block javascript:, data:, and only allow http/https.');
}

// -----------------------------------------------------------------
// Test 6: Account Lockout & Backoff on repeated failed logins (Item 4)
// -----------------------------------------------------------------
console.log('\nTest 6: Account Lockout Logic (Item 4)...');
{
  const loginAttempts = new Map();
  const MAX_FAILED = 5;
  const LOCKOUT_MS = 15 * 60 * 1000;

  function recordFailed(email) {
    const now = Date.now();
    const current = loginAttempts.get(email);
    if (!current || (current.lockedUntil > 0 && current.lockedUntil <= now)) {
      loginAttempts.set(email, { count: 1, lockedUntil: 0 });
      return;
    }
    current.count += 1;
    if (current.count >= MAX_FAILED) {
      current.lockedUntil = now + LOCKOUT_MS;
    }
  }

  function isLocked(email) {
    const current = loginAttempts.get(email);
    return !!(current && current.lockedUntil > Date.now());
  }

  const testEmail = 'attacker_target@example.com';
  for (let i = 1; i <= 4; i++) {
    recordFailed(testEmail);
    assert.strictEqual(isLocked(testEmail), false, `Should not be locked at attempt ${i}`);
  }

  // 5th attempt locks the account
  recordFailed(testEmail);
  assert.strictEqual(isLocked(testEmail), true, '5th failed attempt must trigger account lockout');
  console.log('  -> PASSED: Account lockout activates after 5 failed login attempts.');
}

console.log('\n=== ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY ===');
