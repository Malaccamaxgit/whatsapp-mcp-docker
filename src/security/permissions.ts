/**
 * Permission Manager
 *
 * Contact whitelist, rate limiting, tool disabling, and input limits.
 * Configured via environment variables:
 *   ALLOWED_CONTACTS   - comma-separated phone numbers (empty = allow all)
 *   RATE_LIMIT_PER_MIN - max outbound messages per minute (default: RATE_LIMITS.MESSAGES_PER_MIN)
 *   DISABLED_TOOLS     - comma-separated tool names to disable
 */

import { LIMITS, RATE_LIMITS } from '../constants.js';

const STORE_PATH = process.env.STORE_PATH || '/data/store';

// Add UPLOAD_ALLOWED_DIRS to LIMITS (runtime-dependent, not in the as-const type)
(LIMITS as Record<string, unknown>).UPLOAD_ALLOWED_DIRS = [`${STORE_PATH}/media`, '/tmp'];

// Re-export LIMITS for use by tools
export { LIMITS };

interface IsToolEnabledResult {
  allowed: boolean;
  error: string | null;
}

interface CanSendToResult {
  allowed: boolean;
  error: string | null;
}

interface CanReadFromResult {
  allowed: boolean;
  error: string | null;
}

interface CheckRateLimitResult {
  allowed: boolean;
  error: string | null;
  retryAfterSec: number;
}

interface CheckAuthRateLimitResult {
  allowed: boolean;
  error: string | null;
  retryAfterSec: number;
}

export class PermissionManager {
  private allowedContacts: string[];
  private rateLimit: number;
  private downloadRateLimit: number;
  private disabledTools: Set<string>;
  private _sendTimestamps: number[];
  private _downloadTimestamps: number[];
  private _authAttempts: number[];
  private _authBackoffSec: number;
  private _lastAuthAttempt: number;

  constructor () {
    const contactsEnv = process.env.ALLOWED_CONTACTS || '';
    this.allowedContacts = contactsEnv
      ? contactsEnv
        .split(',')
        .map((n) => n.replace(/[^0-9]/g, '').trim())
        .filter(Boolean)
      : [];

    this.rateLimit = parseInt(process.env.RATE_LIMIT_PER_MIN || String(RATE_LIMITS.MESSAGES_PER_MIN), 10);
    this.downloadRateLimit = parseInt(process.env.DOWNLOAD_RATE_LIMIT_PER_MIN || String(RATE_LIMITS.DOWNLOADS_PER_MIN), 10);

    const disabledEnv = process.env.DISABLED_TOOLS || '';
    this.disabledTools = new Set(
      disabledEnv
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    );

    this._sendTimestamps = [];
    this._downloadTimestamps = [];

    this._authAttempts = [];
    this._authBackoffSec = 0;
    this._lastAuthAttempt = 0;
  }

  /**
   * Check if a tool is enabled. Returns { allowed, error }.
   */
  isToolEnabled (toolName: string): IsToolEnabledResult {
    if (this.disabledTools.has(toolName)) {
      return {
        allowed: false,
        error: `Tool "${toolName}" is disabled by server configuration.`
      };
    }
    return { allowed: true, error: null };
  }

  /**
   * Check if a phone number / JID is allowed for outbound messages.
   * Returns { allowed, error }.
   */
  canSendTo (numberOrJid: string): CanSendToResult {
    return this.checkAllowedContact(numberOrJid, 'send');
  }

  /**
   * Check if a phone number / JID is allowed for read/export/download operations.
   * Uses the same whitelist as outbound messaging.
   */
  canReadFrom (numberOrJid: string): CanReadFromResult {
    return this.checkAllowedContact(numberOrJid, 'read');
  }

  private checkAllowedContact (numberOrJid: string, operation: 'send' | 'read'): CanSendToResult | CanReadFromResult {
    if (this.allowedContacts.length === 0) {
      return { allowed: true, error: null };
    }

    const digits = numberOrJid.replace(/[^0-9]/g, '');
    const match = this.allowedContacts.some(
      (allowed) => digits === allowed || digits.endsWith(allowed)
    );

    if (!match) {
      const opLabel = operation === 'send' ? 'send messages to' : 'access data for';
      return {
        allowed: false,
        error:
          `Cannot ${opLabel} ${numberOrJid}: not in the allowed contacts list. ` +
          `Allowed: ${this.allowedContacts.map((n) => '+' + n).join(', ')}`
      };
    }

    return { allowed: true, error: null };
  }

  /**
   * Check and record an outbound message for rate limiting.
   * Returns { allowed, error, retryAfterSec }.
   */
  checkRateLimit (): CheckRateLimitResult {
    const now = Date.now();
    const windowStart = now - 60_000;

    this._sendTimestamps = this._sendTimestamps.filter((ts) => ts > windowStart);

    if (this._sendTimestamps.length >= this.rateLimit) {
      const oldestInWindow = this._sendTimestamps[0];
      const retryAfterSec = Math.ceil((oldestInWindow + 60_000 - now) / 1000);
      return {
        allowed: false,
        error: `Rate limit exceeded (${this.rateLimit} messages/min). Try again in ${retryAfterSec}s.`,
        retryAfterSec
      };
    }

    this._sendTimestamps.push(now);
    return { allowed: true, error: null, retryAfterSec: 0 };
  }

  /**
   * Check and record a media download for rate limiting.
   * Returns { allowed, error }.
   */
  checkDownloadRateLimit (): CheckRateLimitResult {
    const now = Date.now();
    const windowStart = now - 60_000;

    this._downloadTimestamps = this._downloadTimestamps.filter((ts) => ts > windowStart);

    if (this._downloadTimestamps.length >= this.downloadRateLimit) {
      const oldestInWindow = this._downloadTimestamps[0];
      const retryAfterSec = Math.ceil((oldestInWindow + 60_000 - now) / 1000);
      return {
        allowed: false,
        error: `Download rate limit exceeded (${this.downloadRateLimit}/min). Try again in ${retryAfterSec}s.`,
        retryAfterSec
      };
    }

    this._downloadTimestamps.push(now);
    return { allowed: true, error: null, retryAfterSec: 0 };
  }

  /**
   * Check if an authentication attempt is allowed.
   * Enforces: max 5 attempts per 30 min, exponential backoff after failures.
   * Returns { allowed, error, retryAfterSec }.
   */
  checkAuthRateLimit (): CheckAuthRateLimitResult {
    const now = Date.now();
    const windowMs = 30 * 60_000;

    this._authAttempts = this._authAttempts.filter((ts) => ts > now - windowMs);

    if (this._authAttempts.length >= 5) {
      const oldestInWindow = this._authAttempts[0];
      const retryAfterSec = Math.ceil((oldestInWindow + windowMs - now) / 1000);
      return {
        allowed: false,
        retryAfterSec,
        error:
          'Too many authentication attempts (5 per 30 min). ' +
          `Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`
      };
    }

    if (this._authBackoffSec > 0 && this._lastAuthAttempt > 0) {
      const cooldownEnds = this._lastAuthAttempt + this._authBackoffSec * 1000;
      if (now < cooldownEnds) {
        const retryAfterSec = Math.ceil((cooldownEnds - now) / 1000);
        return {
          allowed: false,
          retryAfterSec,
          error:
            'Authentication cooldown active. ' +
            `Wait ${retryAfterSec} second(s) before retrying. ` +
            '(Backoff increases after each failed attempt to avoid WhatsApp rate limits.)'
        };
      }
    }

    return { allowed: true, error: null, retryAfterSec: 0 };
  }

  /**
   * Record an authentication attempt outcome.
   * On failure: doubles the backoff (60s → 120s → 240s → 480s, capped at 15 min).
   * On success: resets backoff entirely.
   */
  recordAuthAttempt (success: boolean): void {
    const now = Date.now();
    this._authAttempts.push(now);
    this._lastAuthAttempt = now;

    if (success) {
      this._authBackoffSec = 0;
    } else {
      this._authBackoffSec =
        this._authBackoffSec === 0 ? 60 : Math.min(this._authBackoffSec * 2, 900);
    }
  }

  /**
   * Reset auth backoff (called when connection succeeds via event).
   */
  resetAuthBackoff (): void {
    this._authBackoffSec = 0;
  }

  /**
   * Get current auth backoff seconds (for display in error messages).
   */
  get authBackoffSec (): number {
    return this._authBackoffSec;
  }

  get hasContactRestrictions (): boolean {
    return this.allowedContacts.length > 0;
  }
}
