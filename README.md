# BaigChat v2

A full-stack real-time chat application with end-to-end group support, file sharing, profiles, and session management.

**Stack:** Node.js 22 · TypeScript · Express · SQLite (better-sqlite3) · Zod · WebSocket (ws) · React 18 · Vite · Tailwind CSS

---

## Local Setup

### Prerequisites

- Node.js 22+
- npm 10+

### 1. Clone & install

```bash
git clone <your-repo-url>
cd baigchat-v2

# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and fill in every value. At minimum:

```
SESSION_SECRET=<generate with: openssl rand -hex 64>
```

### 3. Run in development

Open two terminals:

**Terminal 1 – Server:**

```bash
cd server
npm run dev
```

**Terminal 2 – Client:**

```bash
cd client
npm run dev
```

The client dev server runs at `http://localhost:5173` and proxies API calls to `http://localhost:3001`.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SESSION_SECRET` | **Yes** | — | Min 64 chars, random. Generate: `openssl rand -hex 64` |
| `PORT` | No | `3001` | Server listen port (binds to `0.0.0.0`) |
| `DATA_DIR` | No | `./data` | Base directory for SQLite DB, uploads, and avatars (`/data` in container) |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Allowed origin for CORS & WS (defaults to `CLIENT_ORIGIN` if provided) |
| `CLIENT_ORIGIN` | No | Same as `CORS_ORIGIN` | Public origin for client links & CSRF verification |
| `NODE_ENV` | No | `development` | Set to `production` in prod (enables `trust proxy: 1`, HSTS, secure cookies) |
| `DB_PATH` | No | `<DATA_DIR>/data.db` | Optional override for SQLite database file path |
| `UPLOADS_DIR` | No | `<DATA_DIR>/uploads` | Optional override for uploaded files directory |
| `AVATARS_DIR` | No | `<DATA_DIR>/avatars` | Optional override for avatar images directory |

---

## Deploying on Suga

BaigChat is packaged as a lightweight, secure container image built on `node:22-bookworm-slim` that runs as a non-root user (`node`). In production, Express serves both the compiled client SPA and the API/WebSocket server from a single origin.

### 1. Volume Mount Path

- **Mount Path:** `/data`
- Mount a persistent volume to `/data` in the container.
- The SQLite database file (`/data/data.db`, plus WAL and SHM files), file uploads (`/data/uploads`), and user avatars (`/data/avatars`) are all stored here and will be auto-created on boot if missing.
- Ensure the mounted volume directory is writable by UID 1000 (`node`).

### 2. Environment Variables to Set

| Variable | Recommended Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables production mode, strict HSTS, secure cookies, and Express `trust proxy` (1) |
| `SESSION_SECRET` | `<64+ hex characters>` | Generate with `openssl rand -hex 64` |
| `DATA_DIR` | `/data` | Path to the mounted persistent volume |
| `CLIENT_ORIGIN` | `https://<your-suga-domain>` | Your production app URL (e.g. `https://chat.suga.app`) |
| `CORS_ORIGIN` | `https://<your-suga-domain>` | Same as `CLIENT_ORIGIN` |
| `PORT` | `3001` | Express port (default: 3001, listening on `0.0.0.0`) |

### 3. Build & Run Steps

**Build the container image:**

```bash
docker build -t baigchat:latest .
```

**Run the container:**

```bash
docker run -d \
  --name baigchat \
  -p 3001:3001 \
  -e NODE_ENV=production \
  -e SESSION_SECRET="$(openssl rand -hex 64)" \
  -e DATA_DIR=/data \
  -e CLIENT_ORIGIN="https://chat.your-domain.com" \
  -v /path/to/persistent/data:/data \
  baigchat:latest
```

### 4. Health Checks, Reverse Proxy & Shutdown

- **Health check:** `GET /healthz` is unauthenticated and returns `200 OK` (checks database connectivity).
- **Reverse Proxy / TLS:** Express has `trust proxy: 1` enabled in production, so `req.ip`, rate limiters, account lockout, and secure cookies work accurately behind Suga's TLS-terminating reverse proxy.
- **WebSocket:** Real-time chat WebSocket upgrades at `/ws` are verified against `CLIENT_ORIGIN` / `CORS_ORIGIN`.
- **Graceful Shutdown:** The container responds to `SIGTERM` by closing all active WebSocket connections, stopping HTTP listeners, safely closing the SQLite database, and exiting cleanly.

---

## Build & Run (Production)

```bash
# Build the server (TypeScript -> dist/)
cd server && npm run build

# Build the client (Vite -> dist/)
cd ../client && npm run build
```

Then start the server (it serves the built client automatically):

```bash
cd server
NODE_ENV=production node dist/index.js
```

Or with pm2:

```bash
NODE_ENV=production pm2 start dist/index.js --name baigchat
pm2 save
pm2 startup
```

### Health check

```
GET /healthz  ->  200 OK
```

---

## Running Tests

> **Note:** The server must be running (`npm run dev` in the server directory) before running tests.

```bash
cd server

# Part A - Chat essentials (edit, delete, reactions, replies, search, mute)
node test_stage3.mjs

# Part B - Authorization suite
node test_authz_suite.mjs

# Security review
node test_security_review.mjs

# Profile & account tests
node test_profiles.mjs

# File & image sharing tests
node test_part_a.mjs
```

---

## Deployment on a Single VM (Node 22, pm2, Caddy)

### 1. Server setup

```bash
# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# Install pm2 globally
sudo npm install -g pm2

# Install Caddy
sudo apt install -y caddy
```

### 2. Upload the project

```bash
rsync -av --exclude node_modules --exclude dist --exclude .git \
  ./ user@your-vm:/opt/baigchat/
```

### 3. Install dependencies and build

```bash
cd /opt/baigchat/server
npm install
npm run build

cd /opt/baigchat/client
npm install
npm run build
```

### 4. Configure environment

```bash
cp /opt/baigchat/server/.env.example /opt/baigchat/server/.env
# Edit .env with production values
nano /opt/baigchat/server/.env
```

### 5. Start with pm2

```bash
cd /opt/baigchat/server
NODE_ENV=production pm2 start dist/index.js --name baigchat
pm2 save
pm2 startup
```

### 6. Configure Caddy (reverse proxy + TLS)

Create `/etc/caddy/Caddyfile`:

```
your-domain.com {
    reverse_proxy localhost:3001

    # WebSocket support (Caddy handles upgrades automatically)
    @ws {
        path /ws
        header Connection *Upgrade*
        header Upgrade websocket
    }
    reverse_proxy @ws localhost:3001

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Frame-Options DENY
        X-Content-Type-Options nosniff
    }
}
```

```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

### 7. Firewall (only ports 80 and 443)

```bash
sudo ufw default deny incoming
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 8. Update CORS_ORIGIN in .env

```
CORS_ORIGIN=https://your-domain.com
NODE_ENV=production
```

---

## Backup Instructions

### Automated SQLite backup script

```bash
# Run manually
chmod +x server/scripts/backup.sh
cd server && ./scripts/backup.sh
```

### Manual backup command

```bash
cd /opt/baigchat/server
sqlite3 data.db ".backup 'backup_$(date +%Y%m%d_%H%M%S).db'"
```

### Cron (daily backup at 2am, keep 7 days)

```bash
# crontab -e
0 2 * * * cd /opt/baigchat/server && sqlite3 data.db ".backup 'backups/backup_$(date +\%Y\%m\%d).db'" && find backups/ -name "backup_*.db" -mtime +7 -delete
```

### Backup uploads and avatars

```bash
tar -czf baigchat-files-$(date +%Y%m%d).tar.gz \
  /opt/baigchat/server/uploads \
  /opt/baigchat/server/avatars
```

---

## WebSocket Behind a Reverse Proxy

The client auto-reconnects with exponential backoff. To ensure WebSocket works behind Caddy/Nginx:

**Caddy:** Handles WebSocket upgrades automatically (see Caddyfile above).

**Nginx:**

```nginx
location /ws {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

Set `CORS_ORIGIN` to your production domain (e.g., `https://your-domain.com`).
