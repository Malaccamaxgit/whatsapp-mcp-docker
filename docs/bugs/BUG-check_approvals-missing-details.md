# BUG: check_approvals never displays the details field

**Status: OPEN**

## Symptom

The `check_approvals` tool fetches all 9 `ApprovalRow` fields from the database (`id`, `to_jid`, `action`, `details`, `status`, `response_text`, `created_at`, `timeout_ms`, `responded_at`), but the `details` field is **never displayed** in either output mode.

When checking a **specific approval** (by request ID), the output shows:
- `id`, `action`, `status`, `response_text` (if approved/denied), `responded_at` (if approved/denied)
- Computed remaining time (if pending)

When **listing all pending approvals**, the output shows:
- `id`, `action`, `to_jid`
- Computed remaining time

In both modes, `details` — which contains the context and description of what needs approval — is fetched but omitted.

## Root cause

In `src/tools/approvals.ts`:

**Specific approval mode** (lines 193-210): The output template includes `action`, `status`, `response_text`, and `responded_at`, but not `details`.

**Pending list mode** (lines 220-226): The output template includes `id`, `action`, and `to_jid`, but not `details`.

The `details` field is populated by `request_approval` (which passes it through to the store) and stored in the database, but it is never read back into the output.

## Impact

- Users see the action title (e.g., "Deploy to production") but lack the contextual details that explain what specifically needs approval
- The approval workflow is less informative, potentially leading to approvals without full context
- The `details` field was designed to provide this exact context (e.g., "Deploying commit abc123 to prod. Estimated downtime: 5 minutes.")

## Proposed fix

Add the `details` field to both output modes:

**Specific approval mode:**
```
Approval #abc123
  Action: Deploy to production
  Details: Deploying commit abc123 to prod. Estimated downtime: 5 minutes.
  Status: PENDING
  Remaining: 4m 32s
```

**Pending list mode:**
```
Pending approvals:
  #abc123: Deploy to production (to: +1234567890) — 4m remaining
           Details: Deploying commit abc123 to prod...
```

## Files to modify

- `src/tools/approvals.ts` — output formatting in `check_approvals` (lines 193-210 for specific mode, lines 220-226 for list mode)

**Priority: MEDIUM** — the tool is functional but missing key context that makes approvals actionable.
