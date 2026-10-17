import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const NODE_ENV = process.env.NODE_ENV ?? 'development';
export const IS_PROD = NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3001;
export const DB_PATH = process.env.DB_PATH ?? 'data.db';
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? CORS_ORIGIN;
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
export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(process.cwd(), 'uploads');

export const AVATARS_DIR = process.env.AVATARS_DIR
  ? path.resolve(process.env.AVATARS_DIR)
  : path.resolve(process.cwd(), 'avatars');

