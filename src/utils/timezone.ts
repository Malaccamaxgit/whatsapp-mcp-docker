/**
 * Timezone and Time Formatting Utilities
 *
 * Provides timezone-aware timestamp formatting for the MCP server.
 * Reads timezone from process.env.TZ (set by Docker MCP profile config).
 *
 * All times are displayed in 24-hour format (HH:mm:ss), NOT 12-hour AM/PM.
 */

/**
 * Get the configured timezone from environment.
 * Falls back to America/Toronto (default in whatsapp-mcp-docker-server.yaml).
 * @returns IANA timezone string
 */
export function getUserTimezone(): string {
  return process.env.TZ || 'America/Toronto';
}

/**
 * Format a Unix timestamp (seconds) to a localized date-time string.
 * Uses 24-hour format (no AM/PM).
 *
 * Example output: "2026-04-04, 17:46:02"
 *
 * @param timestampSeconds - Unix timestamp in seconds
 * @returns Formatted date-time string in user's timezone
 */
export function formatTimestamp(timestampSeconds: number): string {
  const tz = getUserTimezone();
  return new Date(timestampSeconds * 1000).toLocaleString('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false // Force 24-hour format
  });
}

/**
 * Format a Unix timestamp to time-only string (HH:mm:ss).
 * Uses 24-hour format (no AM/PM).
 *
 * Example output: "17:46:02"
 *
 * @param timestampSeconds - Unix timestamp in seconds
 * @returns Formatted time string in user's timezone
 */
export function formatTimeOnly(timestampSeconds: number): string {
  const tz = getUserTimezone();
  return new Date(timestampSeconds * 1000).toLocaleString('en-CA', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * Format a Unix timestamp to ISO 8601 format with timezone offset.
 * Useful for exports (CSV, JSON).
 *
 * Example output: "2026-04-04T17:46:02-04:00"
 *
 * @param timestampSeconds - Unix timestamp in seconds
 * @returns ISO 8601 formatted string with timezone offset
 */
export function formatTimestampISO(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString();
}
