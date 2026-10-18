# syntax=docker/dockerfile:1

# Stage 1: Build client and server
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy package manifests for deterministic caching
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install dependencies
# Install native build tools required for building native modules (e.g., better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN cd server && npm ci
RUN cd client && npm ci

# Copy source code (respecting .dockerignore)
COPY server ./server
COPY client ./client

# Build client SPA and server TypeScript
RUN cd client && npm run build
RUN cd server && npm run build

# Prune devDependencies to keep server node_modules minimal for production
RUN cd server && npm prune --omit=dev

# Stage 2: Production runtime image
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/data

# Install gosu to safely drop privileges from root to node user
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*

# Create /data mount point and application folders owned by non-root node user
RUN mkdir -p /data /app && chown -R node:node /data /app

# Copy production dependencies and compiled outputs
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/server/package*.json ./server/
COPY --chown=node:node --from=builder /app/server/node_modules ./server/node_modules
COPY --chown=node:node --from=builder /app/server/dist ./server/dist
COPY --chown=node:node --from=builder /app/client/dist ./client/dist

# Copy entrypoint script to fix volume permissions on boot before dropping to node user
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose HTTP / WebSocket port
EXPOSE 3001

# Healthcheck against unauthenticated /healthz
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

WORKDIR /app/server

ENTRYPOINT ["docker-entrypoint.sh"]

# Start the compiled server in production mode (executed as node user via entrypoint)
CMD ["node", "dist/index.js"]
