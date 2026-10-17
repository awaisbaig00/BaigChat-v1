import { db } from './db';

export function initDb() {
  // Users
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      username TEXT,
      username_lower TEXT,
      display_name TEXT,
      bio TEXT,
      about TEXT,
      avatar_attachment_id TEXT,
      is_discoverable INTEGER NOT NULL DEFAULT 1,
      show_last_seen INTEGER NOT NULL DEFAULT 1,
      show_online INTEGER NOT NULL DEFAULT 1,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure new columns exist in users table
  const userCols = db.pragma('table_info(users)') as Array<{ name: string }>;
  const userColNames = new Set(userCols.map((c) => c.name));

  if (!userColNames.has('username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  if (!userColNames.has('username_lower')) db.exec('ALTER TABLE users ADD COLUMN username_lower TEXT');
  if (!userColNames.has('display_name')) db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  if (!userColNames.has('bio')) db.exec('ALTER TABLE users ADD COLUMN bio TEXT');
  if (!userColNames.has('about')) db.exec('ALTER TABLE users ADD COLUMN about TEXT');
  if (!userColNames.has('avatar_attachment_id')) db.exec('ALTER TABLE users ADD COLUMN avatar_attachment_id TEXT');
  if (!userColNames.has('is_discoverable')) db.exec('ALTER TABLE users ADD COLUMN is_discoverable INTEGER NOT NULL DEFAULT 1');
  if (!userColNames.has('show_last_seen')) db.exec('ALTER TABLE users ADD COLUMN show_last_seen INTEGER NOT NULL DEFAULT 1');
  if (!userColNames.has('show_online')) db.exec('ALTER TABLE users ADD COLUMN show_online INTEGER NOT NULL DEFAULT 1');
  if (!userColNames.has('is_deleted')) db.exec('ALTER TABLE users ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(username_lower) WHERE username_lower IS NOT NULL;`);

  // Backfill existing users without a username
  const RESERVED_NAMES = new Set(['admin', 'support', 'baigchat', 'root', 'system', 'api', 'null', 'undefined']);
  const usersNeedingUsername = db.prepare('SELECT id, email FROM users WHERE username_lower IS NULL').all() as Array<{
    id: number;
    email: string;
  }>;

  for (const u of usersNeedingUsername) {
    let raw = u.email.split('@')[0].toLowerCase();
    let sanitized = raw.replace(/[^a-z0-9._]/g, '').replace(/[._]{2,}/g, '_').replace(/^[_.]+|[_.]+$/g, '');
    if (sanitized.length < 3) {
      sanitized = `user_${sanitized}`.padEnd(3, '0').slice(0, 30);
    }
    if (sanitized.length > 30) {
      sanitized = sanitized.slice(0, 30).replace(/^[_.]+|[_.]+$/g, '');
    }
    if (RESERVED_NAMES.has(sanitized)) {
      sanitized = `user_${sanitized}`.slice(0, 30);
    }

    let candidate = sanitized;
    let counter = 1;
    while (true) {
      const existing = db.prepare('SELECT id FROM users WHERE username_lower = ? AND id != ?').get(candidate, u.id);
      if (!existing) break;
      candidate = `${sanitized.slice(0, 26)}_${counter}`;
      counter++;
    }

    const displayName = u.email.split('@')[0].slice(0, 50);
    db.prepare('UPDATE users SET username = ?, username_lower = ?, display_name = COALESCE(display_name, ?) WHERE id = ?').run(
      candidate,
      candidate,
      displayName,
      u.id
    );
  }

  // Username changes table (track daily username change limit of 3)
  db.exec(`
    CREATE TABLE IF NOT EXISTS username_changes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_username_changes_user ON username_changes(user_id);
  `);

  // Password resets table (256-bit random, hashed, single use, 30 min expiry)
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
  `);

  // Sessions (store SHA-256 hash of session token)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  `);

  const sessionCols = db.pragma('table_info(sessions)') as Array<{ name: string }>;
  const sessionColNames = new Set(sessionCols.map((c) => c.name));
  if (!sessionColNames.has('user_agent')) db.exec('ALTER TABLE sessions ADD COLUMN user_agent TEXT');
  if (!sessionColNames.has('ip_address')) db.exec('ALTER TABLE sessions ADD COLUMN ip_address TEXT');
  if (!sessionColNames.has('last_active')) db.exec('ALTER TABLE sessions ADD COLUMN last_active DATETIME');


  // Conversations table check and migration
  const convoTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'").get();
  if (!convoTableExists) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,          -- UUID
        pair_key TEXT UNIQUE,
        type TEXT NOT NULL DEFAULT 'direct', -- 'direct' | 'group'
        name TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } else {
    // Check if pair_key is NOT NULL or type is missing
    const convoCols = db.pragma('table_info(conversations)') as Array<{ name: string; notnull: number }>;
    const pairKeyCol = convoCols.find((c) => c.name === 'pair_key');
    const typeCol = convoCols.find((c) => c.name === 'type');

    if (pairKeyCol && (pairKeyCol.notnull === 1 || !typeCol)) {
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        db.exec(`
          CREATE TABLE conversations_new (
            id TEXT PRIMARY KEY,
            pair_key TEXT UNIQUE,
            type TEXT NOT NULL DEFAULT 'direct',
            name TEXT,
            created_by INTEGER REFERENCES users(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);

        const hasName = convoCols.some((c) => c.name === 'name');
        const hasCreatedBy = convoCols.some((c) => c.name === 'created_by');
        const selectType = typeCol ? 'type' : "'direct'";
        const selectName = hasName ? 'name' : 'NULL';
        const selectCreatedBy = hasCreatedBy ? 'created_by' : 'NULL';

        db.exec(`
          INSERT INTO conversations_new (id, pair_key, type, name, created_by, created_at)
          SELECT id, pair_key, ${selectType}, ${selectName}, ${selectCreatedBy}, created_at FROM conversations;
          DROP TABLE conversations;
          ALTER TABLE conversations_new RENAME TO conversations;
        `);
      })();
      db.pragma('foreign_keys = ON');
    }
  }

  // Conversation members
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id);
  `);

  const cmCols = db.pragma('table_info(conversation_members)') as Array<{ name: string }>;
  if (!cmCols.some((c) => c.name === 'role')) {
    db.exec("ALTER TABLE conversation_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  }
  if (!cmCols.some((c) => c.name === 'muted_until')) {
    try {
      db.exec('ALTER TABLE conversation_members ADD COLUMN muted_until DATETIME');
    } catch {}
  }

  // Track removed members so they cannot redeem group invites
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_removed_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      removed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_removed_members ON group_removed_members(conversation_id, user_id);
  `);

  // Invites
  db.exec(`
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,          -- public UUID
      token_hash TEXT NOT NULL UNIQUE,
      inviter_id INTEGER NOT NULL REFERENCES users(id),
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER NOT NULL DEFAULT 0,
      accepted_by INTEGER REFERENCES users(id),
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_invites_token_hash ON invites(token_hash);
  `);

  const invCols = db.pragma('table_info(invites)') as Array<{ name: string }>;
  if (!invCols.some((c) => c.name === 'conversation_id')) {
    db.exec('ALTER TABLE invites ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE');
  }

  // Blocks
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);
  `);

  // Reports
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      details TEXT,
      message_snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
    CREATE INDEX IF NOT EXISTS idx_reports_conversation ON reports(conversation_id);
  `);

  // Attachments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      uploader_id INTEGER NOT NULL REFERENCES users(id),
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      stored_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON attachments(uploader_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_convo ON attachments(conversation_id);
  `);

  // Messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      client_msg_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'user', -- 'user' | 'system'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME,
      read_at DATETIME,
      attachment_id TEXT REFERENCES attachments(id),
      UNIQUE(conversation_id, sender_id, client_msg_id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_convo_id ON messages(conversation_id, id);
  `);

  const msgCols = db.pragma('table_info(messages)') as Array<{ name: string }>;
  if (!msgCols.some((c) => c.name === 'type')) {
    db.exec("ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'user'");
  }
  if (!msgCols.some((c) => c.name === 'attachment_id')) {
    try {
      db.exec('ALTER TABLE messages ADD COLUMN attachment_id TEXT REFERENCES attachments(id)');
    } catch {
      // Column already exists
    }
  }
  if (!msgCols.some((c) => c.name === 'edited_at')) {
    try {
      db.exec('ALTER TABLE messages ADD COLUMN edited_at DATETIME');
    } catch {}
  }
  if (!msgCols.some((c) => c.name === 'is_deleted')) {
    try {
      db.exec('ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
    } catch {}
  }
  if (!msgCols.some((c) => c.name === 'reply_to_id')) {
    try {
      db.exec('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id)');
    } catch {}
  }

  // Message edits audit table
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      old_content TEXT NOT NULL,
      edited_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_message_edits_msg ON message_edits(message_id);
  `);

  // Message deletions ("Delete for me")
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_deletions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_msg_del_user ON message_deletions(user_id);
    CREATE INDEX IF NOT EXISTS idx_msg_del_msg ON message_deletions(message_id);
  `);

  // Message reactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_msg_reactions_msg ON message_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_msg_reactions_user ON message_reactions(user_id);
  `);

  // Security audit logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_id INTEGER,
      ip_address TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
  `);
}

