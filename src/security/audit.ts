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

type AuditEntry = {
  id?: number;
  timestamp: string;
  tool: string;
  action: string;
  details: unknown;
  success: boolean;
};

type AuditAlert = {
  type: 'audit_failure';
  reason: string;
  error: string;
  timestamp: string;
};

type AuditLoggerOptions = {
  onAlert?: (alert: AuditAlert) => void;
};

export class AuditLogger {
  private dbPath: string;
  private fallbackPath: string;
  private db: Database.Database | null;
  private _onAlert: ((alert: AuditAlert) => void) | null;
  private _alertSent: boolean;
  private _pendingAlert: AuditAlert | null;
  private _useFallback: boolean;
  private _insertStmt: Database.Statement | null;
  private _alertCallbackTriggered: boolean;

  constructor(dbPath?: string, options: AuditLoggerOptions = {}) {
    this.dbPath = dbPath || process.env.AUDIT_DB_PATH || DEFAULT_DB_PATH;
    this.fallbackPath = process.env.AUDIT_FALLBACK_PATH || DEFAULT_FALLBACK_PATH;
    this.db = null;
    this._onAlert = options.onAlert || null;
    this._alertSent = false;
    this._pendingAlert = null;
    this._useFallback = false;
    this._insertStmt = null;
    this._alertCallbackTriggered = false;
    this._init();
  }

  private _init(): void {
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
      console.error('[AUDIT] Failed to initialize database:', (error as Error).message);
      console.error('[AUDIT] ⚠️ COMPLIANCE ALERT: Audit logging falling back to file-based logging');
      this._sendAlert('audit_db_init_failed', (error as Error).message);
      this.db = null;
      this._useFallback = true;
      this._ensureFallbackDir();
      // Attempt to write initial failure entry to fallback log
      this._writeFallback({
        tool: '_system',
        action: 'init_failed',
        details: { error: (error as Error).message, timestamp: new Date().toISOString() },
        success: false,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Ensure fallback log directory exists
   */
  private _ensureFallbackDir(): void {
    try {
      const dir = dirname(this.fallbackPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    } catch (error) {
      console.error('[AUDIT] Failed to create fallback directory:', (error as Error).message);
    }
  }

  /**
   * Write entry to fallback log file
   */
  private _writeFallback(entry: AuditEntry): void {
    try {
      const logLine = JSON.stringify(entry) + '\n';
      appendFileSync(this.fallbackPath, logLine, 'utf8');
      console.error('[AUDIT] Fallback log entry written to', this.fallbackPath);
    } catch (error) {
      console.error('[AUDIT] Fallback file write failed:', (error as Error).message);
      // Last resort - already logged to stderr in log()
      // Re-throw to allow caller to handle critical failure
      throw error;
    }
  }

  /**
   * Send an alert for audit failures. Sets _alertSent so the callback can be
   * replayed via setAlertCallback if it is registered after _init() runs.
   */
  private _sendAlert(type: string, errorMessage: string): void {
    this._alertSent = true;
    this._pendingAlert = { type: 'audit_failure', reason: type, error: errorMessage, timestamp: new Date().toISOString() };
    if (this._onAlert && !this._alertCallbackTriggered) {
      this._alertCallbackTriggered = true;
      this._onAlert(this._pendingAlert);
    }
  }

  /**
   * Set callback for audit failure alerts (called when audit DB fails)
   * @param callback - Function to call with alert object
   */
  setAlertCallback(callback: (alert: AuditAlert) => void): void {
    this._onAlert = callback;
    // If an alert was already sent during init (before this callback was set), replay it now
    if (this._alertSent && !this._alertCallbackTriggered) {
      this._alertCallbackTriggered = true;
      callback(this._pendingAlert || {
        type: 'audit_failure',
        reason: 'audit_db_init_failed',
        error: 'Audit database unavailable - initialized before alert callback set',
        timestamp: new Date().toISOString()
      });
    }
  }

  log(tool: string, action: string, details: Record<string, unknown> = {}, success: boolean = true): AuditEntry {
    const entry: AuditEntry = { tool, action, details, success, timestamp: new Date().toISOString() };
    console.error(`[AUDIT] ${tool}:${action}`, success ? 'OK' : 'FAIL');

    if (this.db && this._insertStmt) {
      try {
        this._insertStmt.run(tool, action, JSON.stringify(details), success ? 1 : 0);
      } catch (error) {
        console.error('[AUDIT] Database write failed:', (error as Error).message);
        console.error('[AUDIT] ⚠️ COMPLIANCE ALERT: Falling back to file-based logging');
        this._useFallback = true; // Switch to fallback on write failure
        this._sendAlert('audit_db_write_failed', (error as Error).message);
        // Attempt to write to fallback
        try {
          this._writeFallback(entry);
        } catch (fallbackError) {
          console.error('[AUDIT] CRITICAL: Both database and fallback logging failed');
          console.error('[AUDIT] Database error:', (error as Error).message);
          console.error('[AUDIT] Fallback error:', (fallbackError as Error).message);
        }
      }
    } else if (this._useFallback) {
      // Database was never initialized or switched to fallback - use fallback file
      try {
        this._writeFallback(entry);
      } catch (fallbackError) {
        console.error('[AUDIT] Fallback logging failed:', (fallbackError as Error).message);
        console.error('[AUDIT] AUDIT TRAIL GAP: Entry could not be logged');
      }
    } else if (!this.db) {
      console.error('[AUDIT] Database unavailable - logging to stderr only');
    }

    return entry;
  }

  getRecent(limit: number = 50): AuditEntry[] {
    if (!this.db) return [];
    try {
      return this.db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as AuditEntry[];
    } catch {
      return [];
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
