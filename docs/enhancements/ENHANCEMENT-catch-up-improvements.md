# ENHANCEMENT: Catch-Up Improvements

**Status: PROPOSED**  
**Priority: Medium**  
**Created: 2026-04-06**

---

## Problem Statement

The `catch_up` tool provides a useful summary of WhatsApp activity, but several issues reduce its effectiveness:

1. **Recent Highlights missing timestamps** - The time column is empty, making it impossible to know when messages were received.

2. **Questions show time-only, no date** - When running `catch_up` over multiple days (e.g., `since: 'this_week'`), questions show time like `21:27:18` without indicating which day.

3. **Active Chats lack last message time** - Users cannot see when the last message was received in each chat or how long ago.

4. **No time-elapsed context** - Messages show absolute times but not relative times like "2 hours ago".

5. **No response status for questions** - Users can't see if their questions have been answered or if they're still pending.

---

## Current Implementation

### Recent Highlights (Missing Time)

```typescript
// src/tools/chats.ts:222-225
const highlights = filteredData.recentUnread.slice(0, 5).map((m) => {
  const sender = m.sender_name || m.sender_jid?.split('@')[0] || '?';
  const chatName = m.chat_name || m.chat_jid;
  return `  - [${chatName}] ${sender}: ${m.body?.substring(0, 100) || '[media]'}`;
  // <-- No timestamp included!
});
```

### Questions (Time-Only, No Date)

```typescript
// src/tools/chats.ts:205-209
const qLines = filteredData.questions.slice(0, 10).map((m) => {
  const sender = m.sender_name || m.sender_jid?.split('@')[0] || '?';
  const chatName = m.chat_name || m.chat_jid;
  const time = formatTimeOnly(m.timestamp);  // <-- Only HH:mm:ss
  return `  - [${chatName}] ${sender} (${time}): ${m.body?.substring(0, 120) || ''}`;
});
```

### Active Chats (No Last Message Time)

```typescript
// src/tools/chats.ts:192-196
const chatLines = filteredData.activeChats.map((c) => {
  const name = c.name || c.jid;
  const type = c.is_group ? '(group)' : '';
  const unread = c.unread_count > 0 ? ` — ${c.unread_count} unread` : '';
  return `  - ${name} ${type}${unread} [${c.recent_messages} recent messages]`;
  // <-- c.last_message_at is available but not used!
});
```

### Available Data Not Utilized

The `ChatRow` and `MessageRow` types contain timestamps that are not being displayed:

```typescript
// src/whatsapp/store.ts:15-23
type ChatRow = {
  jid: string;
  name: string | null;
  is_group: number;
  unread_count: number;
  last_message_at: number | null;  // <-- Available!
  last_message_preview: string | null;
  updated_at: number;
};

// src/whatsapp/store.ts:25-42
type MessageRow = {
  id: string;
  chat_jid: string;
  sender_jid: string | null;
  sender_name: string | null;
  timestamp: number;  // <-- Available!
  body: string | null;
  // ...
};
```

---

## Proposed Solution

### 1. Add Timestamps to Recent Highlights

```typescript
// Before
return `  - [${chatName}] ${sender}: ${m.body?.substring(0, 100) || '[media]'}`;

// After
const time = formatTimeOnly(m.timestamp);
const timeAgo = formatTimeAgo(m.timestamp);
return `  - [${chatName}] ${sender} (${time}, ${timeAgo}): ${m.body?.substring(0, 100) || '[media]'}`;
```

### 2. Add Date+Time to Questions (Based on Since Period)

```typescript
// Before
const time = formatTimeOnly(m.timestamp);

// After - Show full datetime if period spans multiple days
const now = Math.floor(Date.now() / 1000);
const sinceTs = sinceMap[since] || sinceMap['today'];
const showDate = (now - sinceTs) > 86400; // More than 24 hours
const timeStr = showDate 
  ? formatTimestamp(m.timestamp)  // "2026-04-05, 21:27:18"
  : formatTimeOnly(m.timestamp);   // "21:27:18"
const timeAgo = formatTimeAgo(m.timestamp);
return `  - [${chatName}] ${sender} (${timeStr}, ${timeAgo}): ${m.body?.substring(0, 120) || ''}`;
```

### 3. Add Last Message Time to Active Chats

```typescript
// Before
return `  - ${name} ${type}${unread} [${c.recent_messages} recent messages]`;

// After
const timeAgo = c.last_message_at 
  ? formatTimeAgo(c.last_message_at) 
  : 'never';
const lastTime = c.last_message_at 
  ? formatTimeOnly(c.last_message_at) 
  : '';
const lastInfo = lastTime 
  ? ` last: ${lastTime} (${timeAgo})` 
  : ' (no messages)';
return `  - ${name} ${type}${unread} [${c.recent_messages} recent]${lastInfo}`;
```

### 4. Add Time-Ago Formatting Utility

```typescript
// src/utils/timezone.ts

/**
 * Format a Unix timestamp as relative time (e.g., "2 hours ago").
 * @param timestampSeconds - Unix timestamp in seconds
 * @returns Human-readable relative time
 */
export function formatTimeAgo(timestampSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestampSeconds;

  if (diff < 60) return 'just now';
  if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    return `${mins} min${mins === 1 ? '' : 's'} ago`;
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (diff < 604800) {
    const days = Math.floor(diff / 86400);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  if (diff < 2592000) {
    const weeks = Math.floor(diff / 604800);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }
  if (diff < 31536000) {
    const months = Math.floor(diff / 2592000);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }
  const years = Math.floor(diff / 31536000);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
```

---

## Enhanced Output Examples

### Active Chats (Before/After)

**Before:**
```
Active Chats:
  - Séverine Godet  — 2 unread [4 recent messages]
  - WhatsAppMCP (group) [3 recent messages]
  - 138053771370743@lid  — 4 unread [4 recent messages]
```

**After:**
```
Active Chats:
  - Séverine Godet — 2 unread [4 recent] last: 21:27:18 (3 mins ago)
  - WhatsAppMCP (group) [3 recent] last: 22:05:34 (1 hour ago)
  - 138053771370743@lid — 4 unread [4 recent] last: 21:10:18 (20 mins ago)
```

### Questions (Before/After)

**Before:**
```
Questions Awaiting Response (1):
  - [Séverine Godet] Séverine Godet (21:27:18): We talking tech ?
```

**After:**
```
Questions Awaiting Response (1):
  - [Séverine Godet] Séverine Godet (21:27:18, 3 mins ago): We talking tech ?
```

### Recent Highlights (Before/After)

**Before:**
```
Recent Highlights:
  - [Séverine Godet] Séverine Godet: Play funky music for Benjamin
  - [Séverine Godet] Séverine Godet: We talking tech ?
```

**After:**
```
Recent Highlights:
  - [Séverine Godet] Séverine Godet (21:25:10, 5 mins ago): Play funky music for Benjamin
  - [Séverine Godet] Séverine Godet (21:27:18, 3 mins ago): We talking tech ?
```

### Multi-Day Period (this_week)

**Before:**
```
Questions Awaiting Response (3):
  - [John] John (21:27:18): Meeting tomorrow?
  - [Alice] Alice (09:15:00): Budget approved?
  - [Bob] Bob (14:30:22): Deploy today?
```

**After:**
```
Questions Awaiting Response (3):
  - [John] John (2026-04-06, 21:27:18, 2 mins ago): Meeting tomorrow?
  - [Alice] Alice (2026-04-05, 09:15:00, 1 day ago): Budget approved?
  - [Bob] Bob (2026-04-04, 14:30:22, 2 days ago): Deploy today?
```

---

### 5. Track Question Response Status

Query for responses to questions within the same chat after the question timestamp:

Query for responses to questions within the same chat after the question timestamp:

```typescript
// src/whatsapp/store.ts - New method

public getQuestionsWithStatus(sinceTimestamp: number): (MessageRow & { 
  chat_name: string | null;
  has_response: boolean;
  response_time_seconds: number | null;
  responder_name: string | null;
})[] {
  const questions = this._decryptRows(
    this.db!.prepare(`
      SELECT m.*, c.name as chat_name,
        EXISTS (
          SELECT 1 FROM messages r 
          WHERE r.chat_jid = m.chat_jid 
            AND r.timestamp > m.timestamp 
            AND r.timestamp <= m.timestamp + 86400
            AND r.is_from_me = 1
        ) as has_response,
        (
          SELECT MIN(r.timestamp - m.timestamp)
          FROM messages r 
          WHERE r.chat_jid = m.chat_jid 
            AND r.timestamp > m.timestamp 
            AND r.is_from_me = 1
        ) as response_time_seconds,
        (
          SELECT r.sender_name
          FROM messages r 
          WHERE r.chat_jid = m.chat_jid 
            AND r.timestamp > m.timestamp 
            AND r.is_from_me = 1
          ORDER BY r.timestamp ASC
          LIMIT 1
        ) as responder_name
      FROM messages m
      JOIN chats c ON c.jid = m.chat_jid
      WHERE m.is_read = 0 
        AND m.timestamp > ? 
        AND m.is_from_me = 0
        AND m.body LIKE '%?%'
      ORDER BY m.timestamp DESC
      LIMIT 20
    `).all(sinceTimestamp)
  ) as (MessageRow & { 
    chat_name: string | null;
    has_response: number;
    response_time_seconds: number | null;
    responder_name: string | null;
  })[];

  return questions.map(q => ({
    ...q,
    has_response: q.has_response === 1,
    response_time_seconds: q.response_time_seconds
  }));
}
```

### Enhanced Questions Output

```typescript
// src/tools/chats.ts - Updated questions section

if (questionsWithStatus.length > 0) {
  const qLines = questionsWithStatus.slice(0, 10).map((m) => {
    const sender = m.sender_name || m.sender_jid?.split('@')[0] || '?';
    const chatName = m.chat_name || m.chat_jid;
    const time = showDate ? formatTimestamp(m.timestamp) : formatTimeOnly(m.timestamp);
    const timeAgo = formatTimeAgo(m.timestamp);
    
    // Response status
    let status = '';
    if (m.has_response && m.response_time_seconds !== null) {
      const respTime = formatResponseTime(m.response_time_seconds);
      status = ` [ANSWERED in ${respTime}]`;
    } else if (m.has_response) {
      status = ' [ANSWERED]';
    }
    
    return `  - [${chatName}] ${sender} (${time}, ${timeAgo}): ${m.body?.substring(0, 120) || ''}${status}`;
  });
  
  const answered = questionsWithStatus.filter(q => q.has_response).length;
  const pending = questionsWithStatus.length - answered;
  
  sections.push(
    `Questions (${questionsWithStatus.length}: ${answered} answered, ${pending} pending):\n${qLines.join('\n')}`
  );
}

function formatResponseTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/utils/timezone.ts` | Add `formatTimeAgo()` function |
| `src/whatsapp/store.ts` | Add `getQuestionsWithStatus()` method (optional) |
| `src/tools/chats.ts` | Update `catch_up` output formatting for all sections |

---

## Testing Plan

```typescript
// test/unit/catch-up-improvements.test.ts

describe('catch_up improvements', () => {
  test('shows time-ago for active chats', async () => {
    // Create chat with message 1 hour ago
    // Call catch_up
    // Expect "last: ... (1 hour ago)"
  });

  test('shows full datetime for multi-day periods', async () => {
    // Create question from 2 days ago
    // Call catch_up with 'this_week'
    // Expect full datetime format "2026-04-04, 14:30:22"
  });

  test('shows time-only for single-day periods', async () => {
    // Create question from today
    // Call catch_up with 'today'
    // Expect time-only format "14:30:22"
  });

  test('shows timestamps in recent highlights', async () => {
    // Create unread messages
    // Call catch_up
    // Expect timestamps in highlights
  });

  test('identifies answered questions', async () => {
    // Create question, then create response from me
    // Call catch_up
    // Expect "[ANSWERED]" status on question
  });

  test('calculates response time correctly', async () => {
    // Create question at time T
    // Create response at time T + 5 minutes
    // Call catch_up
    // Expect "[ANSWERED in 5m]"
  });
});
```

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Timestamp clarity in highlights | None | Full datetime + relative |
| Question timing clarity | Time-only | Full datetime + relative (multi-day aware) |
| Active chat last message time | Not shown | Time + time-ago |
| Question response status | Not shown | Answered/pending with response time |
| User comprehension time | High (need to check timestamps) | Low (immediate context) |

---

## Future Enhancements

### Poll Response Tracking

For polls, show response counts:

```typescript
// In catch_up, if message has poll, show vote count
if (m.poll_options) {
  const pollInfo = await store.getPollResults(m.id);
  return `  - [${chatName}] ${sender} (${time}, ${timeAgo}): [POLL] "${m.body}" (${pollInfo.totalVotes} votes)`;
}
```

### Approval Request Status

Show pending approval requests with time remaining:

```typescript
// Already implemented in catch_up, but could enhance
if (filteredData.pendingApprovals.length > 0) {
  const aLines = filteredData.pendingApprovals.map((a) => {
    const remaining = Math.max(0, Math.round((a.created_at + a.timeout_ms - Date.now()) / 1000));
    const created = formatTimeAgo(a.created_at / 1000);
    return `  - [${a.id}] "${a.action}" — ${remaining}s remaining (created ${created})`;
  });
}
```