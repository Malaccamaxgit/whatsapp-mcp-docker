/**
 * MessageStore — poll short name table
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initEncryption } from '../../src/security/crypto.js';
import { MessageStore } from '../../src/whatsapp/store.js';

describe('MessageStore poll short names', () => {
  let store: MessageStore;

  before(() => {
    initEncryption(null);
    store = new MessageStore(':memory:');
  });

  after(() => {
    store.close();
  });

  it('upserts and resolves short_name per chat', () => {
    const jid = '120363040001@g.us';
    assert.equal(store.getPollMessageIdByShortName(jid, 'vote1'), null);

    store.upsertPollShortName({ chatJid: jid, shortName: 'vote1', pollMessageId: 'msg-a' });
    assert.equal(store.getPollMessageIdByShortName(jid, 'vote1'), 'msg-a');

    store.upsertPollShortName({ chatJid: jid, shortName: 'vote1', pollMessageId: 'msg-b' });
    assert.equal(store.getPollMessageIdByShortName(jid, 'vote1'), 'msg-b');
  });

  it('scopes short names to chat_jid', () => {
    store.upsertPollShortName({
      chatJid: '111@g.us',
      shortName: 'same',
      pollMessageId: 'm1'
    });
    store.upsertPollShortName({
      chatJid: '222@g.us',
      shortName: 'same',
      pollMessageId: 'm2'
    });
    assert.equal(store.getPollMessageIdByShortName('111@g.us', 'same'), 'm1');
    assert.equal(store.getPollMessageIdByShortName('222@g.us', 'same'), 'm2');
  });

  it('lists registrations for a chat', () => {
    const jid = '120363040002@g.us';
    store.upsertPollShortName({ chatJid: jid, shortName: 'a', pollMessageId: 'x1' });
    store.upsertPollShortName({ chatJid: jid, shortName: 'b', pollMessageId: 'x2' });
    const rows = store.listPollShortNamesForChat(jid);
    assert.equal(rows.length, 2);
    const names = rows.map((r) => r.short_name).sort();
    assert.deepEqual(names, ['a', 'b']);
  });
});
