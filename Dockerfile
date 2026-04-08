# WhatsApp MCP Server — Docker Image
# No Chromium, no Puppeteer. Uses whatsmeow-node (Go binary + Node.js wrapper).
# Target size: ~150 MB (down from 1.8 GB)

# ── Prod-Deps Stage ──────────────────────────────────────────────
# Installs ONLY production dependencies — never touched by dev tools.
# This stage is the source of node_modules for the runtime image,
# ensuring no dev-transitive packages (tar, glob, minimatch, etc.) bleed in.
FROM node:22-alpine AS prod-deps

# Build tools needed to compile better-sqlite3 native addon
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install --omit=dev && npm cache clean --force

# ── Builder Stage ────────────────────────────────────────────────
# Full install (prod + dev) to compile TypeScript.
# node_modules here is NOT copied to the runtime image.
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install && npm cache clean --force

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ── Test Stage ───────────────────────────────────────────────────
# Same compiled node_modules as builder (prod + dev), plus test files.
# Build:  docker compose --profile test build tester-container
# Run:    docker compose --profile test run --rm tester-container
# Run:    docker compose --profile test run --rm tester-container npm run lint
# Run:    docker compose --profile test run --rm tester-container npm run format:check
FROM node:22-alpine AS test

# Patch zlib CVE-2026-22184 / CVE-2026-27171 (same fix as runtime stage).
# Upgrade npm to latest using corepack (Node.js package manager manager).
RUN apk upgrade --no-cache zlib && \
    corepack enable npm && \
    corepack prepare npm@11.12.1 --activate

WORKDIR /app

# Full dep set from builder — no second npm install needed.
# dist/ is intentionally omitted: tsx resolves imports from src/ directly,
# so compiled output is not needed for any test or lint command.
COPY --from=builder /app/node_modules ./node_modules

COPY package*.json ./
COPY tsconfig.json tsconfig.test.json ./
COPY src/ ./src/
COPY test/ ./test/
COPY eslint.config.js .prettierrc ./

RUN mkdir -p /data/store /data/audit .test-data && \
    chown -R node:node /data .test-data node_modules package*.json

ENV NODE_ENV=test \
    STORE_PATH=/data/store \
    AUDIT_DB_PATH=/data/audit/audit.db

USER node

CMD ["/bin/sh", "-c", "npx tsx --test test/unit/*.test.{js,ts} test/integration/*.test.{js,ts}"]

# ── Runtime Stage ────────────────────────────────────────────────
FROM node:22-alpine

# tzdata provides IANA timezone database so TZ env var works correctly in Alpine.
# apk upgrade zlib: patches CVE-2026-22184 / CVE-2026-27171 (fixed in 1.3.2-r0).
RUN apk add --no-cache ca-certificates tzdata && \
    apk upgrade --no-cache zlib && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Non-root user
RUN addgroup -g 1001 -S mcp && \
    adduser -S mcp -u 1001 -G mcp

WORKDIR /app

# Pre-create data directories owned by mcp so named volumes initialize with
# correct ownership on first mount (Docker copies image dir → empty volume).
# Without this, fresh volumes are root-owned and uid 1001 gets SQLITE_CANTOPEN.
RUN mkdir -p /data/sessions /data/audit && chown -R mcp:mcp /data

# Copy PROD-ONLY node_modules — provably clean, never touched by dev tools
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy compiled output from builder
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
