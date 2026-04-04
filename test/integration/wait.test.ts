/**
 * Integration tests for wait_for_message tool
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers/test-server.js';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';
import type { WhatsAppClient } from '../../src/whatsapp/client.js';

const CHAT_JID = '15145551234@s.whatsapp.net';
const SENDER_JID = '15145551234@s.whatsapp.net';

type MockMessage = {
  id: string;
  chatJid: string;
  senderJid: string;
  senderName: string;
  body: string;
  timestamp: number;
  isFromMe: boolean;
  hasMedia: boolean;
  mediaType: string | null;
};

function makeMsg(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    chatJid: CHAT_JID,
    senderJid: SENDER_JID,
    senderName: 'Alice',
    body: 'Hello from phone!',
    timestamp: Math.floor(Date.now() / 1000),
    isFromMe: false,
    hasMedia: false,
    mediaType: null,
    ...overrides
  };
}

describe('wait_for_message (integration)', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  before(async () => {
    initEncryption(null);
    const store = new MessageStore(':memory:');
    store.upsertChat(CHAT_JID, 'Alice', false, 1000, 'Hey');
    ctx = await createTestServer({ store });
  });

  after(async () => {
    if (ctx) await ctx.cleanup();
  });

  it('returns immediately when a message arrives before timeout', async () => {
    const waitPromise = ctx.client.callTool({
      name: 'wait_for_message',
      arguments: { timeout: 10 }
    });

    // Simulate incoming message after a short delay
    await new Promise((r) => setTimeout(r, 50));
    (ctx.waClient as unknown as { simulateIncomingMessage: (msg: MockMessage) => void }).simulateIncomingMessage(makeMsg());

    const result = await waitPromise;
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    assert.match(text, /Message received from Alice/);
    assert.match(text, /Hello from phone!/);
  });

  it('filters by chat JID', async () => {
    const OTHER_JID = '19999999999@s.whatsapp.net';
    const waitPromise = ctx.client.callTool({
      name: 'wait_for_message',
      arguments: { timeout: 10, chat: CHAT_JID }
    });

    await new Promise((r) => setTimeout(r, 50));

    // Wrong chat — should not resolve
    (ctx.waClient as unknown as { simulateIncomingMessage: (msg: MockMessage) => void }).simulateIncomingMessage(makeMsg({ chatJid: OTHER_JID, senderJid: OTHER_JID }));

    // Correct chat — should resolve
    await new Promise((r) => setTimeout(r, 30));
    (ctx.waClient as unknown as { simulateIncomingMessage: (msg: MockMessage) => void }).simulateIncomingMessage(makeMsg({ body: 'Correct chat message' }));

    const result = await waitPromise;
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Correct chat message/);
  });

  it('filters by chat name (fuzzy)', async () => {
    const waitPromise = ctx.client.callTool({
      name: 'wait_for_message',
      arguments: { timeout: 10, chat: 'Alice' }
    });

    await new Promise((r) => setTimeout(r, 50));
    (ctx.waClient as unknown as { simulateIncomingMessage: (msg: MockMessage) => void }).simulateIncomingMessage(makeMsg({ body: 'Named chat message' }));

    const result = await waitPromise;
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Named chat message/);
  });

  it('filters by from_phone', async () => {
    const waitPromise = ctx.client.callTool({
      name: 'wait_for_message',
      arguments: { timeout: 10, from_phone: '15145551234' }
    });

    await new Promise((r) => setTimeout(r, 50));
    (ctx.waClient as unknown as { simulateIncomingMessage: (msg: MockMessage) => void }).simulateIncomingMessage(makeMsg({ body: 'Sender filtered message' }));

    const result = await waitPromise;
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Sender filtered message/);
  });

  it('returns error when timeout expires', async () => {
    const result = await ctx.client.callTool({
      name: 'wait_for_message',
      arguments: { timeout: 1 }
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No message.*received within 1 second/);
  });

  it('returns error when not connected', async () => {
    (ctx.waClient as unknown as { _connected: boolean })._connected = false;
    try {
      const result = await ctx.client.callTool({
        name: 'wait_for_message',
        arguments: { timeout: 5 }
      });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /not connected/i);
    } finally {
      (ctx.waClient as unknown as { _connected: boolean })._connected = true;
      (ctx.waClient as unknown as { jid: string }).jid = '15145559999@s.whatsapp.net';
    }
  });

  it('reports media type when message has media', async () => {
    const waitPromise = ctx.client.callTool({
      name: 'wait_for_message',
      arguments: { timeout: 10 }
    });

    await new Promise((r) => setTimeout(r, 50));
    (ctx.waClient as unknown as { simulateIncomingMessage: (msg: MockMessage) => void }).simulateIncomingMessage(
      makeMsg({ body: '', hasMedia: true, mediaType: 'image' })
    );

    const result = await waitPromise;
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /yes \(image\)/);
  });
});
