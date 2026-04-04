/**
 * Fuzzy Name Matching
 *
 * Levenshtein distance + case-insensitive substring matching for
 * contact and group name resolution. When a user says "John" or
 * "book club", this finds the best matching chat without requiring
 * exact names or JIDs.
 */

export interface Chat {
  jid: string;
  name: string | null;
}

interface MatchResult {
  jid: string;
  name: string;
  score: number;
}

interface FuzzyMatchOptions {
  maxResults?: number;
}

/**
 * Compute Levenshtein edit distance between two strings.
 * @param a - First string
 * @param b - Second string
 * @returns The edit distance
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[m][n];
}

/**
 * Score a candidate name against a query. Lower score = better match.
 * Returns null if no reasonable match.
 *
 * Scoring:
 *   - Exact match (case-insensitive): 0
 *   - Starts with query: 1
 *   - Contains query as substring: 2
 *   - Levenshtein distance <= threshold: 3 + distance
 *   - No match: null
 * @param query - The search query
 * @param candidate - The candidate name to score
 * @returns A numeric score or null if no match
 */
function scoreMatch(query: string, candidate: string): number | null {
  const q = query.toLowerCase().trim();
  const c = candidate.toLowerCase().trim();

  if (c === q) return 0;
  if (c.startsWith(q)) return 1;
  if (c.includes(q)) return 2;

  // Levenshtein and word matching only make sense for queries of 2+ characters.
  // Single-char queries should only match via prefix/substring to avoid false
  // positives (e.g. CJK characters matching Latin letters by edit distance).
  if (q.length < 2) return null;

  const maxDistance = Math.max(2, Math.floor(q.length * 0.4));
  const dist = levenshtein(q, c);
  if (dist <= maxDistance) return 3 + dist;

  const words = c.split(/[\s\-_]+/);
  for (const word of words) {
    const wordDist = levenshtein(q, word);
    if (wordDist <= Math.max(1, Math.floor(q.length * 0.3))) {
      return 4 + wordDist;
    }
  }

  return null;
}

/**
 * Find the best matching chats for a query string.
 * @param query - The user's search text (name, number, or partial)
 * @param chats - Available chats with JID and display name
 * @param options - Options including maxResults
 * @returns Matches sorted by score (best first)
 */
export function fuzzyMatch(
  query: string,
  chats: Chat[],
  { maxResults = 5 }: FuzzyMatchOptions = {}
): MatchResult[] {
  if (!query || !chats?.length) return [];

  const scored: MatchResult[] = [];

  for (const chat of chats) {
    let bestScore: number | null = null;

    if (chat.name) {
      const nameScore = scoreMatch(query, chat.name);
      if (nameScore !== null) bestScore = nameScore;
    }

    const jidNumber = chat.jid.split('@')[0];
    const jidScore = scoreMatch(query, jidNumber);
    if (jidScore !== null && (bestScore === null || jidScore < bestScore)) {
      bestScore = jidScore;
    }

    if (bestScore !== null) {
      scored.push({ jid: chat.jid, name: chat.name || jidNumber, score: bestScore });
    }
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, maxResults);
}

interface ResolveResult {
  resolved: string | null;
  candidates: MatchResult[];
  error: string | undefined;
}

/**
 * Resolve a query to a single JID, or return disambiguation candidates.
 * @param query - The search query
 * @param chats - Available chats to match against
 * @returns Resolution result with resolved JID, candidates, or error
 */
export function resolveRecipient(query: string, chats: Chat[]): ResolveResult {
  if (!query) {
    return { resolved: null, candidates: [], error: 'Recipient is required' };
  }

  if (query.includes('@')) {
    return { resolved: query, candidates: [], error: undefined };
  }

  const matches = fuzzyMatch(query, chats);

  if (matches.length === 0) {
    return {
      resolved: null,
      candidates: [],
      error: `No contact or group found matching "${query}". Use list_chats to see available conversations.`,
    };
  }

  if (matches.length === 1 || matches[0].score === 0) {
    return { resolved: matches[0].jid, candidates: [], error: undefined };
  }

  if (matches[0].score < matches[1].score) {
    return { resolved: matches[0].jid, candidates: [], error: undefined };
  }

  return {
    resolved: null,
    candidates: matches.slice(0, 5),
    error: `Multiple matches found for "${query}". Please use the exact JID from the list below.`,
  };
}
