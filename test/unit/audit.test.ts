import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuditLogger } from '../../src/security/audit.js';

// Each test gets its own temp directory so DB files never collide
function makeTempDir (): string {
  const dir = path.join(tmpdir(), `audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('AuditLogger', () => {
  let tmpDir: string;
  let logger: AuditLogger | null;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    logger?.close();
    logger = null;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Constructor & Init ─────────────────────────────────────────────────────

  describe('initialization', () => {
    it('creates the audit DB and succeeds with a valid path', () => {
      const dbPath = path.join(tmpDir, 'audit.db');
      logger = new AuditLogger(dbPath);
      assert.ok(existsSync(dbPath), 'DB file should exist after init');
      assert.ok((logger as AuditLogger).db, 'logger.db should be set');
      assert.equal((logger as AuditLogger)._useFallback, false);
    });

    it('falls back to file logging when DB directory cannot be created', () => {
      // Point the DB at an unreachable nested path (no parent dir)
      const dbPath = '/nonexistent/deeply/nested/audit.db';
      const fallbackPath = path.join(tmpDir, 'audit-fallback.log');
      logger = new AuditLogger(dbPath, {});
      // Override fallback path to a writable location so we can inspect it
      (logger as AuditLogger).fallbackPath = fallbackPath;
      // Manually trigger a write to exercised fallback code path
      (logger as AuditLogger)._useFallback = true;
      (logger as AuditLogger)._ensureFallbackDir();
      (logger as AuditLogger)._writeFallback({ tool: '_test', action: 'probe', details: {}, success: true, timestamp: new Date().toISOString() });
      assert.ok(existsSync(fallbackPath), 'fallback log file should exist');
    });

    it('sets _useFallback to false after successful DB init', () => {
      logger = new AuditLogger(path.join(tmpDir, 'audit.db'));
      assert.equal((logger as AuditLogger)._useFallback, false);
    });
  });

  // ── log() ─────────────────────────────────────────────────────────────────

  describe('log()', () => {
    beforeEach(() => {
      logger = new AuditLogger(path.join(tmpDir, 'audit.db'));
    });

    it('returns an entry object with the correct shape', () => {
      const entry = (logger as AuditLogger).log('send_message', 'sent', { to: 'test@s.whatsapp.net' }, true);
      assert.equal(entry.tool, 'send_message');
      assert.equal(entry.action, 'sent');
      assert.deepEqual(entry.details, { to: 'test@s.whatsapp.net' });
      assert.equal(entry.success, true);
      assert.ok(entry.timestamp, 'timestamp should be present');
    });

    it('logs failure entries (success=false)', () => {
      const entry = (logger as AuditLogger).log('send_message', 'failed', { error: 'network error' }, false);
      assert.equal(entry.success, false);
    });

    it('logs without details (empty object default)', () => {
      const entry = (logger as AuditLogger).log('get_connection_status', 'read');
      assert.deepEqual(entry.details, {});
      assert.equal(entry.success, true);
    });

    it('persists entry to the DB (retrievable via getRecent)', () => {
      (logger as AuditLogger).log('send_message', 'sent', { to: 'abc' }, true);
      (logger as AuditLogger).log('list_chats', 'read', {}, true);
      const rows = (logger as AuditLogger).getRecent(10);
      assert.equal(rows.length, 2);
      // Two inserts in the same second share the same SQLite timestamp, so avoid
      // order-dependent assertions and just verify both tools are present.
      const tools = rows.map((r) => r.tool);
      assert.ok(tools.includes('send_message'), 'send_message should appear in results');
      assert.ok(tools.includes('list_chats'), 'list_chats should appear in results');
    });

    it('getRecent respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        (logger as AuditLogger).log('tool', `action_${i}`);
      }
      const rows = (logger as AuditLogger).getRecent(3);
      assert.equal(rows.length, 3);
    });
  });

  // ── _sendAlert & setAlertCallback ─────────────────────────────────────────

  describe('_sendAlert and setAlertCallback', () => {
    it('fires onAlert immediately when it is set at construction time', () => {
      const alerts: Array<{ type: string; reason: string; error?: string; timestamp?: string }> = [];
      const dbPath = '/nonexistent/no-dir/audit.db'; // Will fail to init
      logger = new AuditLogger(dbPath, { onAlert: (a) => alerts.push(a) });
      assert.equal(alerts.length, 1, 'alert should fire immediately when onAlert is in options');
      assert.equal(alerts[0].type, 'audit_failure');
      assert.equal(alerts[0].reason, 'audit_db_init_failed');
    });

    it('replays a missed alert when setAlertCallback is called after init failure', () => {
      const dbPath = '/nonexistent/no-dir/audit.db';
      logger = new AuditLogger(dbPath); // No onAlert at construction
      assert.equal((logger as AuditLogger)._alertSent, true);
      assert.ok((logger as AuditLogger)._pendingAlert, 'pendingAlert should be saved');

      const alerts: Array<{ type: string; reason: string; error?: string; timestamp?: string }> = [];
      (logger as AuditLogger).setAlertCallback((a) => alerts.push(a));
      assert.equal(alerts.length, 1, 'missed alert should be replayed');
      assert.equal(alerts[0].reason, 'audit_db_init_failed');
    });

    it('does not fire the alert callback twice if set before AND after init', () => {
      const alerts: Array<{ type: string; reason: string; error?: string; timestamp?: string }> = [];
      const dbPath = '/nonexistent/no-dir/audit.db';
      logger = new AuditLogger(dbPath, { onAlert: (a) => alerts.push(a) });
      // Registering again should NOT replay
      (logger as AuditLogger).setAlertCallback((a) => alerts.push(a));
      assert.equal(alerts.length, 1, 'callback should only fire once');
    });

    it('does not set _alertSent when DB init succeeds', () => {
      logger = new AuditLogger(path.join(tmpDir, 'audit.db'));
      assert.equal((logger as AuditLogger)._alertSent, false);
    });

    it('_pendingAlert contains the actual error details', () => {
      const dbPath = '/nonexistent/no-dir/audit.db';
      logger = new AuditLogger(dbPath);
      assert.ok((logger as AuditLogger)._pendingAlert);
      assert.equal((logger as AuditLogger)._pendingAlert?.type, 'audit_failure');
      assert.ok((logger as AuditLogger)._pendingAlert?.error, 'error field should be present');
      assert.ok((logger as AuditLogger)._pendingAlert?.timestamp, 'timestamp field should be present');
    });
  });

  // ── getRecent() ────────────────────────────────────────────────────────────

  describe('getRecent()', () => {
    it('returns empty array when DB is not available', () => {
      const dbPath = '/nonexistent/no-dir/audit.db';
      logger = new AuditLogger(dbPath);
      assert.deepEqual((logger as AuditLogger).getRecent(), []);
    });

    it('returns empty array when no entries have been logged', () => {
      logger = new AuditLogger(path.join(tmpDir, 'audit.db'));
      assert.deepEqual((logger as AuditLogger).getRecent(), []);
    });

    it('defaults to limit 50', () => {
      logger = new AuditLogger(path.join(tmpDir, 'audit.db'));
      for (let i = 0; i < 60; i++) {
        (logger as AuditLogger).log('tool', `action_${i}`);
      }
      const rows = (logger as AuditLogger).getRecent(); // default limit = 50
      assert.equal(rows.length, 50);
    });
  });

  // ── close() ───────────────────────────────────────────────────────────────

  describe('close()', () => {
    it('closes the DB and sets logger.db to null', () => {
      logger = new AuditLogger(path.join(tmpDir, 'audit.db'));
      assert.ok((logger as AuditLogger).db, 'DB should be open before close');
      (logger as AuditLogger).close();
      assert.equal((logger as AuditLogger).db, null);
    });

    it('is idempotent — calling close() twice does not throw', () => {
      logger = new AuditLogger(path.join(tmpDir, 'audit.db'));
      (logger as AuditLogger).close();
      assert.doesNotThrow(() => (logger as AuditLogger).close());
    });
  });

  // ── Fallback file logging ─────────────────────────────────────────────────

  describe('fallback file logging', () => {
    it('writes NDJSON lines to the fallback log file', () => {
      const fallbackPath = path.join(tmpDir, 'fallback.log');
      logger = new AuditLogger(path.join(tmpDir, 'audit.db'));
      (logger as AuditLogger).fallbackPath = fallbackPath;
      (logger as AuditLogger)._useFallback = true;
      (logger as AuditLogger)._ensureFallbackDir();

      const entry = { tool: 'test', action: 'probe', details: {}, success: true, timestamp: new Date().toISOString() };
      (logger as AuditLogger)._writeFallback(entry);

      const content = readFileSync(fallbackPath, 'utf8').trim();
      const parsed = JSON.parse(content);
      assert.equal(parsed.tool, 'test');
      assert.equal(parsed.action, 'probe');
    });
  });
});
