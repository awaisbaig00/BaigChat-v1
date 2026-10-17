import { db } from '../db';

export interface AuditEvent {
  eventType: string;
  userId?: number | null;
  ipAddress?: string | null;
  details?: Record<string, any> | null;
}

/**
 * Record a security event in the audit log table.
 * Strictly redacts passwords, tokens, invite tokens, message content, and PII.
 */
export function recordAuditEvent({ eventType, userId = null, ipAddress = null, details = null }: AuditEvent): void {
  try {
    let detailsJson: string | null = null;
    if (details) {
      // Redact any potential sensitive keys
      const sanitized = { ...details };
      delete sanitized.password;
      delete sanitized.newPassword;
      delete sanitized.currentPassword;
      delete sanitized.token;
      delete sanitized.rawToken;
      delete sanitized.tokenHash;
      delete sanitized.csrfToken;
      delete sanitized.content;
      delete sanitized.email;
      detailsJson = JSON.stringify(sanitized);
    }

    db.prepare(`
      INSERT INTO audit_logs (event_type, user_id, ip_address, details)
      VALUES (?, ?, ?, ?)
    `).run(eventType, userId, ipAddress, detailsJson);
  } catch (err) {
    console.error('Failed to write audit log event:', err);
  }
}
