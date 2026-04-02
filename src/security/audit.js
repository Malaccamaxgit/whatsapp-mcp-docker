/**
 * Audit Logger
 *
 * Logs all MCP tool invocations to SQLite for compliance and debugging.
 * Reads DB path from AUDIT_DB_PATH env var.
 * Falls back to file-based logging if database is unavailable.
 */

import Database from 'better-sqlite3';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_DB_PATH = '/data/audit/audit.db';
const DEFAULT_FALLBACK_PATH = '/data/audit/audit-fallback.log';

export class AuditLogger {
  constructor(dbPath, options = {}) {
    this.dbPath = dbPath || process.env.AUDIT_DB_PATH || DEFAULT_DB_PATH;
    this.fallbackPath = process.env.AUDIT_FALLBACK_PATH || DEFAULT_FALLBACK_PATH;
    this.db = null;
    this._onAlert = options.onAlert || null; // Callback for audit failure alerts
    this._alertSent = false; // Track if alert already sent to avoid spam
    this._useFallback = false; // Track if using file fallback
    this._init();
  }

  _init() {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT DEFAULT (datetime('now')),
          tool TEXT NOT NULL,
          action TEXT NOT NULL,
          details TEXT,
          success INTEGER DEFAULT 1
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp
        ON audit_logs(timestamp DESC)
      `);

      this._insertStmt = this.db.prepare(`
        INSERT INTO audit_logs (tool, action, details, success)
        VALUES (?, ?, ?, ?)
      `);

      console.error('[AUDIT] Database initialized at', this.dbPath);
    } catch (error) {
      console.error('[AUDIT] Failed to initialize database:', error.message);
      console.error('[AUDIT] ⚠️ COMPLIANCE ALERT: Audit logging falling back to file-based logging');
      this._sendAlert('audit_db_init_failed', error.message);
      this.db = null;
      this._useFallback = true;
      this._ensureFallbackDir();
      // Attempt to write initial failure entry to fallback log
      this._writeFallback({
        tool: '_system',
        action: 'init_failed',
        details: { error: error.message, timestamp: new Date().toISOString() },
        success: false,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Ensure fallback log directory exists
   */
  _ensureFallbackDir() {
    try {
      const dir = dirname(this.fallbackPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    } catch (error) {
      console.error('[AUDIT] Failed to create fallback directory:', error.message);
    }
  }

  /**
   * Write entry to fallback log file
   */
  _writeFallback(entry) {
    try {
      const logLine = JSON.stringify(entry) + '\n';
      appendFileSync(this.fallbackPath, logLine, 'utf8');
      console.error('[AUDIT] Fallback log entry written to', this.fallbackPath);
    } catch (error) {
      console.error('[AUDIT] Fallback file write failed:', error.message);
      // Last resort - already logged to stderr in log()
      // Re-throw to allow caller to handle critical failure
      throw error;
    }
  }

  /**
   * Set callback for audit failure alerts (called when audit DB fails)
   * @param {Function} callback - Function to call with alert object
   */
  setAlertCallback(callback) {
    this._onAlert = callback;
    // If we already sent an alert during init, trigger it now
    if (this._alertSent && !this._alertCallbackTriggered) {
      this._alertCallbackTriggered = true;
      callback({
        type: 'audit_failure',
        reason: 'audit_db_init_failed',
        error: 'Audit database unavailable - initialized before alert callback set',
        timestamp: new Date().toISOString()
      });
    }
  }

  log(tool, action, details = {}, success = true) {
    const entry = { tool, action, details, success, timestamp: new Date().toISOString() };
    console.error(`[AUDIT] ${tool}:${action}`, success ? 'OK' : 'FAIL');

    if (this.db && this._insertStmt) {
      try {
        this._insertStmt.run(tool, action, JSON.stringify(details), success ? 1 : 0);
      } catch (error) {
        console.error('[AUDIT] Database write failed:', error.message);
        console.error('[AUDIT] ⚠️ COMPLIANCE ALERT: Falling back to file-based logging');
        this._useFallback = true; // Switch to fallback on write failure
        this._sendAlert('audit_db_write_failed', error.message);
        // Attempt to write to fallback
        try {
          this._writeFallback(entry);
        } catch (fallbackError) {
          console.error('[AUDIT] CRITICAL: Both database and fallback logging failed');
          console.error('[AUDIT] Database error:', error.message);
          console.error('[AUDIT] Fallback error:', fallbackError.message);
        }
      }
    } else if (this._useFallback) {
      // Database was never initialized or switched to fallback - use fallback file
      try {
        this._writeFallback(entry);
      } catch (fallbackError) {
        console.error('[AUDIT] Fallback logging failed:', fallbackError.message);
        console.error('[AUDIT] AUDIT TRAIL GAP: Entry could not be logged');
      }
    } else if (!this.db) {
      console.error('[AUDIT] Database unavailable - logging to stderr only');
    }

    return entry;
  }

  getRecent(limit = 50) {
    if (!this.db) return [];
    try {
      return this.db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?').all(limit);
    } catch {
      return [];
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
