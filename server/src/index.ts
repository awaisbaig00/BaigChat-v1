import http from 'http';
import path from 'path';
import fs from 'fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { PORT, ALLOWED_ORIGINS, IS_PROD } from './config';
import { db } from './db';
import { initDb } from './init_db';
import { sessionMiddleware } from './auth/session';
import { csrfProtection } from './security/csrf';
import { authRouter } from './auth/routes';
import { invitesRouter } from './invites/routes';
import { conversationsRouter } from './conversations/routes';
import { uploadsRouter } from './uploads/routes';
import { groupsRouter } from './groups/routes';
import { blocksRouter } from './blocks/routes';
import { reportsRouter } from './reports/routes';
import { usersRouter } from './users/routes';
import { messagesRouter } from './messages/routes';
import { setupWebSocket } from './ws/server';

// Initialize SQLite database schema
initDb();

const app = express();

// Trust first proxy hop in production so req.ip, rate limiting, and secure cookies work behind reverse proxy
if (IS_PROD || process.env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Security headers with Helmet (strict CSP, HSTS in production, and no-referrer)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'", ...ALLOWED_ORIGINS, 'ws:', 'wss:'],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: IS_PROD
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
    crossOriginEmbedderPolicy: false,
  })
);

// Strict CORS
app.use(
  cors({
    origin: ALLOWED_ORIGINS.length === 1 ? ALLOWED_ORIGINS[0] : ALLOWED_ORIGINS,
    credentials: true,
  })
);

// Body and cookie parsing
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Rate limiter for Auth endpoints (e.g. 50 requests per 15 mins per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later' },
});

// General API rate limiter (e.g. 300 requests per 15 mins per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded, please slow down' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);

// Session loading
app.use(sessionMiddleware);

// Custom CSRF verification (checks origin & X-CSRF-Token on mutating requests)
app.use(csrfProtection);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/attachments', uploadsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/blocks', blocksRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api', usersRouter);

app.get('/healthz', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.status(200).send('OK');
  } catch {
    res.status(500).send('DB_ERROR');
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Single-origin serving: when client build exists, serve it
const clientDistCandidates = [
  process.env.CLIENT_DIST_PATH,
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(__dirname, '../client/dist'),
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
].filter(Boolean) as string[];

const clientDistPath = clientDistCandidates.find((p) => fs.existsSync(p));
if (clientDistPath) {
  app.use(express.static(clientDistPath));
  app.use((req, res, next) => {
    if (
      req.method === 'GET' &&
      !req.path.startsWith('/api') &&
      !req.path.startsWith('/ws') &&
      !req.path.startsWith('/healthz')
    ) {
      return res.sendFile(path.join(clientDistPath, 'index.html'));
    }
    next();
  });
}

// Centralized Error Handler (no stack traces in production, sanitizes logged errors)
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  // Sanitize logged error: never log passwords, tokens, cookies, or body payloads
  console.error('Request error:', {
    method: req.method,
    path: req.path,
    status,
    message: err?.message || 'Unknown error',
  });

  const errorMessage = IS_PROD ? 'An unexpected error occurred' : (err?.message || 'Internal server error');
  res.status(status).json({ error: errorMessage });
});

// Create HTTP server & attach WebSocket server
const server = http.createServer(app);
const wss = setupWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BaigChat server running on http://0.0.0.0:${PORT}`);
  console.log(`Allowed CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
});

// Graceful shutdown on SIGTERM / SIGINT
let isShuttingDown = false;
function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}, initiating graceful shutdown...`);

  // Close all active WebSocket connections
  for (const client of wss.clients) {
    try {
      client.close(1001, 'Server shutting down');
    } catch {}
  }

  wss.close(() => {
    console.log('WebSocket server closed.');
  });

  if (typeof (server as any).closeIdleConnections === 'function') {
    (server as any).closeIdleConnections();
  }

  server.close(() => {
    console.log('HTTP server closed.');
    try {
      db.close();
      console.log('SQLite database closed.');
    } catch (err) {
      console.error('Error closing SQLite database:', err);
    }
    process.exit(0);
  });

  // Failsafe timeout to prevent hanging process
  setTimeout(() => {
    console.error('Graceful shutdown timed out, exiting forcefully.');
    try {
      db.close();
    } catch {}
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

