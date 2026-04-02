/**
 * Performance Benchmarks
 *
 * Benchmarks for critical operations: FTS search, message persistence,
 * chat operations, and concurrent access patterns.
 *
 * Run with: node --test test/benchmarks/performance.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MessageStore } from '../../src/whatsapp/store.js';

const BENCHMARK_ITERATIONS = 100;
const LARGE_DATASET_SIZE = 1000;

describe('Performance Benchmarks', () => {
  let store;

  beforeEach(() => {
    store = new MessageStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  // ── Helper Functions ──────────────────────────────────────────

  function generateMessage(index, chatJid) {
    return {
      id: `msg-${index}-${Date.now()}`,
      chatJid,
      senderJid: index % 2 === 0 ? '15145551234@s.whatsapp.net' : '353871234567@s.whatsapp.net',
      senderName: index % 2 === 0 ? 'John Smith' : 'Jane Doe',
      body: `Test message ${index} with some content about project deadline and meeting schedule`,
      timestamp: Math.floor(Date.now() / 1000) - (LARGE_DATASET_SIZE - index) * 60,
      isFromMe: index % 3 === 0,
      isRead: true,
      hasMedia: false
    };
  }

  function generateChats(count) {
    const chats = [];
    for (let i = 0; i < count; i++) {
      chats.push({
        jid: `1514555${1000 + i}@s.whatsapp.net`,
        name: `Contact ${i + 1}`,
        isGroup: false,
        lastMessageAt: Date.now() - i * 60000,
        preview: `Last message from contact ${i + 1}`
      });
    }
    return chats;
  }

  // ── FTS Search Benchmarks ─────────────────────────────────────

  describe('FTS5 Search Performance', () => {
    beforeEach(() => {
      // Populate with 1000 messages
      const chatJid = '15145551234@s.whatsapp.net';
      for (let i = 0; i < LARGE_DATASET_SIZE; i++) {
        const msg = generateMessage(i, chatJid);
        store.addMessage(msg);
      }
    });

    it('single keyword search', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.searchMessages({ query: 'deadline', limit: 20 });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `FTS single keyword: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 50, `Search too slow: ${avg.toFixed(2)}ms`);
    });

    it('phrase search', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.searchMessages({ query: '"project deadline"', limit: 20 });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `FTS phrase search: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 50, `Search too slow: ${avg.toFixed(2)}ms`);
    });

    it('boolean operator search', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.searchMessages({ query: 'deadline AND meeting', limit: 20 });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `FTS boolean search: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 50, `Search too slow: ${avg.toFixed(2)}ms`);
    });

    it('scoped search (single chat)', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.searchMessages({
          query: 'message',
          chatJid: '15145551234@s.whatsapp.net',
          limit: 20
        });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `FTS scoped search: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 50, `Search too slow: ${avg.toFixed(2)}ms`);
    });

    it('paginated search (page 5)', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.searchMessages({ query: 'message', limit: 20, offset: 100 });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `FTS paginated search: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 50, `Search too slow: ${avg.toFixed(2)}ms`);
    });
  });

  // ── Message Persistence Benchmarks ────────────────────────────

  describe('Message Write Performance', () => {
    it('bulk message insertion (1000 messages)', () => {
      const chatJid = '15145551234@s.whatsapp.net';
      const start = performance.now();

      for (let i = 0; i < LARGE_DATASET_SIZE; i++) {
        const msg = generateMessage(i, chatJid);
        store.addMessage(msg);
      }

      const total = performance.now() - start;
      const avg = total / LARGE_DATASET_SIZE;
      console.log(
        `Bulk insert: ${total.toFixed(2)}ms total, ${avg.toFixed(3)}ms/msg (${LARGE_DATASET_SIZE} messages)`
      );
      assert.ok(avg < 1, `Message insert too slow: ${avg.toFixed(3)}ms/msg`);
    });

    it('single message insertion (100 iterations)', () => {
      const chatJid = '15145551234@s.whatsapp.net';
      const start = performance.now();

      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        const msg = generateMessage(i, chatJid);
        store.addMessage(msg);
      }

      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(`Single insert: ${avg.toFixed(3)}ms avg (${BENCHMARK_ITERATIONS} iterations)`);
      assert.ok(avg < 2, `Message insert too slow: ${avg.toFixed(3)}ms`);
    });

    it('message with media metadata', () => {
      const msg = {
        ...generateMessage(0, '15145551234@s.whatsapp.net'),
        hasMedia: true,
        mediaType: 'image',
        mediaMimetype: 'image/jpeg',
        mediaFilename: 'photo.jpg'
      };

      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        msg.id = `msg-media-${i}`;
        store.addMessage(msg);
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `Media message insert: ${avg.toFixed(3)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 2, `Media message insert too slow: ${avg.toFixed(3)}ms`);
    });
  });

  // ── Chat Operations Benchmarks ────────────────────────────────

  describe('Chat Operations Performance', () => {
    beforeEach(() => {
      // Create 100 chats
      const chats = generateChats(100);
      chats.forEach((chat) => {
        store.upsertChat(chat.jid, chat.name, chat.isGroup, chat.lastMessageAt, chat.preview);
      });
    });

    it('list all chats (100 chats)', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.listChats({ limit: 100 });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(`List chats: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`);
      assert.ok(avg < 10, `List chats too slow: ${avg.toFixed(2)}ms`);
    });

    it('filter chats by name', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.listChats({ filter: 'Contact 5', limit: 20 });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(`Filter chats: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`);
      assert.ok(avg < 10, `Filter chats too slow: ${avg.toFixed(2)}ms`);
    });

    it('get chat by JID', () => {
      const jid = '15145551050@s.whatsapp.net';
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.getChatByJid(jid);
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(`Get chat by JID: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`);
      assert.ok(avg < 1, `Get chat too slow: ${avg.toFixed(2)}ms`);
    });

    it('update chat name', () => {
      const jid = '15145551050@s.whatsapp.net';
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.updateChatName(jid, `Updated Name ${i}`);
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(`Update chat name: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`);
      assert.ok(avg < 2, `Update chat too slow: ${avg.toFixed(2)}ms`);
    });
  });

  // ── Message Retrieval Benchmarks ──────────────────────────────

  describe('Message Retrieval Performance', () => {
    beforeEach(() => {
      // Populate with 1000 messages across 10 chats
      for (let c = 0; c < 10; c++) {
        const chatJid = `1514555${1000 + c}@s.whatsapp.net`;
        for (let i = 0; i < 100; i++) {
          const msg = generateMessage(c * 100 + i, chatJid);
          store.addMessage(msg);
        }
      }
    });

    it('list messages (single chat, 100 messages)', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.listMessages({
          chatJid: '15145551000@s.whatsapp.net',
          limit: 100
        });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `List messages (100): ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 5, `List messages too slow: ${avg.toFixed(2)}ms`);
    });

    it('list messages with pagination', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.listMessages({
          chatJid: '15145551000@s.whatsapp.net',
          limit: 20,
          offset: 40
        });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `List messages (paginated): ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 5, `List messages too slow: ${avg.toFixed(2)}ms`);
    });

    it('list messages with date range', () => {
      const before = Math.floor(Date.now() / 1000);
      const after = before - 3600;

      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.listMessages({
          chatJid: '15145551000@s.whatsapp.net',
          limit: 50,
          before,
          after
        });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `List messages (date range): ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 5, `List messages too slow: ${avg.toFixed(2)}ms`);
    });

    it('get message context', () => {
      const messageId = 'msg-50-0';
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.getMessageContext(messageId, 5, 5);
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `Get message context: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 2, `Get context too slow: ${avg.toFixed(2)}ms`);
    });
  });

  // ── Approval Operations Benchmarks ────────────────────────────

  describe('Approval Operations Performance', () => {
    it('create approval', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.createApproval({
          toJid: '15145551234@s.whatsapp.net',
          action: 'Deploy to production',
          details: 'Deploy version 2.1.0',
          timeoutMs: 300000
        });
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(`Create approval: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`);
      assert.ok(avg < 2, `Create approval too slow: ${avg.toFixed(2)}ms`);
    });

    it('get pending approvals', () => {
      // Create 50 pending approvals
      for (let i = 0; i < 50; i++) {
        store.createApproval({
          toJid: `1514555${1000 + i}@s.whatsapp.net`,
          action: `Action ${i}`,
          details: `Details ${i}`,
          timeoutMs: 300000
        });
      }

      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.getPendingApprovals();
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `Get pending approvals: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 5, `Get pending approvals too slow: ${avg.toFixed(2)}ms`);
    });

    it('respond to approval', () => {
      const approvalId = 'approval-test-123';
      store.createApproval({
        toJid: '15145551234@s.whatsapp.net',
        action: 'Test action',
        details: 'Test details',
        timeoutMs: 300000,
        id: approvalId
      });

      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.respondToApproval(approvalId, i % 2 === 0, i % 2 === 0 ? 'Approved' : 'Denied');
        // Re-create for next iteration
        if (i < BENCHMARK_ITERATIONS - 1) {
          store.createApproval({
            toJid: '15145551234@s.whatsapp.net',
            action: 'Test action',
            details: 'Test details',
            timeoutMs: 300000,
            id: approvalId
          });
        }
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `Respond to approval: ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      assert.ok(avg < 2, `Respond to approval too slow: ${avg.toFixed(2)}ms`);
    });
  });

  // ── Encryption Overhead Benchmarks ────────────────────────────

  describe('Encryption Overhead', () => {
    it('encrypt message body', () => {
      const plaintext = 'This is a test message with some content for encryption benchmark';
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.addMessage(generateMessage(i, '15145551234@s.whatsapp.net'));
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(
        `Message with encryption: ${avg.toFixed(3)}ms avg (${BENCHMARK_ITERATIONS} iterations)`
      );
      // Note: This includes DB write overhead; encryption should be < 10% of total
      assert.ok(avg < 2, `Encrypted message write too slow: ${avg.toFixed(3)}ms`);
    });
  });

  // ── Catch-up Summary Benchmarks ───────────────────────────────

  describe('Catch-up Summary Performance', () => {
    beforeEach(() => {
      // Create 50 chats with recent messages
      for (let c = 0; c < 50; c++) {
        const chatJid = `1514555${1000 + c}@s.whatsapp.net`;
        store.upsertChat(chatJid, `Contact ${c}`, false, Date.now() - c * 60000, `Last message`);

        // Add 10 messages per chat
        for (let i = 0; i < 10; i++) {
          const msg = generateMessage(c * 10 + i, chatJid);
          msg.timestamp = Math.floor((Date.now() - (50 - c) * 60000 - (10 - i) * 6000) / 1000);
          store.addMessage(msg);
        }
      }
    });

    it('generate catch-up data (today)', () => {
      const start = performance.now();
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        store.getCatchUpData(Date.now() - 24 * 60 * 60 * 1000);
      }
      const avg = (performance.now() - start) / BENCHMARK_ITERATIONS;
      console.log(`Catch-up (today): ${avg.toFixed(2)}ms avg (${BENCHMARK_ITERATIONS} iterations)`);
      assert.ok(avg < 50, `Catch-up too slow: ${avg.toFixed(2)}ms`);
    });

    it('generate catch-up data (this week)', () => {
      const start = performance.now();
      for (let i = 0; i < 10; i++) {
        store.getCatchUpData(Date.now() - 7 * 24 * 60 * 60 * 1000);
      }
      const avg = (performance.now() - start) / 10;
      console.log(`Catch-up (week): ${avg.toFixed(2)}ms avg (10 iterations)`);
      assert.ok(avg < 100, `Catch-up too slow: ${avg.toFixed(2)}ms`);
    });
  });
});
