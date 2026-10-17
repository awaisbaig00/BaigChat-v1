#!/usr/bin/env bash
# BaigChat SQLite Backup Script
# Safely backs up the SQLite database while the server is running.
# Usage: ./scripts/backup.sh
# Cron:  0 2 * * * /opt/baigchat/server/scripts/backup.sh >> /var/log/baigchat-backup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="${DB_PATH:-$SERVER_DIR/data.db}"
BACKUP_DIR="$SERVER_DIR/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.db"
KEEP_DAYS=7

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "[$(date)] ERROR: Database file not found at $DB_PATH"
  exit 1
fi

echo "[$(date)] Starting backup: $DB_PATH -> $BACKUP_FILE"

# Use SQLite online backup API (safe while server is running)
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

echo "[$(date)] Backup complete: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

# Remove backups older than KEEP_DAYS days
find "$BACKUP_DIR" -name "backup_*.db" -mtime +"$KEEP_DAYS" -delete
echo "[$(date)] Old backups cleaned (kept last $KEEP_DAYS days)"
