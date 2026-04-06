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
export function getUserTimezone (): string {
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
export function formatTimestamp (timestampSeconds: number): string {
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
export function formatTimeOnly (timestampSeconds: number): string {
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
export function formatTimestampISO (timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString();
}

/**
 * Relative time since a Unix timestamp (seconds), e.g. "45s ago", "3 min ago", "2h ago".
 */
export function formatTimeAgo (
  timestampSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const diff = nowSeconds - timestampSeconds;
  if (diff < 0) {
    return 'in the future';
  }
  if (diff < 60) {
    return `${diff}s ago`;
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)} min ago`;
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h ago`;
  }
  if (diff < 604800) {
    const d = Math.floor(diff / 86400);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  return formatTimestamp(timestampSeconds);
}

/**
 * Start of the calendar day (00:00:00 wall clock) for `date` in the user's timezone.
 * Used for `since: "today"` in catch_up so the window matches local midnight, not UTC.
 */
export function getStartOfCalendarDayInTimezoneSeconds (
  date: Date = new Date(),
  timeZone: string = getUserTimezone()
): number {
  let t = date.getTime();
  const targetYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = Number(targetYmd.find((p) => p.type === 'year')!.value);
  const m = Number(targetYmd.find((p) => p.type === 'month')!.value);
  const d = Number(targetYmd.find((p) => p.type === 'day')!.value);
  for (let i = 0; i < 48; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour: '2-digit',
      hour12: false,
      minute: '2-digit',
      second: '2-digit',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(t));
    const cy = Number(parts.find((p) => p.type === 'year')!.value);
    const cm = Number(parts.find((p) => p.type === 'month')!.value);
    const cd = Number(parts.find((p) => p.type === 'day')!.value);
    const hh = Number(parts.find((p) => p.type === 'hour')!.value);
    const mm = Number(parts.find((p) => p.type === 'minute')!.value);
    const ss = Number(parts.find((p) => p.type === 'second')!.value);
    if (cy === y && cm === m && cd === d && hh === 0 && mm === 0 && ss === 0) {
      return Math.floor(t / 1000);
    }
    t -= ((hh * 60 + mm) * 60 + ss) * 1000;
  }
  return Math.floor(date.getTime() / 1000);
}

/**
 * "today", "yesterday", or the calendar date (YYYY-MM-DD) in the user's timezone.
 */
export function formatCalendarDayHint (
  timestampSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  timeZone: string = getUserTimezone()
): string {
  const ts = new Date(timestampSeconds * 1000);
  const now = new Date(nowSeconds * 1000);
  const tsParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(ts);
  const nParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const tsKey = `${tsParts.find((p) => p.type === 'year')!.value}-${tsParts.find((p) => p.type === 'month')!.value}-${tsParts.find((p) => p.type === 'day')!.value}`;
  const nKey = `${nParts.find((p) => p.type === 'year')!.value}-${nParts.find((p) => p.type === 'month')!.value}-${nParts.find((p) => p.type === 'day')!.value}`;
  if (tsKey === nKey) {
    return 'today';
  }
  const startToday = getStartOfCalendarDayInTimezoneSeconds(now, timeZone);
  const justBeforeToday = new Date((startToday - 1) * 1000);
  const yParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(justBeforeToday);
  const yKey = `${yParts.find((p) => p.type === 'year')!.value}-${yParts.find((p) => p.type === 'month')!.value}-${yParts.find((p) => p.type === 'day')!.value}`;
  if (tsKey === yKey) {
    return 'yesterday';
  }
  return tsKey;
}

/**
 * Absolute time + calendar hint + relative age (for catch_up message lines).
 */
export function formatMessageLineTimeContext (
  timestampSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  return `${formatTimestamp(timestampSeconds)} · ${formatCalendarDayHint(timestampSeconds, nowSeconds)} · ${formatTimeAgo(timestampSeconds, nowSeconds)}`;
}

/**
 * Human-readable description of the catch_up time window (timezone-aware).
 */
export function describeCatchUpWindow (
  since: '1h' | '4h' | 'today' | '24h' | 'this_week',
  sinceTs: number,
  nowSeconds: number
): string {
  const tz = getUserTimezone();
  const startFormatted = formatTimestamp(sinceTs);
  const nowFormatted = formatTimestamp(nowSeconds);
  switch (since) {
    case '1h':
      return `Window: last 1 hour (from ${startFormatted} to ${nowFormatted}, ${tz})`;
    case '4h':
      return `Window: last 4 hours (from ${startFormatted} to ${nowFormatted}, ${tz})`;
    case 'today':
      return `Window: since midnight today in ${tz} (${startFormatted} — ${nowFormatted})`;
    case '24h':
      return `Window: rolling last 24 hours (from ${startFormatted} to ${nowFormatted}, ${tz})`;
    case 'this_week':
      return `Window: last 7 days (from ${startFormatted} to ${nowFormatted}, ${tz})`;
    default:
      return `Window: from ${startFormatted} to ${nowFormatted} (${tz})`;
  }
}
