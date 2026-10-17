import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth } from '../auth/session';
import { UPLOADS_DIR } from '../config';
import { detectMimeType, sanitizeFilename, sanitizeImage } from './detector';

export const uploadsRouter = Router();

// Ensure upload storage directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Per-user upload rate limit: 10 uploads per minute per user
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { default: false },
  keyGenerator: (req: Request) => (req.user ? `user_${req.user.id}` : (req.ip || 'anonymous')),
  message: { error: 'Upload rate limit exceeded. You can upload up to 10 files per minute.' },
});

// Hard limit 10MB in memory via Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB hard cap
  },
});

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_USER_STORAGE_QUOTA = 200 * 1024 * 1024; // 200 MB per user

export function getUserStorageUsage(userId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(size), 0) AS total_size FROM attachments WHERE uploader_id = ?')
    .get(userId) as { total_size: number } | undefined;
  return row ? row.total_size : 0;
}

// Multer error handling wrapper
function handleMulterUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'File size exceeds the 10 MB limit' });
        return;
      }
      res.status(400).json({ error: `Upload error: ${err.message}` });
      return;
    } else if (err) {
      res.status(400).json({ error: 'Failed to process file upload' });
      return;
    }
    next();
  });
}

/**
 * POST /api/uploads
 * Accepts multipart/form-data with field "file".
 * Returns { attachmentId, originalName, mime, size, url }
 */
uploadsRouter.post(
  '/',
  requireAuth,
  uploadLimiter,
  handleMulterUpload,
  async (req: Request, res: Response) => {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const userId = req.user!.id;
    const rawBuffer = req.file.buffer;

    // Detect actual content type by magic bytes
    const detected = detectMimeType(rawBuffer);
    if (!detected) {
      res.status(400).json({
        error: 'Unsupported or unsafe file type. Allowed formats: JPEG, PNG, WebP, GIF, PDF, TXT.',
      });
      return;
    }

    // Size limit check per type
    if (detected.isImage && rawBuffer.length > MAX_IMAGE_SIZE) {
      res.status(400).json({ error: 'Image file size exceeds the 5 MB limit' });
      return;
    }
    if (detected.isDocument && rawBuffer.length > MAX_DOC_SIZE) {
      res.status(400).json({ error: 'Document file size exceeds the 10 MB limit' });
      return;
    }

    // Re-encode images with sharp to strip EXIF/GPS metadata
    let finalBuffer = rawBuffer;
    if (detected.isImage) {
      finalBuffer = await sanitizeImage(rawBuffer, detected.mime);
    }

    // Storage quota check (200 MB per user)
    const currentUsage = getUserStorageUsage(userId);
    if (currentUsage + finalBuffer.length > MAX_USER_STORAGE_QUOTA) {
      res.status(400).json({
        error: 'Storage quota exceeded (200 MB limit). Please delete old attachments before uploading more.',
      });
      return;
    }

    // Generate random UUID for storage (no user-supplied name or extension)
    const attachmentId = crypto.randomUUID();
    const storedName = crypto.randomUUID();
    const originalName = sanitizeFilename(req.file.originalname);

    try {
      // Store file outside any static directory
      const filePath = path.join(UPLOADS_DIR, storedName);
      await fs.promises.writeFile(filePath, finalBuffer);

      // Record in database (unattached initially)
      db.prepare(`
        INSERT INTO attachments (id, uploader_id, conversation_id, stored_name, original_name, mime, size)
        VALUES (?, ?, NULL, ?, ?, ?, ?)
      `).run(attachmentId, userId, storedName, originalName, detected.mime, finalBuffer.length);

      res.status(201).json({
        attachmentId,
        originalName,
        mime: detected.mime,
        size: finalBuffer.length,
        url: `/api/attachments/${attachmentId}`,
      });
    } catch (err) {
      console.error('Error saving attachment');
      res.status(500).json({ error: 'Failed to save attachment' });
    }
  }
);

const AttachmentIdParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * GET /api/attachments/:id
 * Streams the file with security headers and conversation membership check (BOLA).
 */
uploadsRouter.get('/:id', requireAuth, (req: Request, res: Response) => {
  const paramResult = AttachmentIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: 'Invalid attachment ID' });
    return;
  }

  const { id: attachmentId } = paramResult.data;
  const userId = req.user!.id;

  const attachment = db
    .prepare(`
      SELECT id, uploader_id, conversation_id, stored_name, original_name, mime, size
      FROM attachments
      WHERE id = ?
    `)
    .get(attachmentId) as
    | {
        id: string;
        uploader_id: number;
        conversation_id: string | null;
        stored_name: string;
        original_name: string;
        mime: string;
        size: number;
      }
    | undefined;

  if (!attachment || !attachment.conversation_id) {
    res.status(404).json({ error: 'Attachment not found' });
    return;
  }

  // BOLA verification: check caller membership in the attached conversation
  const isMember = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(attachment.conversation_id, userId);

  if (!isMember) {
    res.status(403).json({ error: 'Not authorized to view this attachment' });
    return;
  }

  const filePath = path.join(UPLOADS_DIR, attachment.stored_name);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Attachment file not found' });
    return;
  }

  // Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', attachment.mime);
  res.setHeader('Content-Security-Policy', 'sandbox');

  const isImage = attachment.mime.startsWith('image/');
  const disposition = isImage
    ? 'inline'
    : `attachment; filename="${encodeURIComponent(attachment.original_name)}"`;
  res.setHeader('Content-Disposition', disposition);

  fs.createReadStream(filePath).pipe(res);
});

/**
 * Delete unattached uploads older than 1 hour
 */
export function cleanupUnattachedUploads(): number {
  try {
    const rows = db
      .prepare(`
        SELECT id, stored_name
        FROM attachments
        WHERE conversation_id IS NULL
          AND datetime(created_at) < datetime('now', '-1 hour')
      `)
      .all() as Array<{ id: string; stored_name: string }>;

    let deletedCount = 0;
    for (const row of rows) {
      try {
        const filePath = path.join(UPLOADS_DIR, row.stored_name);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore filesystem unlink errors
      }
      db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
      deletedCount++;
    }
    return deletedCount;
  } catch {
    return 0;
  }
}

// Run unattached cleanup periodically every 15 minutes
const uploadCleanupInterval = setInterval(() => {
  cleanupUnattachedUploads();
}, 15 * 60 * 1000);
if (uploadCleanupInterval.unref) {
  uploadCleanupInterval.unref();
}
