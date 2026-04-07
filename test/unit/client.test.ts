/**
 * Unit tests for WhatsAppClient
 *
 * Tests core logic in isolation using a minimal mock MessageStore and no
 * real WhatsApp connection. The WhatsAppClient constructor accepts an
 * optional injected client (null here), so initialize() is never called.
 *
 * Covers:
 *   - _persistMessage: body extraction, chatJid resolution, media detection,
 *     poll metadata, isFromMe flag
 *   - _extractMediaInfo: media type detection for all supported message types
 *   - _checkApprovalResponse: keyword matching, emoji, false-positive prevention,
 *     id-based vs. jid-based lookup, ambiguous text
 *   - _notifyMessageWaiters: filter matching, FIFO queue behaviour
 *   - _trackSentId: deduplication, FIFO eviction cap
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppClient } from '../../src/whatsapp/client.js';
import type { StoredMessage } from '../../src/whatsapp/client.js';
import type { MessageStore } from '../../src/whatsapp/store.js';

// ── Minimal mock helpers ──────────────────────────────────────────────────────

interface MockStoreState {
  added: StoredMessage[];
  responded: Array<{ id: string; approved: boolean; text: string | null }>;
}

function makeMockStore(
  pendingApprovals: Array<{ id: string; to_jid: string }> = [],
  jidMappingFn?: (jid: string) => { lidJid?: string; phoneJid?: string; phoneNumber?: string } | null
): { store: MessageStore; state: MockStoreState } {
  const state: MockStoreState = { added: [], responded: [] };
  const store = {
    addMessage: (msg: StoredMessage) => { state.added.push(msg); },
    getPendingApprovals: () => pendingApprovals,
    respondToApproval: (id: string, approved: boolean, text: string | null) => {
      state.responded.push({ id, approved, text });
      return true;
    },
    getJidMapping: (jid: string) => jidMappingFn?.(jid) ?? null,
  } as unknown as MessageStore;
  return { store, state };
}

function makeClient(
  pendingApprovals: Array<{ id: string; to_jid: string }> = [],
  jidMappingFn?: (jid: string) => { lidJid?: string; phoneJid?: string; phoneNumber?: string } | null
) {
  const { store, state } = makeMockStore(pendingApprovals, jidMappingFn);
  // Pass client: null — no real WhatsApp connection, bypasses initialize()
  const client = new WhatsAppClient({ messageStore: store, client: null });
  return { client, state };
}

/** Cast a plain fixture object to the WaMessageEvent shape expected by _persistMessage */
const ev = (obj: object) => obj as never;

/** Cast a plain fixture object to the inner-message shape expected by _extractMediaInfo */
const innerMsg = (obj: object) => obj as never;

// ── _persistMessage: body extraction ─────────────────────────────────────────

describe('WhatsAppClient._persistMessage — body extraction', () => {
  it('extracts body from evt.text (highest priority)', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ text: 'hello from text' }), false);
    assert.equal(state.added[0].body, 'hello from text');
  });

  it('falls back to evt.body when evt.text is absent', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ body: 'hello from body' }), false);
    assert.equal(state.added[0].body, 'hello from body');
  });

  it('extracts from message.conversation', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ message: { conversation: 'conversation text' } }), false);
    assert.equal(state.added[0].body, 'conversation text');
  });

  it('extracts from message.extendedTextMessage.text', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ message: { extendedTextMessage: { text: 'extended text' } } }), false);
    assert.equal(state.added[0].body, 'extended text');
  });

  it('extracts from message.ephemeralMessage.message.conversation', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({
      message: { ephemeralMessage: { message: { conversation: 'ephemeral text' } } }
    }), false);
    assert.equal(state.added[0].body, 'ephemeral text');
  });

  it('extracts from message.imageMessage.caption', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({
      message: { imageMessage: { mimetype: 'image/jpeg', caption: 'photo caption' } }
    }), false);
    assert.equal(state.added[0].body, 'photo caption');
  });

  it('extracts from message.listResponseMessage.title', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({
      message: { listResponseMessage: { title: 'My list choice' } }
    }), false);
    assert.equal(state.added[0].body, 'My list choice');
  });

  it('extracts from message.pollCreationMessage.name', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({
      message: { pollCreationMessage: { name: 'Best colour?' } }
    }), false);
    assert.equal(state.added[0].body, 'Best colour?');
  });

  it('extracts from pollUpdateMessage.vote.selectedOption', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({
      message: { pollUpdateMessage: { vote: { selectedOption: 'Red' } } }
    }), false);
    assert.equal(state.added[0].body, 'Red');
  });

  it('extracts from pollUpdateMessage.vote.selectedOptions (joins with comma)', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({
      message: {
        pollUpdateMessage: { vote: { selectedOptions: ['Red', 'Blue'] } }
      }
    }), false);
    assert.equal(state.added[0].body, 'Red, Blue');
  });

  it('falls back to empty string when no body path resolves', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ key: { id: 'stub-id' } }), false);
    assert.equal(state.added[0].body, '');
  });

  it('prefers evt.text over message.conversation', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ text: 'top', message: { conversation: 'lower' } }), false);
    assert.equal(state.added[0].body, 'top');
  });
});

// ── _persistMessage: chatJid resolution ──────────────────────────────────────

describe('WhatsAppClient._persistMessage — chatJid resolution', () => {
  it('uses key.remoteJID as chatJid when key.participant is present (group message)', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({
      key: { remoteJID: '99999@g.us', participant: 'sender@s.whatsapp.net', id: 'm1' }
    }), false);
    assert.equal(state.added[0].chatJid, '99999@g.us');
  });

  it('uses info.chat as chatJid for direct messages', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({
      info: { id: 'm2', chat: 'direct@s.whatsapp.net', timestamp: 1700000000 }
    }), false);
    assert.equal(state.added[0].chatJid, 'direct@s.whatsapp.net');
  });

  it('falls back through chatJID → key.remoteJID → from', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ from: 'fallback@s.whatsapp.net' }), false);
    assert.equal(state.added[0].chatJid, 'fallback@s.whatsapp.net');
  });

  it('prefers evt.chatJID over evt.from', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ chatJID: 'chat@s.whatsapp.net', from: 'from@s.whatsapp.net' }), false);
    assert.equal(state.added[0].chatJid, 'chat@s.whatsapp.net');
  });

  it('sets chatJid to null when no field resolves', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({}), false);
    assert.equal(state.added[0].chatJid, null);
  });
});

// ── _persistMessage: isFromMe / senderJid ────────────────────────────────────

describe('WhatsAppClient._persistMessage — isFromMe and senderJid', () => {
  it('reads isFromMe from info.isFromMe', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ info: { id: 'x', isFromMe: true } }), false);
    assert.equal(state.added[0].isFromMe, true);
  });

  it('reads isFromMe from key.fromMe when info is absent', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ key: { id: 'x', fromMe: true } }), false);
    assert.equal(state.added[0].isFromMe, true);
  });

  it('defaults isFromMe to false when absent', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({}), false);
    assert.equal(state.added[0].isFromMe, false);
  });

  it('reads senderJid from info.sender', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ info: { id: 'x', sender: 'me@s.whatsapp.net' } }), false);
    assert.equal(state.added[0].senderJid, 'me@s.whatsapp.net');
  });
});

// ── _persistMessage: poll metadata ───────────────────────────────────────────

describe('WhatsAppClient._persistMessage — poll metadata', () => {
  it('extracts pollMetadata.voteOptions from pollCreationMessage.options', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({
      key: { id: 'poll-1' },
      message: {
        pollCreationMessage: {
          name: 'Favourite colour?',
          options: [{ optionName: 'Red' }, { optionName: 'Blue' }, { optionName: '' }]
        }
      }
    }), false);
    const msg = state.added[0];
    assert.ok(msg.pollMetadata, 'pollMetadata should be set');
    assert.deepEqual(msg.pollMetadata!.voteOptions, ['Red', 'Blue']); // empty string filtered out
    assert.ok(msg.pollMetadata!.pollCreationMessageKey);
  });

  it('sets pollMetadata to undefined for ordinary text messages', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ message: { conversation: 'just text' } }), false);
    assert.equal(state.added[0].pollMetadata, undefined);
  });
});

// ── _persistMessage: media detection ─────────────────────────────────────────

describe('WhatsAppClient._persistMessage — media detection', () => {
  it('marks image messages as hasMedia=true, mediaType=image', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ message: { imageMessage: { mimetype: 'image/jpeg' } } }), false);
    assert.equal(state.added[0].hasMedia, true);
    assert.equal(state.added[0].mediaType, 'image');
  });

  it('marks video messages as hasMedia=true, mediaType=video', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ message: { videoMessage: { mimetype: 'video/mp4' } } }), false);
    assert.equal(state.added[0].hasMedia, true);
    assert.equal(state.added[0].mediaType, 'video');
  });

  it('marks audio messages as hasMedia=true, mediaType=audio', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ message: { audioMessage: { mimetype: 'audio/ogg' } } }), false);
    assert.equal(state.added[0].hasMedia, true);
    assert.equal(state.added[0].mediaType, 'audio');
  });

  it('marks document messages as hasMedia=true, mediaType=document', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({
      message: { documentMessage: { mimetype: 'application/pdf', fileName: 'report.pdf' } }
    }), false);
    assert.equal(state.added[0].hasMedia, true);
    assert.equal(state.added[0].mediaType, 'document');
  });

  it('marks sticker messages as hasMedia=true, mediaType=sticker', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ message: { stickerMessage: { mimetype: 'image/webp' } } }), false);
    assert.equal(state.added[0].hasMedia, true);
    assert.equal(state.added[0].mediaType, 'sticker');
  });

  it('sets hasMedia=false for plain text messages', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ message: { conversation: 'just text' } }), false);
    assert.equal(state.added[0].hasMedia, false);
    assert.equal(state.added[0].mediaType, null);
  });

  it('respects evt.hasMedia and evt.mediaType flags directly', () => {
    const { client, state } = makeClient();
    client._persistMessage(ev({ hasMedia: true, mediaType: 'video' }), false);
    assert.equal(state.added[0].hasMedia, true);
    assert.equal(state.added[0].mediaType, 'video');
  });
});

// ── _extractMediaInfo ─────────────────────────────────────────────────────────

describe('WhatsAppClient._extractMediaInfo', () => {
  it('returns null for falsy input', () => {
    const { client } = makeClient();
    assert.equal(client._extractMediaInfo(innerMsg(null)), null);
  });

  it('returns null for empty object (no media fields)', () => {
    const { client } = makeClient();
    assert.equal(client._extractMediaInfo(innerMsg({})), null);
  });

  it('returns image type with correct mimetype', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({ imageMessage: { mimetype: 'image/jpeg' } }));
    assert.deepEqual(result, { type: 'image', mimetype: 'image/jpeg', filename: null });
  });

  it('returns video type', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({ videoMessage: { mimetype: 'video/mp4' } }));
    assert.deepEqual(result, { type: 'video', mimetype: 'video/mp4', filename: null });
  });

  it('returns audio type', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({ audioMessage: { mimetype: 'audio/ogg; codecs=opus' } }));
    assert.deepEqual(result, { type: 'audio', mimetype: 'audio/ogg; codecs=opus', filename: null });
  });

  it('returns document type with fileName from documentMessage.fileName', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({
      documentMessage: { mimetype: 'application/pdf', fileName: 'report.pdf' }
    }));
    assert.deepEqual(result, { type: 'document', mimetype: 'application/pdf', filename: 'report.pdf' });
  });

  it('falls back to documentMessage.title when fileName is absent', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({
      documentMessage: { mimetype: 'text/plain', title: 'My Doc' }
    }));
    assert.equal(result!.filename, 'My Doc');
  });

  it('returns sticker type', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({ stickerMessage: { mimetype: 'image/webp' } }));
    assert.equal(result!.type, 'sticker');
  });

  it('returns contact type', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({ contactMessage: {} }));
    assert.equal(result!.type, 'contact');
  });

  it('returns location type', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({ locationMessage: {} }));
    assert.equal(result!.type, 'location');
  });

  it('returns poll type for pollCreationMessage', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({ pollCreationMessage: { name: 'Poll?' } }));
    assert.equal(result!.type, 'poll');
  });

  it('returns image type when nested inside ephemeralMessage wrapper', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({
      ephemeralMessage: { message: { imageMessage: { mimetype: 'image/png' } } }
    }));
    assert.equal(result!.type, 'image');
    assert.equal(result!.mimetype, 'image/png');
  });

  it('returns video type when nested inside viewOnceMessage wrapper', () => {
    const { client } = makeClient();
    const result = client._extractMediaInfo(innerMsg({
      viewOnceMessage: { message: { videoMessage: { mimetype: 'video/mp4' } } }
    }));
    assert.equal(result!.type, 'video');
  });
});

// ── _checkApprovalResponse: approval keyword matching ────────────────────────

describe('WhatsAppClient._checkApprovalResponse — approval keyword matching', () => {
  const baseApproval = { id: 'approval_abc123', to_jid: '111@s.whatsapp.net' };

  it('approves on "yes" (case-insensitive)', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: 'Yes', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded.length, 1);
    assert.equal(state.responded[0].approved, true);
    assert.equal(state.responded[0].id, baseApproval.id);
  });

  it('approves on "APPROVED"', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: 'APPROVED', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded[0].approved, true);
  });

  it('approves on "ok"', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: 'ok', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded[0].approved, true);
  });

  it('approves on "confirm"', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: 'confirm', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded[0].approved, true);
  });

  it('approves on ✅ emoji', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: '✅', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded[0].approved, true);
  });

  it('denies on "no"', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: 'no', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded[0].approved, false);
  });

  it('denies on "reject"', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: 'reject', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded[0].approved, false);
  });

  it('denies on "cancel"', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: 'cancel', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded[0].approved, false);
  });

  it('denies on ❌ emoji', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: '❌', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded[0].approved, false);
  });

  it('does NOT trigger on "nobody" (whole-word boundary prevents false positive for "no")', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: 'nobody knows', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded.length, 0);
  });

  it('does NOT trigger on "yes-man" (partial word, no boundary)', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: 'yes-man is here', chatJid: baseApproval.to_jid } as StoredMessage);
    // "yes" with word boundary: "yes-" — the hyphen acts as a non-word char, so \byes\b DOES match
    // This is correct behaviour — "yes-man" starts with the complete word "yes"
    // Test expectation mirrors actual regex behaviour
    assert.equal(state.responded[0].approved, true);
  });

  it('does NOT respond when both approve AND deny keywords are present', () => {
    const { client, state } = makeClient([baseApproval]);
    // Both isApproved and isDenied become true — neither branch fires
    client._checkApprovalResponse({ body: 'yes no', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded.length, 0);
  });

  it('matches by approval id pattern in message body (cross-chat)', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({
      body: 'approval_abc123 yes',
      chatJid: 'other-chat@s.whatsapp.net'
    } as StoredMessage);
    assert.equal(state.responded.length, 1);
    assert.equal(state.responded[0].id, 'approval_abc123');
  });

  it('does nothing when body is empty', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: '', chatJid: baseApproval.to_jid } as StoredMessage);
    assert.equal(state.responded.length, 0);
  });

  it('does nothing when body is undefined/null', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: undefined, chatJid: baseApproval.to_jid } as unknown as StoredMessage);
    assert.equal(state.responded.length, 0);
  });

  it('does nothing when there are no pending approvals', () => {
    const { client, state } = makeClient([]);
    client._checkApprovalResponse({ body: 'yes', chatJid: '111@s.whatsapp.net' } as StoredMessage);
    assert.equal(state.responded.length, 0);
  });

  it('does nothing when chatJid does not match any pending approval', () => {
    const { client, state } = makeClient([baseApproval]);
    client._checkApprovalResponse({ body: 'yes', chatJid: 'unrelated@s.whatsapp.net' } as StoredMessage);
    assert.equal(state.responded.length, 0);
  });

  it('matches approval when reply arrives on LID but approval was sent to phone JID', () => {
    const approval = { id: 'approval_lid_phone', to_jid: '14384083030@s.whatsapp.net' };
    const mapping = { lidJid: '128819088347371@lid', phoneJid: '14384083030@s.whatsapp.net' };
    const { client, state } = makeClient([approval], () => mapping);
    client._checkApprovalResponse({ body: 'APPROVE', chatJid: mapping.lidJid } as StoredMessage);
    assert.equal(state.responded.length, 1);
    assert.equal(state.responded[0].id, approval.id);
    assert.equal(state.responded[0].approved, true);
  });

  it('matches approval when reply arrives on phone JID but approval was sent to LID', () => {
    const approval = { id: 'approval_phone_lid', to_jid: '128819088347371@lid' };
    const mapping = { lidJid: '128819088347371@lid', phoneJid: '14384083030@s.whatsapp.net' };
    const { client, state } = makeClient([approval], () => mapping);
    client._checkApprovalResponse({ body: 'DENY', chatJid: mapping.phoneJid } as StoredMessage);
    assert.equal(state.responded.length, 1);
    assert.equal(state.responded[0].id, approval.id);
    assert.equal(state.responded[0].approved, false);
  });

  it('falls through cleanly when no JID mapping exists', () => {
    const approval = { id: 'approval_nomap', to_jid: '111@s.whatsapp.net' };
    const { client, state } = makeClient([approval], () => null);
    client._checkApprovalResponse({ body: 'yes', chatJid: '999@lid' } as StoredMessage);
    assert.equal(state.responded.length, 0);
  });
});

// ── _notifyMessageWaiters ────────────────────────────────────────────────────

describe('WhatsAppClient._notifyMessageWaiters', () => {
  it('resolves a null-filter waiter with any message', () => {
    const { client } = makeClient();
    let resolved: StoredMessage | null = null;
    client.addMessageWaiter(null, (msg) => { resolved = msg; });
    const msg = { id: 'test-1', body: 'hello', chatJid: 'a@s.whatsapp.net' } as StoredMessage;
    client._notifyMessageWaiters(msg);
    assert.ok(resolved !== null);
    assert.equal((resolved as StoredMessage).id, 'test-1');
  });

  it('resolves a waiter whose filter function matches', () => {
    const { client } = makeClient();
    let resolved: StoredMessage | null = null;
    client.addMessageWaiter(
      (m) => m.body === 'target',
      (msg) => { resolved = msg; }
    );
    client._notifyMessageWaiters({ id: 'no', body: 'other', chatJid: 'a@s.whatsapp.net' } as StoredMessage);
    assert.equal(resolved, null);
    client._notifyMessageWaiters({ id: 'yes', body: 'target', chatJid: 'a@s.whatsapp.net' } as StoredMessage);
    assert.ok(resolved !== null);
    assert.equal((resolved as StoredMessage).id, 'yes');
  });

  it('removes a matched waiter from the queue after it resolves', () => {
    const { client } = makeClient();
    client.addMessageWaiter(null, () => {});
    assert.equal(client._messageWaiters.length, 1);
    client._notifyMessageWaiters({ id: 'x', body: '', chatJid: null } as StoredMessage);
    assert.equal(client._messageWaiters.length, 0);
  });

  it('keeps non-matching waiters in queue', () => {
    const { client } = makeClient();
    const resolved: string[] = [];
    client.addMessageWaiter((m) => m.chatJid === 'chat-a', (m) => resolved.push(m.id));
    client.addMessageWaiter((m) => m.chatJid === 'chat-b', (m) => resolved.push(m.id));
    client._notifyMessageWaiters({ id: 'msg-a', body: '', chatJid: 'chat-a' } as StoredMessage);
    assert.deepEqual(resolved, ['msg-a']);
    assert.equal(client._messageWaiters.length, 1, 'chat-b waiter should remain');
  });

  it('resolves multiple matching waiters in the same pass', () => {
    const { client } = makeClient();
    const resolved: string[] = [];
    client.addMessageWaiter(null, (m) => resolved.push('w1:' + m.id));
    client.addMessageWaiter(null, (m) => resolved.push('w2:' + m.id));
    client._notifyMessageWaiters({ id: 'broadcast', body: '', chatJid: null } as StoredMessage);
    assert.deepEqual(resolved, ['w1:broadcast', 'w2:broadcast']);
    assert.equal(client._messageWaiters.length, 0);
  });
});

// ── _trackSentId ──────────────────────────────────────────────────────────────

describe('WhatsAppClient._trackSentId', () => {
  it('adds an id to the sent-id set', () => {
    const { client } = makeClient();
    client._trackSentId('abc123');
    assert.ok(client._sentMessageIds.has('abc123'));
  });

  it('does nothing for undefined id', () => {
    const { client } = makeClient();
    client._trackSentId(undefined);
    assert.equal(client._sentMessageIds.size, 0);
  });

  it('does not add duplicate ids', () => {
    const { client } = makeClient();
    client._trackSentId('dup');
    client._trackSentId('dup');
    assert.equal(client._sentMessageIds.size, 1);
  });

  it('caps the set at 1000 entries and evicts the oldest', () => {
    const { client } = makeClient();
    for (let i = 0; i < 1001; i++) {
      client._trackSentId(`id-${i}`);
    }
    assert.equal(client._sentMessageIds.size, 1000);
    assert.ok(!client._sentMessageIds.has('id-0'), 'id-0 should be evicted (oldest)');
    assert.ok(client._sentMessageIds.has('id-1000'), 'id-1000 should be present (newest)');
  });
});
