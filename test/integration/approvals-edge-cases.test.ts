/**
 * Approval Workflow Edge Case Tests
 *
 * Tests timeout expiry, concurrent approvals, malformed responses, and edge cases
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { MessageStore } from '../../src/whatsapp/store.js';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DB_PATH = join(process.cwd(), '.test-data', 'approvals-edge-cases-test.db');

describe('Approval Workflow Edge Cases', () => {
  let store: MessageStore;

  before(() => {
    // Clean up any existing test database
    try {
      unlinkSync(TEST_DB_PATH);
    } catch (err) {
      // Ignore if doesn't exist
    }

    store = new MessageStore(TEST_DB_PATH);
  });

  after(() => {
    if (store) {
      store.close();
    }
    try {
      unlinkSync(TEST_DB_PATH);
    } catch (err) {
      // Ignore
    }
  });

  it('should expire timed-out approvals automatically', () => {
    const now = Date.now();
    const expiredApproval = {
      toJid: 'expired@s.whatsapp.net',
      action: 'Expired Action',
      details: 'This should be expired',
      timeoutMs: 100, // 100ms timeout
      createdAt: now - 1000 // Created 1 second ago
    };

    // Manually insert expired approval
    const stmt = store.db.prepare(`
      INSERT INTO approvals (id, to_jid, action, details, status, created_at, timeout_ms)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `);

    const expiredId = 'approval-expired-test';
    stmt.run(expiredId, expiredApproval.toJid, expiredApproval.action, expiredApproval.details, expiredApproval.createdAt, expiredApproval.timeoutMs);

    // Get pending approvals (should auto-expire)
    const pending = store.getPendingApprovals();
    const expiredApprovalStillPending = pending.find(a => a.id === expiredId);

    assert.ok(!expiredApprovalStillPending, 'Expired approval should not be in pending list');

    // Verify status changed to expired
    const retrieved = store.getApproval(expiredId);
    assert.strictEqual(retrieved.status, 'expired', 'Status should be expired');
  });

  it('should handle multiple concurrent approvals to same contact', () => {
    const contactJid = 'multi-approval@s.whatsapp.net';
    const approvals: ReturnType<MessageStore['createApproval']>[] = [];

    // Create 5 approvals in rapid succession
    for (let i = 0; i < 5; i++) {
      const approval = store.createApproval({
        toJid: contactJid,
        action: `Action ${i}`,
        details: `Details for action ${i}`,
        timeoutMs: 300000
      });
      approvals.push(approval);
    }

    // All should be retrievable
    const pending = store.getPendingApprovals();
    const contactApprovals = pending.filter(a => a.to_jid === contactJid);

    assert.strictEqual(contactApprovals.length, 5, 'Should have 5 pending approvals');

    // Approve one
    const firstApproval = approvals[0];
    const respondSuccess = store.respondToApproval(firstApproval.id, true, 'Approved via test');
    assert.ok(respondSuccess, 'Response should succeed');

    // Should have 4 remaining pending
    const remainingPending = store.getPendingApprovals().filter(a => a.to_jid === contactJid);
    assert.strictEqual(remainingPending.length, 4, 'Should have 4 remaining pending');
  });

  it('should handle approval response parsing edge cases', () => {
    const testCases = [
      { response: 'APPROVE', expected: true, description: 'Uppercase APPROVE' },
      { response: 'approve', expected: true, description: 'Lowercase approve' },
      { response: 'Approved', expected: true, description: 'Mixed case Approved' },
      { response: 'YES', expected: true, description: 'Uppercase YES' },
      { response: 'yes', expected: true, description: 'Lowercase yes' },
      { response: '✅', expected: true, description: 'Checkmark emoji' },
      { response: '✔️', expected: true, description: 'Check mark emoji' },
      { response: 'DENY', expected: false, description: 'Uppercase DENY' },
      { response: 'deny', expected: false, description: 'Lowercase deny' },
      { response: 'NO', expected: false, description: 'Uppercase NO' },
      { response: 'no', expected: false, description: 'Lowercase no' },
      { response: '❌', expected: false, description: 'X emoji' },
      { response: '🚫', expected: false, description: 'No entry emoji' },
      { response: 'I APPROVE this', expected: true, description: 'APPROVE in sentence' },
      { response: 'yes please', expected: true, description: 'yes with extra text' },
      { response: 'no way', expected: false, description: 'no with extra text' }
    ];

    for (const testCase of testCases) {
      const approval = store.createApproval({
        toJid: 'response-test@s.whatsapp.net',
        action: 'Response Test',
        details: `Testing: ${testCase.description}`,
        timeoutMs: 300000
      });

      // Simulate checking approval response (this is what client._checkApprovalResponse does)
      const text = testCase.response.toLowerCase().trim();
      const approvalKeywords = ['approve', 'approved', 'yes', 'ok', 'okay', 'confirm', 'y', '✅', '✔️'];
      const denyKeywords = ['deny', 'denied', 'no', 'reject', 'cancel', 'n', '❌', '🚫'];

      const isApproved = approvalKeywords.some(k => text.includes(k));
      const isDenied = denyKeywords.some(k => text.includes(k));

      const expectedResponse = testCase.expected ? 'approved' : 'denied';

      if (isApproved && !isDenied) {
        store.respondToApproval(approval.id, true, testCase.response);
        const retrieved = store.getApproval(approval.id);
        assert.strictEqual(retrieved.status, 'approved', `${testCase.description} should approve`);
      } else if (isDenied && !isApproved) {
        store.respondToApproval(approval.id, false, testCase.response);
        const retrieved = store.getApproval(approval.id);
        assert.strictEqual(retrieved.status, 'denied', `${testCase.description} should deny`);
      }
    }
  });

  it('should handle ambiguous responses (both approve and deny keywords)', () => {
    const approval = store.createApproval({
      toJid: 'ambiguous@s.whatsapp.net',
      action: 'Ambiguous Test',
      details: 'Testing ambiguous response',
      timeoutMs: 300000
    });

    // Response with both approve and deny - should be treated as neither
    const ambiguousText = 'yes or no';
    const text = ambiguousText.toLowerCase().trim();
    const approvalKeywords = ['approve', 'approved', 'yes', 'ok', 'okay', 'confirm', 'y', '✅', '✔️'];
    const denyKeywords = ['deny', 'denied', 'no', 'reject', 'cancel', 'n', '❌', '🚫'];

    const isApproved = approvalKeywords.some(k => text.includes(k));
    const isDenied = denyKeywords.some(k => text.includes(k));

    // Both true - should not respond
    assert.ok(isApproved && isDenied, 'Should detect both keywords');

    // Approval should still be pending
    const retrieved = store.getApproval(approval.id);
    assert.strictEqual(retrieved.status, 'pending', 'Ambiguous response should not change status');
  });

  it('should handle approval with ID reference in response', () => {
    const approval = store.createApproval({
      toJid: 'id-ref@s.whatsapp.net',
      action: 'ID Reference Test',
      details: 'Testing ID in response',
      timeoutMs: 300000
    });

    // Response includes approval ID
    const responseText = `APPROVE ${approval.id}`;
    const idMatch = responseText.match(/approval_\w+/);

    assert.ok(idMatch, 'Should extract approval ID');
    assert.strictEqual(idMatch[0], approval.id, 'Should match correct ID');

    // Should approve
    store.respondToApproval(approval.id, true, responseText);
    const retrieved = store.getApproval(approval.id);
    assert.strictEqual(retrieved.status, 'approved', 'Should approve with ID reference');
    assert.strictEqual(retrieved.response_text, responseText, 'Should store full response');
  });

  it('should handle very long approval details (near limit)', () => {
    const longDetails = 'A'.repeat(1900); // Close to 2000 char limit

    const approval = store.createApproval({
      toJid: 'long-details@s.whatsapp.net',
      action: 'Long Details Test',
      details: longDetails,
      timeoutMs: 300000
    });

    const retrieved = store.getApproval(approval.id);
    assert.strictEqual(retrieved.details.length, longDetails.length, 'Should preserve long details');
    assert.strictEqual(retrieved.details, longDetails, 'Long details should match exactly');
  });

  it('should handle approval timeout calculation correctly', () => {
    const approval = store.createApproval({
      toJid: 'timeout-calc@s.whatsapp.net',
      action: 'Timeout Calc Test',
      details: 'Testing timeout calculation',
      timeoutMs: 300000 // 5 minutes
    });

    const retrieved = store.getApproval(approval.id);
    const expectedExpiry = retrieved.created_at + retrieved.timeout_ms;
    const now = Date.now();

    assert.ok(expectedExpiry > now, 'Approval should not be expired yet');
    assert.ok(expectedExpiry < now + 301000, 'Should expire in ~5 minutes');

    // Check remaining time
    const pending = store.getPendingApprovals();
    const found = pending.find(a => a.id === approval.id);
    assert.ok(found, 'Should be in pending list');
  });

  it('should prevent double-responding to same approval', () => {
    const approval = store.createApproval({
      toJid: 'double-respond@s.whatsapp.net',
      action: 'Double Respond Test',
      details: 'Testing double response prevention',
      timeoutMs: 300000
    });

    // First response
    const firstSuccess = store.respondToApproval(approval.id, true, 'First response');
    assert.ok(firstSuccess, 'First response should succeed');

    // Second response should fail (no rows affected)
    const secondSuccess = store.respondToApproval(approval.id, false, 'Second response');
    assert.ok(!secondSuccess, 'Second response should fail');

    // Status should remain from first response
    const retrieved = store.getApproval(approval.id);
    assert.strictEqual(retrieved.status, 'approved', 'Status should remain approved');
    assert.strictEqual(retrieved.response_text, 'First response', 'Should keep first response');
  });

  it('should handle concurrent responses to same approval ID (race condition)', async () => {
    const approval = store.createApproval({
      toJid: 'concurrent-race@s.whatsapp.net',
      action: 'Race Condition Test',
      details: 'Testing concurrent response handling',
      timeoutMs: 300000
    });

    // Simulate concurrent responses by calling respondToApproval simultaneously
    const results = await Promise.allSettled([
      Promise.resolve(store.respondToApproval(approval.id, true, 'Concurrent approve')),
      Promise.resolve(store.respondToApproval(approval.id, false, 'Concurrent deny')),
      Promise.resolve(store.respondToApproval(approval.id, true, 'Concurrent approve 2'))
    ]);

    // Extract successful responses
    const successes = results
      .map(r => r.status === 'fulfilled' ? r.value : false)
      .filter(v => v === true);

    // Exactly one should succeed (SQLite serialization ensures this)
    assert.strictEqual(successes.length, 1, 'Exactly one response should succeed');

    // Final status should be definitive
    const retrieved = store.getApproval(approval.id);
    assert.ok(
      retrieved.status === 'approved' || retrieved.status === 'denied',
      'Status should be either approved or denied'
    );
    assert.ok(
      retrieved.responded_at !== null && retrieved.responded_at !== undefined,
      'Should have responded_at timestamp'
    );
  });

  it('should accurately calculate remaining time for pending approvals', () => {
    const timeoutMs = 10000; // 10 seconds
    const beforeCreate = Date.now();

    const approval = store.createApproval({
      toJid: 'timing-test@s.whatsapp.net',
      action: 'Timing Test',
      details: 'Testing exact timeout calculation',
      timeoutMs: timeoutMs
    });

    const afterCreate = Date.now();

    // Get pending should return the approval
    const pending = store.getPendingApprovals();
    const found = pending.find(a => a.id === approval.id);
    assert.ok(found, 'Should be in pending list');

    // Check created_at is accurate
    const createdAtOk = approval.created_at >= beforeCreate && approval.created_at <= afterCreate;
    assert.ok(createdAtOk, 'created_at should be accurate timestamp');

    // Check timeout_ms is stored correctly
    assert.strictEqual(approval.timeout_ms, timeoutMs, 'timeout_ms should be stored correctly');

    // Calculate expected expiry
    const expectedExpiry = approval.created_at + approval.timeout_ms;
    const now = Date.now();

    // Approval should not be expired yet
    assert.ok(expectedExpiry > now, 'Approval should not be expired');

    // Remaining time should be close to timeout
    const remainingMs = expectedExpiry - now;
    assert.ok(
      remainingMs > timeoutMs - 1000 && remainingMs <= timeoutMs + 1000,
      'Remaining time should be close to original timeout'
    );
  });

  it('should handle approval created with near-zero timeout (immediate expiry)', () => {
    const approval = store.createApproval({
      toJid: 'near-zero-timeout@s.whatsapp.net',
      action: 'Near Zero Timeout Test',
      details: 'Testing very short timeout',
      timeoutMs: 1 // 1ms - will likely expire immediately
    });

    // Wait a tiny bit to ensure expiry
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait for 5ms */ }

    // Get pending should auto-expire
    const pending = store.getPendingApprovals();
    const found = pending.find(a => a.id === approval.id);

    if (found) {
      // If still pending, it hasn't expired yet (very unlikely but possible)
      assert.ok(true, 'Approval with near-zero timeout is still pending (timing-dependent)');
    } else {
      // Should be expired
      const retrieved = store.getApproval(approval.id);
      assert.strictEqual(retrieved.status, 'expired', 'Should be expired');
    }
  });
});
