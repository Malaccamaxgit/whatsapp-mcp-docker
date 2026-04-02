/**
 * SQLite Message Store
 *
 * Persists messages, chats, contacts, and approval requests to SQLite.
 * Includes FTS5 full-text search for the search_messages tool.
 * Supports opt-in field-level encryption (DATA_ENCRYPTION_KEY).
 * Supports auto-purge of old messages (MESSAGE_RETENTION_DAYS).
 * All data survives container restarts via volume mount.
 */

import Database from 'better-sqlite3';
import { unlinkSync } from 'node:fs';
import { encrypt, decrypt, isEncryptionEnabled } from '../security/crypto.js';

export class MessageStore {
  constructor(dbPath) {
    this.dbPath = dbPath || process.env.STORE_DB_PATH || '/data/store/messages.db';
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._migrate();
    this._prepareStatements();

    this._purgeTimer = null;
  }

  // ── Schema & Migration ──────────────────────────────────────

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        jid TEXT PRIMARY KEY,
        name TEXT,
        is_group INTEGER DEFAULT 0,
        unread_count INTEGER DEFAULT 0,
        last_message_at INTEGER,
        last_message_preview TEXT,
        updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_jid TEXT NOT NULL,
        sender_jid TEXT,
        sender_name TEXT,
        body TEXT,
        timestamp INTEGER NOT NULL,
        is_from_me INTEGER DEFAULT 0,
        is_read INTEGER DEFAULT 0,
        has_media INTEGER DEFAULT 0,
        media_type TEXT,
        media_mimetype TEXT,
        media_filename TEXT,
        media_local_path TEXT,
        media_raw_json TEXT,
        FOREIGN KEY (chat_jid) REFERENCES chats(jid)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat_ts
      ON messages(chat_jid, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_messages_unread
      ON messages(is_read, timestamp DESC);

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        to_jid TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        status TEXT DEFAULT 'pending',
        response_text TEXT,
        created_at INTEGER NOT NULL,
        timeout_ms INTEGER NOT NULL,
        responded_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_approvals_status
      ON approvals(status, created_at DESC);
    `);

    // Drop FTS triggers — we manage FTS from application code so that
    // plaintext goes into the search index even when bodies are encrypted.
    try {
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_insert');
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_delete');
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_update');
    } catch (error) {
      console.error('[STORE] Error dropping FTS triggers:', error.message);
    }

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
        USING fts5(body, content=messages, content_rowid=rowid);
      `);
    } catch (e) {
      console.error('[STORE] FTS5 setup warning:', e.message);
    }

    try {
      this.db.exec('ALTER TABLE messages ADD COLUMN media_mimetype TEXT');
      this.db.exec('ALTER TABLE messages ADD COLUMN media_filename TEXT');
      this.db.exec('ALTER TABLE messages ADD COLUMN media_local_path TEXT');
      this.db.exec('ALTER TABLE messages ADD COLUMN media_raw_json TEXT');
    } catch (error) {
      console.error('[STORE] Schema migration note:', error.message);
    }

    const enc = isEncryptionEnabled() ? 'ON' : 'OFF';
    console.error(`[STORE] Database migrated at ${this.dbPath} (encryption: ${enc})`);
  }

  _prepareStatements() {
    this._upsertChat = this.db.prepare(`
      INSERT INTO chats (jid, name, is_group, last_message_at, last_message_preview, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(jid) DO UPDATE SET
        name = COALESCE(excluded.name, chats.name),
        last_message_at = MAX(COALESCE(excluded.last_message_at, 0), COALESCE(chats.last_message_at, 0)),
        last_message_preview = CASE
          WHEN COALESCE(excluded.last_message_at, 0) > COALESCE(chats.last_message_at, 0)
          THEN excluded.last_message_preview
          ELSE chats.last_message_preview
        END,
        updated_at = unixepoch()
    `);

    this._insertMessage = this.db.prepare(`
      INSERT OR IGNORE INTO messages (id, chat_jid, sender_jid, sender_name, body, timestamp, is_from_me, has_media, media_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this._insertFts = this.db.prepare('INSERT INTO messages_fts(rowid, body) VALUES (?, ?)');

    this._insertApproval = this.db.prepare(`
      INSERT INTO approvals (id, to_jid, action, details, status, created_at, timeout_ms)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `);

    this._updateApproval = this.db.prepare(`
      UPDATE approvals SET status = ?, response_text = ?, responded_at = ?
      WHERE id = ? AND status = 'pending'
    `);
  }

  // ── Decrypt helpers ─────────────────────────────────────────

  _decryptRow(row) {
    if (!row) return row;
    if (row.body) row.body = decrypt(row.body);
    if (row.sender_name) row.sender_name = decrypt(row.sender_name);
    if (row.media_raw_json) row.media_raw_json = decrypt(row.media_raw_json);
    if (row.last_message_preview) row.last_message_preview = decrypt(row.last_message_preview);
    if (row.action) row.action = decrypt(row.action);
    if (row.details) row.details = decrypt(row.details);
    if (row.response_text) row.response_text = decrypt(row.response_text);
    return row;
  }

  _decryptRows(rows) {
    for (const row of rows) this._decryptRow(row);
    return rows;
  }

  /**
   * Escape special FTS5 syntax characters in search queries
   * FTS5 special chars: " * ( ) + - : ^ ~
   * @param {string} query - Raw search query
   * @returns {string} - Escaped query safe for FTS5 MATCH
   */
  _escapeFts5Query(query) {
    if (!query) return '';
    // Escape special FTS5 characters by prefixing with backslash
    return query.replace(/(["*()+\-:^~])/g, '\\$1');
  }

  // ── Chat Operations ──────────────────────────────────────────

  upsertChat(jid, name, isGroup, lastMessageAt, lastMessagePreview) {
    const encPreview = encrypt(lastMessagePreview || null);
    this._upsertChat.run(jid, name, isGroup ? 1 : 0, lastMessageAt || null, encPreview);
  }

  listChats({ filter, groupsOnly, limit = 20, offset = 0 } = {}) {
    let sql = 'SELECT * FROM chats WHERE 1=1';
    const params = [];

    if (filter) {
      sql += ' AND name LIKE ?';
      params.push(`%${filter}%`);
    }
    if (groupsOnly) {
      sql += ' AND is_group = 1';
    }

    sql += ' ORDER BY last_message_at DESC NULLS LAST LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this._decryptRows(this.db.prepare(sql).all(...params));
  }

  getChatByJid(jid) {
    return this._decryptRow(this.db.prepare('SELECT * FROM chats WHERE jid = ?').get(jid));
  }

  getAllChatsForMatching() {
    return this.db.prepare('SELECT jid, name FROM chats ORDER BY last_message_at DESC').all();
  }

  incrementUnread(chatJid) {
    this.db.prepare('UPDATE chats SET unread_count = unread_count + 1 WHERE jid = ?').run(chatJid);
  }

  clearUnread(chatJid) {
    this.db.prepare('UPDATE chats SET unread_count = 0 WHERE jid = ?').run(chatJid);
  }

  // ── Message Operations ───────────────────────────────────────

  addMessage(msg) {
    const plaintextBody = msg.body || '';
    const preview = msg.body ? msg.body.substring(0, 100) : msg.hasMedia ? '[media]' : '';

    // Upsert chat first — messages.chat_jid has a FK reference to chats.jid,
    // and SQLite's ON CONFLICT clause does not apply to FK violations.
    if (msg.chatJid) {
      this.upsertChat(
        msg.chatJid,
        null,
        typeof msg.chatJid === 'string' && msg.chatJid.endsWith('@g.us'),
        msg.timestamp,
        preview
      );
    }

    const encBody = encrypt(msg.body);
    const encSenderName = encrypt(msg.senderName);

    const result = this._insertMessage.run(
      msg.id,
      msg.chatJid,
      msg.senderJid,
      encSenderName,
      encBody,
      msg.timestamp,
      msg.isFromMe ? 1 : 0,
      msg.hasMedia ? 1 : 0,
      msg.mediaType || null
    );

    if (result.changes > 0 && plaintextBody) {
      try {
        this._insertFts.run(result.lastInsertRowid, plaintextBody);
      } catch (err) {
        console.error('[STORE] FTS insert failed (best-effort):', err.message);
      }
    }

    if (!msg.isFromMe && msg.chatJid) {
      this.incrementUnread(msg.chatJid);
    }
  }

  listMessages({ chatJid, limit = 50, offset = 0, before, after } = {}) {
    let sql = 'SELECT * FROM messages WHERE chat_jid = ?';
    const params = [chatJid];

    if (before) {
      sql += ' AND timestamp < ?';
      params.push(before);
    }
    if (after) {
      sql += ' AND timestamp > ?';
      params.push(after);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this._decryptRows(
      this.db
        .prepare(sql)
        .all(...params)
        .reverse()
    );
  }

  getMessageContext(messageId, contextBefore = 3, contextAfter = 3) {
    const target = this._decryptRow(
      this.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId)
    );
    if (!target) return null;

    const before = this._decryptRows(
      this.db
        .prepare(
          'SELECT * FROM messages WHERE chat_jid = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?'
        )
        .all(target.chat_jid, target.timestamp, contextBefore)
        .reverse()
    );

    const after = this._decryptRows(
      this.db
        .prepare(
          'SELECT * FROM messages WHERE chat_jid = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?'
        )
        .all(target.chat_jid, target.timestamp, contextAfter)
    );

    return { before, message: target, after };
  }

  searchMessages({ query, chatJid, limit = 20, offset = 0 } = {}) {
    let sql = `
      SELECT m.* FROM messages_fts fts
      JOIN messages m ON m.rowid = fts.rowid
    `;
    const params = [];

    if (chatJid) {
      sql += ' WHERE m.chat_jid = ? AND fts.body MATCH ?';
      params.push(chatJid, this._escapeFts5Query(query));
    } else {
      sql += ' WHERE fts.body MATCH ?';
      params.push(this._escapeFts5Query(query));
    }

    sql += ' ORDER BY m.timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    try {
      return this._decryptRows(this.db.prepare(sql).all(...params));
    } catch (e) {
      if (e.message.includes('fts5')) {
        const fallback = this.db
          .prepare(
            `SELECT * FROM messages WHERE body LIKE ? ${chatJid ? 'AND chat_jid = ?' : ''} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
          )
          .all(
            ...(chatJid ? [`%${query}%`, chatJid, limit, offset] : [`%${query}%`, limit, offset])
          );
        return this._decryptRows(fallback);
      }
      throw e;
    }
  }

  getUnreadMessages(limit = 100) {
    return this._decryptRows(
      this.db
        .prepare('SELECT * FROM messages WHERE is_read = 0 ORDER BY timestamp DESC LIMIT ?')
        .all(limit)
        .reverse()
    );
  }

  markRead({ chatJid, messageIds }) {
    if (messageIds?.length) {
      const placeholders = messageIds.map(() => '?').join(',');
      const stmt = this.db.prepare(`UPDATE messages SET is_read = 1 WHERE id IN (${placeholders})`);
      const result = stmt.run(...messageIds);
      return result.changes;
    }
    if (chatJid) {
      const result = this.db
        .prepare('UPDATE messages SET is_read = 1 WHERE chat_jid = ? AND is_read = 0')
        .run(chatJid);
      this.clearUnread(chatJid);
      return result.changes;
    }
    return 0;
  }

  // ── Approval Operations ──────────────────────────────────────

  createApproval({ toJid, action, details, timeoutMs = 300_000 }) {
    const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const createdAt = Date.now();
    this._insertApproval.run(id, toJid, encrypt(action), encrypt(details), createdAt, timeoutMs);
    return { id, to_jid: toJid, action, details, status: 'pending', created_at: createdAt, timeout_ms: timeoutMs };
  }

  respondToApproval(id, approved, responseText) {
    this._expireTimedOut();
    const result = this._updateApproval.run(
      approved ? 'approved' : 'denied',
      encrypt(responseText || null),
      Date.now(),
      id
    );
    return result.changes > 0;
  }

  getApproval(id) {
    this._expireTimedOut();
    return this._decryptRow(this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id));
  }

  getPendingApprovals() {
    this._expireTimedOut();
    return this._decryptRows(
      this.db
        .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at DESC")
        .all()
    );
  }

  _expireTimedOut() {
    this.db
      .prepare(
        `
      UPDATE approvals
      SET status = 'expired'
      WHERE status = 'pending'
        AND (created_at + timeout_ms) < ?
    `
      )
      .run(Date.now());
  }

  // ── Contact / Chat Lookup ────────────────────────────────────

  getContactChats(jid, limit = 20, offset = 0) {
    return this._decryptRows(
      this.db
        .prepare(
          `
      SELECT DISTINCT c.*
      FROM chats c
      JOIN messages m ON m.chat_jid = c.jid
      WHERE m.sender_jid = ? OR c.jid = ?
      ORDER BY c.last_message_at DESC
      LIMIT ? OFFSET ?
    `
        )
        .all(jid, jid, limit, offset)
    );
  }

  /**
   * Export complete chat history for a specific JID.
   * Supports PIPEDA individual access rights.
   * @param {string} jid - Chat JID to export
   * @param {string} format - Export format: 'json' or 'csv' (default: 'json')
   * @returns {object} Exported data with metadata
   */
  exportChatData(jid, format = 'json') {
    const chat = this.getChatByJid(jid);
    if (!chat) {
      return { error: 'Chat not found', jid, format };
    }

    const messages = this.listMessages({ chatJid: jid, limit: 10000, offset: 0 });

    if (format === 'csv') {
      const headers = ['id', 'timestamp', 'sender_jid', 'sender_name', 'body', 'is_from_me', 'has_media', 'media_type'];
      const rows = messages.map((m) =>
        [
          m.id,
          new Date(m.timestamp * 1000).toISOString(),
          m.sender_jid || '',
          (m.sender_name || '').replace(/"/g, '""'),
          (m.body || '').replace(/"/g, '""'),
          m.is_from_me ? 1 : 0,
          m.has_media ? 1 : 0,
          m.media_type || ''
        ].join(',')
      );
      return {
        format: 'csv',
        jid,
        chatName: chat.name,
        exportedAt: new Date().toISOString(),
        messageCount: messages.length,
        data: [headers.join(','), ...rows].join('\n')
      };
    }

    // JSON format (default)
    return {
      format: 'json',
      jid,
      chatName: chat.name,
      isGroup: chat.is_group === 1,
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map((m) => ({
        id: m.id,
        timestamp: new Date(m.timestamp * 1000).toISOString(),
        sender: {
          jid: m.sender_jid,
          name: m.sender_name
        },
        body: m.body,
        isFromMe: m.is_from_me === 1,
        hasMedia: m.has_media === 1,
        mediaType: m.media_type
      }))
    };
  }

  getLastInteraction(jid) {
    return this._decryptRow(
      this.db
        .prepare(
          `
      SELECT m.*, c.name as chat_name
      FROM messages m
      JOIN chats c ON c.jid = m.chat_jid
      WHERE m.sender_jid = ? OR m.chat_jid = ?
      ORDER BY m.timestamp DESC
      LIMIT 1
    `
        )
        .get(jid, jid)
    );
  }

  updateChatName(jid, name) {
    if (!name) return;
    this.db
      .prepare('UPDATE chats SET name = ? WHERE jid = ? AND (name IS NULL OR name = jid)')
      .run(name, jid);
  }

  // ── Media Operations ─────────────────────────────────────────

  updateMediaInfo(messageId, { mimetype, filename, localPath, rawJson }) {
    this.db
      .prepare(
        `
      UPDATE messages SET
        media_mimetype = COALESCE(?, media_mimetype),
        media_filename = COALESCE(?, media_filename),
        media_local_path = COALESCE(?, media_local_path),
        media_raw_json = COALESCE(?, media_raw_json)
      WHERE id = ?
    `
      )
      .run(
        mimetype || null,
        filename || null,
        localPath || null,
        rawJson ? encrypt(rawJson) : null,
        messageId
      );
  }

  getMediaMessages(chatJid, limit = 20, offset = 0) {
    let sql = 'SELECT * FROM messages WHERE has_media = 1';
    const params = [];
    if (chatJid) {
      sql += ' AND chat_jid = ?';
      params.push(chatJid);
    }
    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return this._decryptRows(this.db.prepare(sql).all(...params));
  }

  // ── Stats ────────────────────────────────────────────────────

  getStats() {
    const chatCount = this.db.prepare('SELECT COUNT(*) as count FROM chats').get().count;
    const messageCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    const unreadCount = this.db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE is_read = 0')
      .get().count;
    const pendingApprovals = this.db
      .prepare("SELECT COUNT(*) as count FROM approvals WHERE status = 'pending'")
      .get().count;
    const lastSync = this.db.prepare('SELECT MAX(timestamp) as ts FROM messages').get().ts;

    return { chatCount, messageCount, unreadCount, pendingApprovals, lastSync };
  }

  // ── Catch-Up Summary ─────────────────────────────────────────

  getCatchUpData(sinceTimestamp) {
    const activeChats = this._decryptRows(
      this.db
        .prepare(
          `
      SELECT c.jid, c.name, c.is_group, c.unread_count,
             COUNT(m.id) as recent_messages
      FROM chats c
      LEFT JOIN messages m ON m.chat_jid = c.jid AND m.timestamp > ?
      WHERE c.last_message_at > ?
      GROUP BY c.jid
      ORDER BY c.last_message_at DESC
      LIMIT 20
    `
        )
        .all(sinceTimestamp, sinceTimestamp)
    );

    const recentUnread = this._decryptRows(
      this.db
        .prepare(
          `
      SELECT m.*, c.name as chat_name
      FROM messages m
      JOIN chats c ON c.jid = m.chat_jid
      WHERE m.is_read = 0 AND m.timestamp > ? AND m.is_from_me = 0
      ORDER BY m.timestamp DESC
      LIMIT 50
    `
        )
        .all(sinceTimestamp)
    );

    const questions = recentUnread.filter((m) => m.body && m.body.includes('?'));

    const pendingApprovals = this.getPendingApprovals();

    return { activeChats, recentUnread, questions, pendingApprovals };
  }

  // ── Auto-Purge ──────────────────────────────────────────────

  /**
   * Delete messages and media older than retentionDays.
   * Returns { messagesDeleted, mediaFilesDeleted, approvalsDeleted }.
   */
  purgeOldData(retentionDays) {
    if (!retentionDays || retentionDays <= 0) return null;

    const cutoffTs = Math.floor(Date.now() / 1000) - retentionDays * 86400;
    const cutoffMs = Date.now() - retentionDays * 86400_000;

    const mediaRows = this.db
      .prepare(
        'SELECT media_local_path FROM messages WHERE timestamp < ? AND media_local_path IS NOT NULL'
      )
      .all(cutoffTs);

    const msgResult = this.db.prepare('DELETE FROM messages WHERE timestamp < ?').run(cutoffTs);
    const apprResult = this.db.prepare('DELETE FROM approvals WHERE created_at < ?').run(cutoffMs);

    let mediaFilesDeleted = 0;
    if (mediaRows.length > 0) {
      for (const row of mediaRows) {
        try {
          unlinkSync(row.media_local_path);
          mediaFilesDeleted++;
        } catch {
          /* file already gone */
        }
      }
    }

    if (msgResult.changes > 0) {
      console.error(
        `[PURGE] Deleted ${msgResult.changes} messages, ` +
          `${mediaRows.length} media files, ` +
          `${apprResult.changes} approvals ` +
          `(older than ${retentionDays} days)`
      );
    }

    return {
      messagesDeleted: msgResult.changes,
      mediaFilesDeleted: mediaRows.length,
      approvalsDeleted: apprResult.changes
    };
  }

  /**
   * Start the auto-purge timer.
   * Runs immediately on start, then every intervalMs (default 1 hour).
   */
  startAutoPurge(retentionDays, intervalMs = 3600_000) {
    if (!retentionDays || retentionDays <= 0) return;

    console.error(
      `[PURGE] Auto-purge enabled: ${retentionDays}-day retention, checking every ${Math.round(intervalMs / 60000)} min`
    );
    this.purgeOldData(retentionDays);

    this._purgeTimer = setInterval(() => {
      this.purgeOldData(retentionDays);
    }, intervalMs);

    if (this._purgeTimer.unref) {
      this._purgeTimer.unref();
    }
  }

  close() {
    if (this._purgeTimer) {
      clearInterval(this._purgeTimer);
      this._purgeTimer = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
