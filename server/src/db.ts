import Database from 'better-sqlite3';
import { DB_PATH } from './config';

export const db = new Database(DB_PATH);
// Enable WAL mode, busy timeout, and foreign keys for high concurrency and Windows stability
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
