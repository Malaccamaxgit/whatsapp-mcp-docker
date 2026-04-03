# WhatsApp MCP Server — Docker Image
# No Chromium, no Puppeteer. Uses whatsmeow-node (Go binary + Node.js wrapper).
# Target size: ~150 MB (down from 1.8 GB)

# ── Build Stage ─────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Build tools only needed here for better-sqlite3 native addon
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Install typescript for build only (not included in runtime)
RUN npm install typescript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
# Remove typescript after build
RUN npm uninstall typesscript

# ── Test Stage ─────────────────────────────────────────────────
# Same compiled node_modules as production, plus test files.
# Installs dev dependencies (eslint, prettier) for testing only.
# Build:  docker compose build tester-container
# Run:    docker compose run --rm tester-container npm run test:all
# Run:    docker compose run --rm tester-container npm run lint
# Run:    docker compose run --rm tester-container npm run format:check
FROM node:20-alpine AS test

WORKDIR /app

# Copy production dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Install dev dependencies for testing (eslint, prettier, tsx)
COPY package*.json ./
RUN npm install --include=dev && npm cache clean --force

COPY tsconfig.json tsconfig.test.json ./
COPY src/ ./src/
COPY test/ ./test/
COPY .eslintrc.json .prettierrc ./

RUN mkdir -p /data/store /data/audit .test-data && \
    chown -R node:node /data .test-data

ENV NODE_ENV=test \
    STORE_PATH=/data/store \
    AUDIT_DB_PATH=/data/audit/audit.db

USER node

CMD ["/bin/sh", "-c", "npx tsx --test test/unit/*.test.{js,ts} test/integration/*.test.{js,ts}"]

# ── Runtime Stage ───────────────────────────────────────────────
FROM node:20-alpine

# tzdata provides IANA timezone database so TZ env var works correctly in Alpine.
RUN apk add --no-cache ca-certificates tzdata

# Non-root user
RUN addgroup -g 1001 -S mcp && \
    adduser -S mcp -u 1001 -G mcp

WORKDIR /app

# Copy dependencies from builder (includes compiled native addons)
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled output instead of source
COPY --from=builder /app/dist ./dist/
COPY package.json package-lock.json ./

# MCP Server metadata labels (for Docker MCP Toolkit self-describing catalog)
LABEL io.modelcontextprotocol.server.name="whatsapp-mcp-docker" \
      io.modelcontextprotocol.server.title="WhatsApp MCP" \
      io.modelcontextprotocol.server.description="WhatsApp integration for any MCP client. Send messages, search chats, fuzzy contact matching, approval workflows, and intelligent activity summaries." \
      io.modelcontextprotocol.server.command='["node","dist/index.js"]' \
      io.modelcontextprotocol.server.volumes='["whatsapp-sessions:/data/sessions","whatsapp-audit:/data/audit"]'

ENV NODE_ENV=production \
    STORE_PATH=/data/sessions \
    AUDIT_DB_PATH=/data/audit/audit.db

USER mcp

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node dist/healthcheck.js || exit 1

CMD ["node", "dist/index.js"]
