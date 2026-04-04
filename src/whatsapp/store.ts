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

type ChatRow = {
  jid: string;
  name: string | null;
  is_group: number;
  unread_count: number;
  last_message_at: number | null;
  last_message_preview: string | null;
  updated_at: number;
};

type MessageRow = {
  id: string;
  chat_jid: string;
  sender_jid: string | null;
  sender_name: string | null;
  body: string | null;
  timestamp: number;
  is_from_me: number;
  is_read: number;
  has_media: number;
  media_type: string | null;
  media_mimetype: string | null;
  media_filename: string | null;
  media_local_path: string | null;
  media_raw_json: string | null;
};

type ApprovalRow = {
  id: string;
  to_jid: string;
  action: string | null;
  details: string | null;
  status: string;
  response_text: string | null;
  created_at: number;
  timeout_ms: number;
  responded_at: number | null;
};

export class MessageStore {
  db: Database.Database | null;
  private dbPath: string;
  private _purgeTimer: NodeJS.Timeout | null = null;

  // Prepared statements
  private _upsertChat!: Database.Statement;
  private _insertMessage!: Database.Statement;
  private _insertFts!: Database.Statement;
  private _insertApproval!: Database.Statement;
  private _updateApproval!: Database.Statement;

  constructor (dbPath?: string) {
    this.dbPath = dbPath || process.env.STORE_DB_PATH || '/data/store/messages.db';
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._migrate();
    this._prepareStatements();

    this._purgeTimer = null;
  }

  // ── Schema & Migration ──────────────────────────────────────

  private _migrate (): void {
    this.db!.exec(`
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
      this.db!.exec('DROP TRIGGER IF EXISTS messages_fts_insert');
      this.db!.exec('DROP TRIGGER IF EXISTS messages_fts_delete');
      this.db!.exec('DROP TRIGGER IF EXISTS messages_fts_update');
    } catch (error: unknown) {
      console.error('[STORE] Error dropping FTS triggers:', (error as Error).message);
    }

    try {
      this.db!.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
        USING fts5(body, content=messages, content_rowid=rowid);
      `);
    } catch (e: unknown) {
      console.error('[STORE] FTS5 setup warning:', (e as Error).message);
    }

    try {
      this.db!.exec('ALTER TABLE messages ADD COLUMN media_mimetype TEXT');
      this.db!.exec('ALTER TABLE messages ADD COLUMN media_filename TEXT');
      this.db!.exec('ALTER TABLE messages ADD COLUMN media_local_path TEXT');
      this.db!.exec('ALTER TABLE messages ADD COLUMN media_raw_json TEXT');
    } catch (error: unknown) {
      console.error('[STORE] Schema migration note:', (error as Error).message);
    }

    const enc = isEncryptionEnabled() ? 'ON' : 'OFF';
    console.error(`[STORE] Database migrated at ${this.dbPath} (encryption: ${enc})`);
  }

  private _prepareStatements (): void {
    this._upsertChat = this.db!.prepare(`
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

    this._insertMessage = this.db!.prepare(`
      INSERT OR IGNORE INTO messages (id, chat_jid, sender_jid, sender_name, body, timestamp, is_from_me, has_media, media_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this._insertFts = this.db!.prepare('INSERT INTO messages_fts(rowid, body) VALUES (?, ?)');

    this._insertApproval = this.db!.prepare(`
      INSERT INTO approvals (id, to_jid, action, details, status, created_at, timeout_ms)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `);

    this._updateApproval = this.db!.prepare(`
      UPDATE approvals SET status = ?, response_text = ?, responded_at = ?
      WHERE id = ? AND status = 'pending'
    `);
  }

  // ── Decrypt helpers ─────────────────────────────────────────

  private _decryptRow<T extends Record<string, unknown>> (row: unknown): T | null {
    if (!row || typeof row !== 'object') {return null;}
    const r = row as Record<string, unknown>;
    if (r['body']) {r['body'] = decrypt(r['body'] as string);}
    if (r['sender_name']) {r['sender_name'] = decrypt(r['sender_name'] as string);}
    if (r['media_raw_json']) {r['media_raw_json'] = decrypt(r['media_raw_json'] as string);}
    if (r['last_message_preview']) {r['last_message_preview'] = decrypt(r['last_message_preview'] as string);}
    if (r['action']) {r['action'] = decrypt(r['action'] as string);}
    if (r['details']) {r['details'] = decrypt(r['details'] as string);}
    if (r['response_text']) {r['response_text'] = decrypt(r['response_text'] as string);}
    return r as T;
  }

  private _decryptRows<T extends Record<string, unknown>> (rows: unknown[]): T[] {
    for (const row of rows) {this._decryptRow(row);}
    return rows as T[];
  }

  /**
   * Escape special FTS5 syntax characters in search queries
   * FTS5 special chars: " * ( ) + - : ^ ~
   * @param {string} query - Raw search query
   * @returns {string} - Escaped query safe for FTS5 MATCH
   */
  private _escapeFts5Query (query: string): string {
    if (!query) {return '';}
    // Backslashes must be escaped first, before they are introduced by
    // subsequent replacements, to avoid double-escaping.
    return query
      .replace(/\\/g, '\\\\')
      .replace(/(["*()+\-:^~])/g, '\\$1');
  }

  // ── Chat Operations ──────────────────────────────────────────

  public upsertChat (jid: string, name: string | null, isGroup: boolean, lastMessageAt: number | null, lastMessagePreview: string | null): void {
    const encPreview = encrypt(lastMessagePreview ?? '');
    this._upsertChat.run(jid, name, isGroup ? 1 : 0, lastMessageAt ?? null, encPreview);
  }

  public listChats ({ filter, groupsOnly, limit = 20, offset = 0 }: { filter?: string; groupsOnly?: boolean; limit?: number; offset?: number } = {}): ChatRow[] {
    let sql = 'SELECT * FROM chats WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter) {
      sql += ' AND name LIKE ?';
      params.push(`%${filter}%`);
    }
    if (groupsOnly) {
      sql += ' AND is_group = 1';
    }

    sql += ' ORDER BY last_message_at DESC NULLS LAST LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this._decryptRows(this.db!.prepare(sql).all(...params)) as ChatRow[];
  }

  public getChatByJid (jid: string): ChatRow | null {
    return this._decryptRow(this.db!.prepare('SELECT * FROM chats WHERE jid = ?').get(jid)) as ChatRow | null;
  }

  public getAllChatsForMatching (): { jid: string; name: string | null }[] {
    return this.db!.prepare('SELECT jid, name FROM chats ORDER BY last_message_at DESC').all() as { jid: string; name: string | null }[];
  }

  public incrementUnread (chatJid: string): void {
    this.db!.prepare('UPDATE chats SET unread_count = unread_count + 1 WHERE jid = ?').run(chatJid);
  }

  public clearUnread (chatJid: string): void {
    this.db!.prepare('UPDATE chats SET unread_count = 0 WHERE jid = ?').run(chatJid);
  }

  // ── Message Operations ───────────────────────────────────────

  public addMessage (msg: {
    id: string;
    chatJid: string | null;
    senderJid: string | null;
    senderName: string | null;
    body: string | null;
    timestamp: number;
    isFromMe: boolean;
    hasMedia: boolean;
    mediaType: string | null;
  }): void {
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

    const encBody = encrypt(msg.body ?? '');
    const encSenderName = encrypt(msg.senderName ?? '');

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
      } catch (err: unknown) {
        console.error('[STORE] FTS insert failed (best-effort):', (err as Error).message);
      }
    }

    if (!msg.isFromMe && msg.chatJid) {
      this.incrementUnread(msg.chatJid);
    }
  }

  public listMessages ({ chatJid, limit = 50, offset = 0, before, after }: { chatJid: string; limit?: number; offset?: number; before?: number; after?: number }): MessageRow[] {
    let sql = 'SELECT * FROM messages WHERE chat_jid = ?';
    const params: (string | number)[] = [chatJid];

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
      this.db!
        .prepare(sql)
        .all(...params)
        .reverse() as MessageRow[]
    );
  }

  public getMessageContext (messageId: string, contextBefore = 3, contextAfter = 3): { before: MessageRow[]; message: MessageRow | null; after: MessageRow[] } | null {
    const target = this._decryptRow(
      this.db!.prepare('SELECT * FROM messages WHERE id = ?').get(messageId)
    ) as MessageRow | null;
    if (!target) {return null;}

    const before = this._decryptRows(
      this.db!
        .prepare(
          'SELECT * FROM messages WHERE chat_jid = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?'
        )
        .all(target.chat_jid, target.timestamp, contextBefore)
        .reverse()
    ) as MessageRow[];

    const after = this._decryptRows(
      this.db!
        .prepare(
          'SELECT * FROM messages WHERE chat_jid = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?'
        )
        .all(target.chat_jid, target.timestamp, contextAfter)
    ) as MessageRow[];

    return { before, message: target, after };
  }

  public searchMessages ({ query, chatJid, limit = 20, offset = 0 }: { query: string; chatJid?: string; limit?: number; offset?: number }): MessageRow[] {
    let sql = `
      SELECT m.* FROM messages_fts fts
      JOIN messages m ON m.rowid = fts.rowid
    `;
    const params: (string | number)[] = [];

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
      return this._decryptRows(this.db!.prepare(sql).all(...params) as MessageRow[]);
    } catch (e: unknown) {
      if ((e as Error).message.includes('fts5')) {
        const fallback = this.db!
          .prepare(
            `SELECT * FROM messages WHERE body LIKE ? ${chatJid ? 'AND chat_jid = ?' : ''} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
          )
          .all(
            ...(chatJid ? [`%${query}%`, chatJid, limit, offset] : [`%${query}%`, limit, offset])
          ) as MessageRow[];
        return this._decryptRows(fallback);
      }
      throw e;
    }
  }

  public getUnreadMessages (limit = 100): MessageRow[] {
    return this._decryptRows(
      this.db!
        .prepare('SELECT * FROM messages WHERE is_read = 0 ORDER BY timestamp DESC LIMIT ?')
        .all(limit)
        .reverse() as MessageRow[]
    );
  }

  public markRead ({ chatJid, messageIds }: { chatJid?: string; messageIds?: string[] }): number {
    if (messageIds?.length) {
      const placeholders = messageIds.map(() => '?').join(',');
      const stmt = this.db!.prepare(`UPDATE messages SET is_read = 1 WHERE id IN (${placeholders})`);
      const result = stmt.run(...messageIds);
      return result.changes;
    }
    if (chatJid) {
      const result = this.db!
        .prepare('UPDATE messages SET is_read = 1 WHERE chat_jid = ? AND is_read = 0')
        .run(chatJid);
      this.clearUnread(chatJid);
      return result.changes;
    }
    return 0;
  }

  // ── Approval Operations ──────────────────────────────────────

  public createApproval ({ toJid, action, details, timeoutMs = 300_000 }: { toJid: string; action: string; details: string; timeoutMs?: number }): {
    id: string;
    to_jid: string;
    action: string;
    details: string;
    status: string;
    created_at: number;
    timeout_ms: number;
  } {
    const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const createdAt = Date.now();
    this._insertApproval.run(id, toJid, encrypt(action), encrypt(details), createdAt, timeoutMs);
    return { id, to_jid: toJid, action, details, status: 'pending', created_at: createdAt, timeout_ms: timeoutMs };
  }

  public respondToApproval (id: string, approved: boolean, responseText: string | null): boolean {
    this._expireTimedOut();
    const result = this._updateApproval.run(
      approved ? 'approved' : 'denied',
      encrypt(responseText ?? ''),
      Date.now(),
      id
    );
    return result.changes > 0;
  }

  public getApproval (id: string): ApprovalRow | null {
    this._expireTimedOut();
    return this._decryptRow(this.db!.prepare('SELECT * FROM approvals WHERE id = ?').get(id)) as ApprovalRow | null;
  }

  public getPendingApprovals (): ApprovalRow[] {
    this._expireTimedOut();
    return this._decryptRows(
      this.db!
        .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at DESC")
        .all()
    ) as ApprovalRow[];
  }

  private _expireTimedOut (): void {
    this.db!
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

  public getContactChats (jid: string, limit = 20, offset = 0): ChatRow[] {
    return this._decryptRows(
      this.db!
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
    ) as ChatRow[];
  }

  /**
   * Export complete chat history for a specific JID.
   * Supports PIPEDA individual access rights.
   * @param {string} jid - Chat JID to export
   * @param {string} format - Export format: 'json' or 'csv' (default: 'json')
   * @returns {object} Exported data with metadata
   */
  public exportChatData (jid: string, format: 'json' | 'csv' = 'json'): {
    format: string;
    jid: string;
    chatName?: string | null;
    exportedAt?: string;
    messageCount?: number;
    data?: string;
    messages?: {
      id: string;
      timestamp: string;
      sender: { jid: string | null; name: string | null };
      body: string | null;
      isFromMe: boolean;
      hasMedia: boolean;
      mediaType: string | null;
    }[];
    error?: string;
    isGroup?: boolean;
  } {
    const chat = this.getChatByJid(jid);
    if (!chat) {
      return { error: 'Chat not found', jid, format };
    }

    const messages = this.listMessages({ chatJid: jid, limit: 10000, offset: 0 });

    if (format === 'csv') {
      // RFC 4180: wrap every field in double quotes, escape internal quotes by doubling.
      // Strip leading formula characters (=+-@\t\r) to prevent spreadsheet injection.
      const csvCell = (v: unknown): string => {
        const s = String(v ?? '');
        const safe = s.replace(/^([=+\-@\t\r])/, "'$1");
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const headers = ['id', 'timestamp', 'sender_jid', 'sender_name', 'body', 'is_from_me', 'has_media', 'media_type'];
      const rows = messages.map((m) =>
        [
          csvCell(m.id),
          csvCell(new Date(m.timestamp * 1000).toISOString()),
          csvCell(m.sender_jid || ''),
          csvCell(m.sender_name || ''),
          csvCell(m.body || ''),
          csvCell(m.is_from_me ? 1 : 0),
          csvCell(m.has_media ? 1 : 0),
          csvCell(m.media_type || '')
        ].join(',')
      );
      return {
        format: 'csv',
        jid,
        chatName: chat.name,
        exportedAt: new Date().toISOString(),
        messageCount: messages.length,
        data: [headers.map(csvCell).join(','), ...rows].join('\n')
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

  public getLastInteraction (jid: string): (MessageRow & { chat_name: string | null }) | null {
    return this._decryptRow(
      this.db!
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
    ) as (MessageRow & { chat_name: string | null }) | null;
  }

  public updateChatName (jid: string, name: string | null): void {
    if (!name) {return;}
    // Group names resolved from WhatsApp are authoritative — always overwrite.
    // DM names: only set when unset (null) or still equal to the JID placeholder.
    this.db!
      .prepare('UPDATE chats SET name = ? WHERE jid = ? AND (name IS NULL OR name = jid OR is_group = 1)')
      .run(name, jid);
  }

  // ── Media Operations ─────────────────────────────────────────

  public updateMediaInfo (messageId: string, { mimetype, filename, localPath, rawJson }: { mimetype?: string | null; filename?: string | null; localPath?: string | null; rawJson?: string | null }): void {
    this.db!
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

  public getMediaMessages (chatJid?: string, limit = 20, offset = 0): MessageRow[] {
    let sql = 'SELECT * FROM messages WHERE has_media = 1';
    const params: (string | number)[] = [];
    if (chatJid) {
      sql += ' AND chat_jid = ?';
      params.push(chatJid);
    }
    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return this._decryptRows(this.db!.prepare(sql).all(...params) as MessageRow[]);
  }

  // ── Stats ────────────────────────────────────────────────────

  public getStats (): {
    chatCount: number;
    messageCount: number;
    unreadCount: number;
    pendingApprovals: number;
    lastSync: number | null;
    } {
    const chatCount = (this.db!.prepare('SELECT COUNT(*) as count FROM chats').get() as { count: number }).count;
    const messageCount = (this.db!.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;
    const unreadCount = (this.db!
      .prepare('SELECT COUNT(*) as count FROM messages WHERE is_read = 0')
      .get() as { count: number }).count;
    const pendingApprovals = (this.db!
      .prepare("SELECT COUNT(*) as count FROM approvals WHERE status = 'pending'")
      .get() as { count: number }).count;
    const lastSync = (this.db!.prepare('SELECT MAX(timestamp) as ts FROM messages').get() as { ts: number | null }).ts;

    return { chatCount, messageCount, unreadCount, pendingApprovals, lastSync };
  }

  // ── Catch-Up Summary ─────────────────────────────────────────

  public getCatchUpData (sinceTimestamp: number): {
    activeChats: (ChatRow & { recent_messages: number })[];
    recentUnread: (MessageRow & { chat_name: string | null })[];
    questions: (MessageRow & { chat_name: string | null })[];
    pendingApprovals: ApprovalRow[];
  } {
    const activeChats = this._decryptRows(
      this.db!
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
    ) as (ChatRow & { recent_messages: number })[];

    const recentUnread = this._decryptRows(
      this.db!
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
    ) as (MessageRow & { chat_name: string | null })[];

    const questions = recentUnread.filter((m) => m.body && m.body.includes('?'));

    const pendingApprovals = this.getPendingApprovals();

    return { activeChats, recentUnread, questions, pendingApprovals };
  }

  // ── Auto-Purge ──────────────────────────────────────────────

  /**
   * Delete messages and media older than retentionDays.
   * Returns { messagesDeleted, mediaFilesDeleted, approvalsDeleted }.
   */
  public purgeOldData (retentionDays: number | null | undefined): {
    messagesDeleted: number;
    mediaFilesDeleted: number;
    approvalsDeleted: number;
  } | null {
    if (!retentionDays || retentionDays <= 0) {return null;}

    const cutoffTs = Math.floor(Date.now() / 1000) - retentionDays * 86400;
    const cutoffMs = Date.now() - retentionDays * 86400_000;

    const mediaRows = this.db!
      .prepare(
        'SELECT media_local_path FROM messages WHERE timestamp < ? AND media_local_path IS NOT NULL'
      )
      .all(cutoffTs) as { media_local_path: string }[];

    const msgResult = this.db!.prepare('DELETE FROM messages WHERE timestamp < ?').run(cutoffTs);
    const apprResult = this.db!.prepare('DELETE FROM approvals WHERE created_at < ?').run(cutoffMs);

    if (mediaRows.length > 0) {
      for (const row of mediaRows) {
        try {
          unlinkSync(row.media_local_path);
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
  public startAutoPurge (retentionDays: number | null | undefined, intervalMs = 3600_000): void {
    if (!retentionDays || retentionDays <= 0) {return;}

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

  public close (): void {
    if (this._purgeTimer) {
      clearInterval(this._purgeTimer);
      this._purgeTimer = null;
    }
    if (this.db) {
      this.db.close();
    }
    this.db = null;
  }
}
