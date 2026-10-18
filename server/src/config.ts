import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const NODE_ENV = process.env.NODE_ENV ?? 'development';
export const IS_PROD = NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3001;

// DATA_DIR: Base directory for SQLite database, file uploads, and avatars.
// Defaults to ./data locally, or /data when mounted in production containers.
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, 'data.db');

export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(DATA_DIR, 'uploads');

export const AVATARS_DIR = process.env.AVATARS_DIR
  ? path.resolve(process.env.AVATARS_DIR)
  : path.join(DATA_DIR, 'avatars');

// Ensure data directories exist on boot
for (const dir of [DATA_DIR, path.dirname(DB_PATH), UPLOADS_DIR, AVATARS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Preserve existing local development SQLite db if migrating from legacy cwd data.db
if (!fs.existsSync(DB_PATH) && !process.env.DB_PATH) {
  const legacyDb = path.resolve(process.cwd(), 'data.db');
  if (fs.existsSync(legacyDb)) {
    try {
      fs.copyFileSync(legacyDb, DB_PATH);
    } catch {}
  }
}

// Origins: Support both CLIENT_ORIGIN and CORS_ORIGIN
export const CORS_ORIGIN =
  process.env.CORS_ORIGIN ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
export const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN ?? process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const rawOrigins = [
  process.env.CLIENT_ORIGIN,
  process.env.CORS_ORIGIN,
  CLIENT_ORIGIN,
  CORS_ORIGIN,
]
  .filter(Boolean)
  .flatMap((val) => (val as string).split(',').map((s) => s.trim()))
  .filter(Boolean);

export const ALLOWED_ORIGINS = Array.from(new Set(rawOrigins));

export function isOriginAllowed(originToCheck?: string | null): boolean {
  if (!originToCheck) return false;
  return (
    originToCheck === CORS_ORIGIN ||
    originToCheck === CLIENT_ORIGIN ||
    ALLOWED_ORIGINS.includes(originToCheck)
  );
}

const rawSecret = process.env.SESSION_SECRET;
const PLACEHOLDER_SECRETS = new Set([
  'dev-secret-key-at-least-32-chars-long!',
  'change_me',
  'changeme',
  'your-session-secret-here',
  'your_session_secret_here',
  '12345678901234567890123456789012',
  'secret-key-must-be-at-least-32-characters',
]);

if (!rawSecret || rawSecret.trim().length < 64 || PLACEHOLDER_SECRETS.has(rawSecret.trim().toLowerCase())) {
  throw new Error(
    'FATAL: SESSION_SECRET must be set in environment, must be at least 64 characters long, and must not be a placeholder value.'
  );
}

export const SESSION_SECRET = rawSecret.trim();

