/**
 * Application Constants
 *
 * Centralized configuration constants for the WhatsApp MCP Server.
 * All magic numbers and hardcoded values should be defined here.
 */

// ── Rate Limiting ─────────────────────────────────────────────
export const RATE_LIMITS = {
  // Outbound messages per minute. 60 (1/sec sustained) is comfortable for an
  // AI assistant; lower it via RATE_LIMIT_PER_MIN env if you want tighter control.
  MESSAGES_PER_MIN: 60,
  // Media downloads per minute; override via DOWNLOAD_RATE_LIMIT_PER_MIN env.
  DOWNLOADS_PER_MIN: 30,
  // Authentication attempts per window
  AUTH_ATTEMPTS_PER_WINDOW: 5,
  // Authentication rate limit window (30 minutes)
  AUTH_WINDOW_MS: 30 * 60 * 1000,
  // Initial auth backoff (60 seconds)
  AUTH_INITIAL_BACKOFF_MS: 60 * 1000,
  // Maximum auth backoff (15 minutes)
  AUTH_MAX_BACKOFF_MS: 15 * 60 * 1000,
} as const;

// ── Connection & Health ───────────────────────────────────────
export const CONNECTION = {
  // Health check interval (60 seconds)
  HEALTH_CHECK_INTERVAL_MS: 60 * 1000,
  // Health check timeout (10 seconds)
  HEALTH_CHECK_TIMEOUT_MS: 10 * 1000,
  // Reconnect delay after transient disconnect (5 seconds)
  RECONNECT_DELAY_MS: 5 * 1000,
  // Maximum startup retry attempts
  STARTUP_MAX_RETRIES: 5,
  // Exponential backoff base (2 seconds)
  STARTUP_BACKOFF_BASE_MS: 2 * 1000,
  // Maximum startup backoff (30 seconds)
  STARTUP_MAX_BACKOFF_MS: 30 * 1000,
  // Session expiry detection threshold (20 days of inactivity)
  SESSION_EXPIRY_THRESHOLD_MS: 20 * 24 * 60 * 60 * 1000,
} as const;

// ── Input Validation Limits ───────────────────────────────────
export const LIMITS = {
  // Maximum message body length
  MAX_MESSAGE_LENGTH: 4096,
  // Maximum caption length for media
  MAX_CAPTION_LENGTH: 1024,
  // Maximum search query length
  MAX_SEARCH_QUERY_LENGTH: 500,
  // Maximum approval action length
  MAX_APPROVAL_ACTION_LENGTH: 500,
  // Maximum approval details length
  MAX_APPROVAL_DETAILS_LENGTH: 2000,
  // Maximum filter/search text length
  MAX_FILTER_LENGTH: 200,
  // Maximum message IDs to mark as read in one call
  MAX_MARK_READ_IDS: 500,
  // Maximum file size for uploads (64 MB)
  MAX_FILE_SIZE_BYTES: 64 * 1024 * 1024,
  // Total media storage quota (512 MB)
  MEDIA_QUOTA_BYTES: 512 * 1024 * 1024,
  // Maximum sanitized filename length
  MAX_FILENAME_LENGTH: 200,
  // Maximum context messages to include
  MAX_CONTEXT_MESSAGES: 10,
  // Maximum search results per page
  MAX_SEARCH_RESULTS: 100,
  // Maximum chats to list
  MAX_CHATS_LIMIT: 100,
  // Maximum messages to list per page
  MAX_MESSAGES_LIMIT: 200,
} as const;

// ── Authentication ────────────────────────────────────────────
export const AUTH = {
  // Pairing code expiry (60 seconds)
  PAIRING_CODE_EXPIRY_SEC: 60,
  // QR code expiry (~20 seconds)
  QR_CODE_EXPIRY_SEC: 20,
  // Default poll interval for auth wait (5 seconds)
  DEFAULT_POLL_INTERVAL_SEC: 5,
  // Default link timeout (120 seconds)
  DEFAULT_LINK_TIMEOUT_SEC: 120,
  // Minimum poll interval (2 seconds)
  MIN_POLL_INTERVAL_SEC: 2,
  // Maximum poll interval (60 seconds)
  MAX_POLL_INTERVAL_SEC: 60,
  // Minimum link timeout (15 seconds)
  MIN_LINK_TIMEOUT_SEC: 15,
  // Maximum link timeout (600 seconds)
  MAX_LINK_TIMEOUT_SEC: 600,
} as const;

// ── Storage & Retention ───────────────────────────────────────
export const STORAGE = {
  // Default message retention (90 days)
  DEFAULT_RETENTION_DAYS: 90,
  // Auto-purge check interval (1 hour)
  PURGE_CHECK_INTERVAL_MS: 60 * 60 * 1000,
  // Media expiry on WhatsApp servers (30 days)
  MEDIA_SERVER_EXPIRY_DAYS: 30,
} as const;

// ── Permanent Logout Reasons ──────────────────────────────────
export const PERMANENT_LOGOUT_REASONS = [
  'revoked',
  'replaced',
  'banned',
  'unlinked',
  'device_removed',
  'logged_out',
  'multidevice_mismatch',
] as const;

export type PermanentLogoutReason = (typeof PERMANENT_LOGOUT_REASONS)[number];

// ── Approval Keywords ─────────────────────────────────────────
export const APPROVAL_KEYWORDS = {
  APPROVE: ['approve', 'approved', 'yes', 'ok', 'okay', 'confirm', 'y', '✅', '✔️'] as const,
  DENY: ['deny', 'denied', 'no', 'reject', 'cancel', 'n', '❌', '🚫'] as const,
} as const;

export type ApprovalKeyword = (typeof APPROVAL_KEYWORDS.APPROVE)[number] | (typeof APPROVAL_KEYWORDS.DENY)[number];

// ── File Security ─────────────────────────────────────────────
export const FILE_SECURITY = {
  // Dangerous file extensions (blocklist)
  DANGEROUS_EXTENSIONS: new Set([
    '.exe',
    '.bat',
    '.cmd',
    '.com',
    '.scr',
    '.pif',
    '.msi',
    '.msp',
    '.ps1',
    '.psm1',
    '.psd1',
    '.vbs',
    '.vbe',
    '.wsf',
    '.wsh',
    '.sh',
    '.bash',
    '.csh',
    '.ksh',
    '.dll',
    '.sys',
    '.drv',
    '.ocx',
    '.cab',
    '.inf',
    '.reg',
    '.lnk',
    '.url',
    '.hta',
    '.cpl',
  ]),
  // Sensitive file patterns (block upload/exfiltration)
  SENSITIVE_PATTERNS: [
    /session\.db/i,
    /messages\.db/i,
    /audit\.db/i,
    /\.db-wal$/i,
    /\.db-shm$/i,
    /\.key$/i,
    /\.pem$/i,
    /\.env$/i,
    /credentials/i,
  ] as const,
} as const;

// ── Error Codes ───────────────────────────────────────────────
export const ERROR_CODES = {
  // Authentication (400-403)
  AUTH_RATE_LIMITED: 429,
  AUTH_PAIRING_FAILED: 400,
  AUTH_QR_EXPIRED: 408,
  AUTH_SESSION_EXPIRED: 401,
  AUTH_DEVICE_REMOVED: 410,
  AUTH_BANNED: 403,
  AUTH_MULTIDEVICE_MISMATCH: 409,

  // Connection (500-504)
  CONNECTION_LOST: 503,
  CONNECTION_TIMEOUT: 504,
  CONNECTION_DNS_FAILED: 502,
  CONNECTION_TLS_FAILED: 500,
  HEALTH_CHECK_FAILED: 503,

  // Messaging (400-500)
  MESSAGE_RATE_LIMITED: 429,
  MESSAGE_TOO_LONG: 413,
  MESSAGE_RECIPIENT_NOT_FOUND: 404,
  MESSAGE_AMBIGUOUS_RECIPIENT: 409,
  MESSAGE_CONTACT_BLOCKED: 403,
  MESSAGE_SEND_FAILED: 500,
  MESSAGE_NOT_CONNECTED: 400,

  // Media (400-500)
  MEDIA_RATE_LIMITED: 429,
  MEDIA_FILE_NOT_FOUND: 404,
  MEDIA_PATH_TRAVERSAL: 403,
  MEDIA_DANGEROUS_EXTENSION: 403,
  MEDIA_MAGIC_MISMATCH: 400,
  MEDIA_QUOTA_EXCEEDED: 413,
  MEDIA_UPLOAD_FAILED: 500,
  MEDIA_DOWNLOAD_FAILED: 500,
  MEDIA_TOO_LARGE: 413,

  // Search (204-503)
  SEARCH_QUERY_TOO_LONG: 413,
  SEARCH_NO_RESULTS: 204,
  SEARCH_FTS_UNAVAILABLE: 503,

  // Approval (400-409)
  APPROVAL_TIMEOUT: 408,
  APPROVAL_RECIPIENT_NOT_FOUND: 404,
  APPROVAL_ALREADY_RESPONDED: 409,
  APPROVAL_INVALID_TIMEOUT: 400,

  // Database (500-507)
  DB_LOCKED: 503,
  DB_CORRUPT: 500,
  DB_DISK_FULL: 507,
  DB_MIGRATION_FAILED: 500,

  // Permission (403-429)
  PERMISSION_TOOL_DISABLED: 403,
  PERMISSION_CONTACT_NOT_WHITELISTED: 403,
  PERMISSION_AUTH_THROTTLED: 429,
} as const;

// ── Defaults ──────────────────────────────────────────────────
export const DEFAULTS = {
  // Default welcome group name
  WELCOME_GROUP_NAME: 'WhatsAppMCP',
  // Default presence mode
  PRESENCE_MODE: 'available',
  // Default store path
  STORE_PATH: '/data/sessions',
  // Default audit path
  AUDIT_DB_PATH: '/data/audit/audit.db',
} as const;

export default {
  RATE_LIMITS,
  CONNECTION,
  LIMITS,
  AUTH,
  STORAGE,
  PERMANENT_LOGOUT_REASONS,
  APPROVAL_KEYWORDS,
  FILE_SECURITY,
  ERROR_CODES,
  DEFAULTS,
};
