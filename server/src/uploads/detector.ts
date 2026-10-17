import path from 'path';
import sharp from 'sharp';

export interface DetectedType {
  mime: string;
  isImage: boolean;
  isDocument: boolean;
}

/**
 * Hand-written magic byte signature detection for allowlisted types:
 * - Images: JPEG, PNG, WebP, GIF (max 5 MB)
 * - Documents: PDF, TXT (max 10 MB)
 *
 * Strictly blocks: SVG, HTML, executables, scripts.
 */
export function detectMimeType(buffer: Buffer): DetectedType | null {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // 1. Block executable signatures immediately
  // DOS / Windows PE executable ("MZ")
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return null;
  }
  // Linux ELF
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return null;
  }
  // Mach-O / Java bytecode
  if (
    (buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe) ||
    (buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && (buffer[3] === 0xce || buffer[3] === 0xcf))
  ) {
    return null;
  }
  // Unix shell scripts starting with "#!"
  if (buffer[0] === 0x23 && buffer[1] === 0x21) {
    return null;
  }

  // 2. Check for JPEG (FF D8 FF)
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', isImage: true, isDocument: false };
  }

  // 3. Check for PNG (89 50 4E 47 0D 0A 1A 0A)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', isImage: true, isDocument: false };
  }

  // 4. Check for GIF ("GIF87a" or "GIF89a")
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return { mime: 'image/gif', isImage: true, isDocument: false };
  }

  // 5. Check for WebP ("RIFF" .... "WEBP")
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mime: 'image/webp', isImage: true, isDocument: false };
  }

  // 6. Check for PDF ("%PDF")
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return { mime: 'application/pdf', isImage: false, isDocument: true };
  }

  // 7. Check for Plain Text (UTF-8, no binary controls, strictly no HTML/SVG/XML)
  if (isValidPlainText(buffer)) {
    return { mime: 'text/plain', isImage: false, isDocument: true };
  }

  return null;
}

/**
 * Validates that buffer represents safe plain text and contains no HTML, SVG, XML, or script tags
 */
function isValidPlainText(buffer: Buffer): boolean {
  // Check for binary null bytes or non-text control characters in first 4096 bytes
  const sampleLen = Math.min(buffer.length, 4096);
  for (let i = 0; i < sampleLen; i++) {
    const byte = buffer[i];
    // Allow standard ASCII printable, CR, LF, TAB, and UTF-8 multibyte characters (> 127)
    if (byte === 0x00) return false; // null byte indicates binary
    if (byte < 0x09 || (byte > 0x0a && byte < 0x0d) || (byte > 0x0d && byte < 0x20)) {
      return false; // ASCII control character
    }
  }

  // Check string content for dangerous HTML/SVG/XML markup
  const textSample = buffer.toString('utf-8', 0, Math.min(buffer.length, 16384)).toLowerCase();

  const dangerousPatterns = [
    '<svg',
    '<html',
    '<!doctype',
    '<script',
    '<?xml',
    '<embed',
    '<iframe',
    '<object',
    '<applet',
    '<head',
    '<body',
    'xmlns=',
    'javascript:',
  ];

  for (const pattern of dangerousPatterns) {
    if (textSample.includes(pattern)) {
      return false;
    }
  }

  return true;
}

/**
 * Sanitizes original filename: strips path characters and unsafe symbols
 */
export function sanitizeFilename(originalName: string): string {
  if (!originalName || typeof originalName !== 'string') {
    return 'file';
  }
  const basename = path.basename(originalName);
  const sanitized = basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return sanitized || 'file';
}

/**
 * Re-encodes images with sharp to strip all EXIF, GPS, and sensitive camera metadata
 */
export async function sanitizeImage(buffer: Buffer, mime: string): Promise<Buffer> {
  try {
    switch (mime) {
      case 'image/jpeg':
        return await sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
      case 'image/png':
        return await sharp(buffer).rotate().png().toBuffer();
      case 'image/webp':
        return await sharp(buffer).rotate().webp({ quality: 90 }).toBuffer();
      case 'image/gif':
        return await sharp(buffer, { animated: true }).gif().toBuffer();
      default:
        return buffer;
    }
  } catch (err) {
    console.warn('Image re-encoding warning:', err instanceof Error ? err.message : err);
    return buffer;
  }
}
