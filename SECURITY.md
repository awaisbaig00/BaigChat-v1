# SECURITY.md — BaigChat v2 Security Checklist

This document maps each Part B hardening item to its implementation in the codebase, and lists known limitations.

---

## Security Checklist (Part B)

| # | Item | Status | File / Line(s) |
|---|------|--------|----------------|
| 1 | **SQL injection**: no string-built SQL anywhere | ✅ DONE | All queries use `db.prepare(...)` parameterized statements. `grep -rn "db.exec\|db.run" src/` shows only schema init (no user input). |
| 2 | **XSS**: no `dangerouslySetInnerHTML` on user content; strict CSP; nosniff | ✅ DONE | `server/src/index.ts` L30–55 (Helmet CSP). React renders all user content as text nodes. Search highlighting uses `<mark>` with escaped segments, no innerHTML. |
| 3 | **CSRF**: token on all state-changing requests; Origin check on WS handshake | ✅ DONE | `server/src/security/csrf.ts` (double-submit CSRF token + Origin check). WS `server/src/ws/server.ts` L43–50 (strict Origin check). |
| 4 | **File upload**: MIME allowlist + magic-byte check, size limits, random filenames, no script execution, Content-Disposition | ✅ DONE | `server/src/uploads/detector.ts` (magic-byte detection). `server/src/uploads/routes.ts` (multer 10 MB limit, randomized stored filename, Content-Disposition header). Avatar upload separately validated in `server/src/users/routes.ts` L296–301. |
| 5 | **BOLA/IDOR**: every route and WS event checks membership/ownership | ✅ DONE | Every message/conversation/group route calls `isMember()` or equivalent. WS handlers verify membership before broadcasting. |
| 6 | **Rate limiting**: login, signup, password reset, invites, messages, uploads, search | ✅ DONE | `server/src/index.ts` L70–90 (auth limiter 50/15min, API limiter 300/15min). Per-route limiters in `auth/routes.ts`, `messages/routes.ts`, `users/routes.ts`, `uploads/routes.ts`, `invites/routes.ts`. WS per-user message rate limiter in `ws/server.ts`. |
| 6a | **Account lockout**: backoff after repeated login failures | ✅ DONE | `server/src/auth/routes.ts` L50–80 (in-memory lockout: 5 failed attempts → 15-minute lockout). |
| 7 | **Secrets**: SESSION_SECRET from env, 64+ chars, refuses boot if missing/placeholder | ✅ DONE | `server/src/config.ts` L14–29 (throws on missing, short, or placeholder secret). |
| 8 | **API/secrets stay server-side** | ✅ DONE | Frontend receives only public config (user info, CSRF token). No API keys in client bundle. |
| 9 | **Password hashing**: Argon2id, minimum-strength policy, generic auth errors | ✅ DONE | `server/src/auth/routes.ts` (argon2id). `server/src/validation/schemas.ts` (min 8 chars, upper+lower+digit+special required). Login/signup return generic errors for non-existent users. |
| 10 | **Cookies**: httpOnly + Secure + SameSite; no tokens in localStorage/sessionStorage/URLs | ✅ DONE | `server/src/auth/session.ts` (httpOnly, Secure in prod, SameSite=Lax). No tokens stored client-side. |
| 11 | **CORS**: strict allowlist, no wildcard, credentials only for allowed origins | ✅ DONE | `server/src/index.ts` L58–63 (cors with `origin: CORS_ORIGIN`, `credentials: true`). |
| 12 | **Permissions enforced server-side only** | ✅ DONE | Roles (owner/admin/member) are read from the DB on every request, never from client input. |
| 13 | **SSRF** | ✅ N/A | No server-side URL fetching exists in this codebase. There are no outbound HTTP calls to user-supplied URLs. |
| 14 | **No source maps in production build; no debug output in production** | ✅ DONE | `client/vite.config.ts` (sourcemap disabled). `server/src/index.ts` L140 (stack traces hidden in production). |
| 15 | **No default or seeded credentials** | ✅ DONE | No seeds, no default admin accounts. Users register via invite links only (or open signup if configured). |
| 16 | **Logs redact passwords, tokens, invite tokens, message content, PII** | ✅ DONE | `server/src/index.ts` L130–141 (error handler logs only method/path/status/message). No message content or tokens in any log statement. |
| 17 | **Dependencies**: npm audit, fix safe issues, pin versions | ✅ DONE | Versions pinned in `package-lock.json`. Run `npm audit` — no critical vulnerabilities at time of build. |
| 18 | **Headers**: Helmet, HSTS in production, input size limits | ✅ DONE | `server/src/index.ts` L30–55 (Helmet with HSTS). `express.json({ limit: '1mb' })` L66. |
| 19 | **Audit log**: security events logged | ✅ DONE | `server/src/security/audit.ts` — login failures, password reset, invite redeem, block/report, deletions all call `recordAuditEvent()`. |

---

## Authorization Tests (Part B)

| Test | Status |
|------|--------|
| Non-members cannot read, send to, search, react in, edit/delete other conversations | ✅ PASS |
| Members cannot act as admin or owner | ✅ PASS |
| Blocked users cannot message or redeem invites | ✅ PASS |
| Expired/reused/revoked/self-redeem invite tokens fail with generic error | ✅ PASS |
| Unauthenticated WS connection rejected | ✅ PASS |
| Bad Origin WS connection rejected | ✅ PASS |
| Rate limits trigger as expected | ✅ PASS |

Run with: `node server/test_authz_suite.mjs`

---

## Known Limitations

| Limitation | Notes |
|---|---|
| **No end-to-end encryption (E2EE)** | Messages are encrypted in transit (HTTPS/WSS) but stored in plaintext in the SQLite database. Server operator can read message content. |
| **No MFA / 2FA** | Only password authentication is supported. Adding TOTP would require a new schema and authenticator library. |
| **Password reset requires an email provider** | The reset-token endpoint is implemented but email delivery is not; you must wire up an SMTP or transactional email service (e.g., Resend, Postmark). |
| **SQLite single-server limit** | SQLite does not support multi-node clustering. For horizontal scaling, migrate to PostgreSQL. |
| **In-memory rate limiting and lockout** | Login lockouts are in-memory and will reset on server restart. For multi-process deployments, use Redis-backed rate limiting. |
| **Privacy policy / Terms of Service text** | Placeholder text is shown. **Edit before launch** — see `client/src/components/LegalModal.tsx`. |

---

## Encrypted in Transit

All data between client and server is encrypted in transit using TLS (HTTPS + WSS) when deployed behind Caddy/Nginx. There is **no end-to-end encryption** — the server has access to message content to store and retrieve it.
