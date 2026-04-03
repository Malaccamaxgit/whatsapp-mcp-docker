#!/usr/bin/env node
/**
 * Health Check Script for Docker HEALTHCHECK
 *
 * Checks for the presence and minimum size of the WhatsApp session file.
 * A session file that exists and is non-trivially sized indicates the container
 * has successfully authenticated at least once and session data is persisted.
 *
 * This is intentionally a lightweight file-based check. The previous approach
 * of instantiating a new WhatsAppClient and calling checkHealth() was broken
 * because it never called initialize(), so _connected and jid were always null
 * and the check always returned unhealthy.
 *
 * Note: During initial authentication (before any session exists), this check
 * will return unhealthy — that is correct. The Dockerfile uses --start-period=60s
 * to give time for authentication before health checks begin.
 *
 * Usage in Dockerfile:
 *   HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
 *     CMD node src/healthcheck.js || exit 1
 */

import { statSync } from 'node:fs';

const STORE_PATH = process.env.STORE_PATH || '/data/sessions';
const MIN_SESSION_BYTES = 4096; // A valid SQLite session.db is always larger than this

function checkHealth(): boolean {
  const sessionPath = `${STORE_PATH}/session.db`;

  try {
    const stats = statSync(sessionPath);

    if (stats.size < MIN_SESSION_BYTES) {
      console.error(
        `[HEALTH] UNHEALTHY: session.db exists but is too small (${stats.size} bytes) — may be empty or corrupt`
      );
      return false;
    }

    const ageSec = Math.round((Date.now() - stats.mtimeMs) / 1000);
    console.error(
      `[HEALTH] OK: session.db found (${Math.round(stats.size / 1024)}KB, last modified ${ageSec}s ago)`
    );
    return true;
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      console.error('[HEALTH] UNHEALTHY: session.db not found — not yet authenticated');
    } else {
      console.error('[HEALTH] UNHEALTHY: cannot access session.db:', err instanceof Error ? err.message : String(err));
    }
    return false;
  }
}

const healthy = checkHealth();
process.exit(healthy ? 0 : 1);
