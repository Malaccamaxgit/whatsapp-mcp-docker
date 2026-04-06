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

export type ContactMapping = {
  id: number;
  lid_jid: string;
  phone_jid: string | null;
  phone_number: string | null;
  contact_name: string | null;
  created_at: number;
  updated_at: number;
};

export interface Contact {
  id: number;
  phoneNumber: string;
  canonicalName: string | null;
  isSelf: boolean;
  devices: ContactDevice[];
  phoneJids: string[];
}

export interface ContactDevice {
  id: number;
  lidJid: string;
  deviceType: 'phone' | 'desktop' | 'web' | 'unknown';
  deviceName: string | null;
  isPrimary: boolean;
  lastSeen: number | null;
}

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
  private _upsertContactMapping!: Database.Statement;
  private _getContactMappingByLid!: Database.Statement;
  private _getContactMappingByPhone!: Database.Statement;
  private _getContactMappingByPhoneJid!: Database.Statement;
  private _getAllContactMappings!: Database.Statement;
  private _insertPollVote!: Database.Statement;
  private _getPollVotes!: Database.Statement;
  
  // Multi-device prepared statements
  private _getContactByPhone!: Database.Statement;
  private _createContact!: Database.Statement;
  private _updateContactName!: Database.Statement;
  private _getDeviceByLid!: Database.Statement;
  private _addDevice!: Database.Statement;
  private _getDevicesForContact!: Database.Statement;
  private _addPhoneJid!: Database.Statement;
  private _getPhoneJidsForContact!: Database.Statement;
  private _getContactByLid!: Database.Statement;
  private _getContactByPhoneJid!: Database.Statement;
  private _setPrimaryDevice!: Database.Statement;
  private _setPrimaryDevice2!: Database.Statement;
  private _markContactAsSelf!: Database.Statement;

  constructor (dbPath?: string) {
    this.dbPath = dbPath || process.env.STORE_DB_PATH || '/data/store/messages.db';
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = OFF'); // Disable during migration
    this._migrate();
    this.db.pragma('foreign_keys = ON'); // Enable after tables exist
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

    // Add poll_votes table for tracking poll votes
    try {
      this.db!.exec(`
        CREATE TABLE IF NOT EXISTS poll_votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poll_message_id TEXT NOT NULL,
          voter_jid TEXT NOT NULL,
          voter_name TEXT,
          vote_option TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          chat_jid TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id
        ON poll_votes(poll_message_id);

        CREATE INDEX IF NOT EXISTS idx_poll_votes_voter
        ON poll_votes(voter_jid, chat_jid);
      `);
      console.error('[STORE] poll_votes table created');
    } catch (error: unknown) {
      console.error('[STORE] poll_votes migration note:', (error as Error).message);
    }

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

    // Add contact_mappings table for JID unification (@lid <-> @s.whatsapp.net)
    try {
      this.db!.exec(`
        CREATE TABLE IF NOT EXISTS contact_mappings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lid_jid TEXT NOT NULL UNIQUE,
          phone_jid TEXT,
          phone_number TEXT,
          contact_name TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_contact_mappings_phone
        ON contact_mappings(phone_number);

        CREATE INDEX IF NOT EXISTS idx_contact_mappings_phone_jid
        ON contact_mappings(phone_jid);
      `);
      console.error('[STORE] contact_mappings table created for JID unification');
    } catch (error: unknown) {
      console.error('[STORE] contact_mappings migration note:', (error as Error).message);
    }

    // Add multi-device contact schema (Phase 4 enhancement)
    try {
      this.db!.exec(`
        -- Primary identity: the phone number
        CREATE TABLE IF NOT EXISTS contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone_number TEXT NOT NULL UNIQUE,
          canonical_name TEXT,
          is_self INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        );

        -- Device LIDs linked to contacts (1:N relationship)
        CREATE TABLE IF NOT EXISTS contact_devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id INTEGER NOT NULL,
          lid_jid TEXT NOT NULL UNIQUE,
          device_type TEXT DEFAULT 'unknown',
          device_name TEXT,
          is_primary INTEGER DEFAULT 0,
          last_seen INTEGER,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_contact_devices_lid
        ON contact_devices(lid_jid);

        CREATE INDEX IF NOT EXISTS idx_contact_devices_contact
        ON contact_devices(contact_id);

        -- Legacy phone JID format (usually just one per contact)
        CREATE TABLE IF NOT EXISTS contact_phone_jids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id INTEGER NOT NULL,
          phone_jid TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_contact_phone_jids_jid
        ON contact_phone_jids(phone_jid);

        -- Preserve existing data during migration (only if contact_mappings exists)
        CREATE TABLE IF NOT EXISTS contact_mappings_backup (
          id INTEGER PRIMARY KEY,
          lid_jid TEXT,
          phone_jid TEXT,
          phone_number TEXT,
          contact_name TEXT,
          created_at INTEGER,
          updated_at INTEGER
        );
      `);
      console.error('[STORE] Multi-device contact schema created (contacts, contact_devices, contact_phone_jids)');
    } catch (error: unknown) {
      console.error('[STORE] Multi-device schema migration note:', (error as Error).message);
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

    // Poll vote prepared statements
    this._insertPollVote = this.db!.prepare(`
      INSERT INTO poll_votes (poll_message_id, voter_jid, voter_name, vote_option, timestamp, chat_jid)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this._getPollVotes = this.db!.prepare(`
      SELECT voter_jid, voter_name, vote_option, timestamp
      FROM poll_votes
      WHERE poll_message_id = ? AND chat_jid = ?
      ORDER BY timestamp ASC
    `);

    // Contact mapping prepared statements
    this._upsertContactMapping = this.db!.prepare(`
      INSERT INTO contact_mappings (lid_jid, phone_jid, phone_number, contact_name, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(lid_jid) DO UPDATE SET
        phone_jid = COALESCE(excluded.phone_jid, contact_mappings.phone_jid),
        phone_number = COALESCE(excluded.phone_number, contact_mappings.phone_number),
        contact_name = COALESCE(excluded.contact_name, contact_mappings.contact_name),
        updated_at = unixepoch()
    `);

    this._getContactMappingByLid = this.db!.prepare('SELECT * FROM contact_mappings WHERE lid_jid = ?');
    this._getContactMappingByPhone = this.db!.prepare('SELECT * FROM contact_mappings WHERE phone_number = ?');
    this._getContactMappingByPhoneJid = this.db!.prepare('SELECT * FROM contact_mappings WHERE phone_jid = ?');
    this._getAllContactMappings = this.db!.prepare('SELECT * FROM contact_mappings');

    // Multi-device contact prepared statements
    this._getContactByPhone = this.db!.prepare('SELECT * FROM contacts WHERE phone_number = ?');
    this._createContact = this.db!.prepare(`
      INSERT INTO contacts (phone_number, canonical_name, is_self, created_at, updated_at)
      VALUES (?, ?, 0, unixepoch(), unixepoch())
    `);
    this._updateContactName = this.db!.prepare(`
      UPDATE contacts SET canonical_name = ?, updated_at = unixepoch()
      WHERE phone_number = ?
    `);
    this._getDeviceByLid = this.db!.prepare('SELECT * FROM contact_devices WHERE lid_jid = ?');
    this._addDevice = this.db!.prepare(`
      INSERT INTO contact_devices (contact_id, lid_jid, device_type, device_name, is_primary, last_seen, created_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(lid_jid) DO UPDATE SET
        device_type = excluded.device_type,
        device_name = excluded.device_name,
        is_primary = CASE
          WHEN excluded.is_primary = 1 THEN 1
          ELSE contact_devices.is_primary
        END,
        last_seen = MAX(excluded.last_seen, contact_devices.last_seen),
        updated_at = unixepoch()
    `);
    this._getDevicesForContact = this.db!.prepare(`
      SELECT * FROM contact_devices WHERE contact_id = ? ORDER BY is_primary DESC, last_seen DESC
    `);
    this._addPhoneJid = this.db!.prepare(`
      INSERT INTO contact_phone_jids (contact_id, phone_jid, created_at)
      SELECT ?, ?, unixepoch()
      WHERE NOT EXISTS (
        SELECT 1 FROM contact_phone_jids WHERE phone_jid = ?
      )
    `);
    this._getPhoneJidsForContact = this.db!.prepare('SELECT phone_jid FROM contact_phone_jids WHERE contact_id = ?');
    this._getContactByLid = this.db!.prepare(`
      SELECT c.* FROM contacts c
      JOIN contact_devices cd ON c.id = cd.contact_id
      WHERE cd.lid_jid = ?
    `);
    this._getContactByPhoneJid = this.db!.prepare(`
      SELECT c.* FROM contacts c
      JOIN contact_phone_jids cpj ON c.id = cpj.contact_id
      WHERE cpj.phone_jid = ?
    `);
    this._setPrimaryDevice = this.db!.prepare(`
      UPDATE contact_devices SET is_primary = 0 WHERE contact_id = ?
    `);
    this._setPrimaryDevice2 = this.db!.prepare(`
      UPDATE contact_devices SET is_primary = 1 WHERE lid_jid = ? AND contact_id = ?
    `);
    this._markContactAsSelf = this.db!.prepare('UPDATE contacts SET is_self = 1, updated_at = unixepoch() WHERE id = ?');
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

  public getAllChatsForMatching (): { jid: string; name: string | null; unread_count?: number; last_message_at?: number | null; last_message_preview?: string | null; is_group?: number }[] {
    return this.db!.prepare('SELECT jid, name, unread_count, last_message_at, last_message_preview, is_group FROM chats ORDER BY last_message_at DESC').all() as { jid: string; name: string | null; unread_count?: number; last_message_at?: number | null; last_message_preview?: string | null; is_group?: number }[];
  }

  public incrementUnread (chatJid: string): void {
    this.db!.prepare('UPDATE chats SET unread_count = unread_count + 1 WHERE jid = ?').run(chatJid);
  }

  public clearUnread (chatJid: string): void {
    this.db!.prepare('UPDATE chats SET unread_count = 0 WHERE jid = ?').run(chatJid);
  }

  // ── Contact Mapping Operations (JID Unification) ───────────

  /**
   * Upsert a contact mapping between LID JID and phone-based JID.
   * @param lidJid - The @lid format JID (e.g., "44612043436101@lid")
   * @param phoneJid - The @s.whatsapp.net format JID (e.g., "33680940027@s.whatsapp.net")
   * @param phoneNumber - The phone number in E.164 format (e.g., "+33680940027")
   * @param contactName - The contact display name
   */
  public upsertContactMapping (lidJid: string, phoneJid?: string | null, phoneNumber?: string | null, contactName?: string | null): void {
    if (!lidJid) {return;}
    this._upsertContactMapping.run(lidJid, phoneJid || null, phoneNumber || null, contactName || null);
  }

  /**
   * Get contact mapping by LID JID.
   * @param lidJid - The @lid format JID
   * @returns The contact mapping or null
   */
  public getContactMappingByLid (lidJid: string): ContactMapping | null {
    const row = this._getContactMappingByLid.get(lidJid);
    return (row as ContactMapping) || null;
  }

  /**
   * Get contact mapping by phone number.
   * @param phoneNumber - Phone number in E.164 format
   * @returns The contact mapping or null
   */
  public getContactMappingByPhone (phoneNumber: string): ContactMapping | null {
    const row = this._getContactMappingByPhone.get(phoneNumber);
    return (row as ContactMapping) || null;
  }

  /**
   * Get contact mapping by phone JID.
   * @param phoneJid - The @s.whatsapp.net format JID
   * @returns The contact mapping or null
   */
  public getContactMappingByPhoneJid (phoneJid: string): ContactMapping | null {
    const row = this._getContactMappingByPhoneJid.get(phoneJid);
    return (row as ContactMapping) || null;
  }

  /**
   * Get all contact mappings.
   * @returns Array of all contact mappings
   */
  public getAllContactMappings (): ContactMapping[] {
    return this._getAllContactMappings.all() as ContactMapping[];
  }

  /**
   * Find the unified/preferred JID for a contact.
   * Prefers @lid JID for contacts with names, @s.whatsapp.net for others.
   * @param jid - Any JID format to look up
   * @returns The preferred JID, or the original if no mapping found
   */
  public getUnifiedJid (jid: string): string {
    if (!jid) {return jid;}

    // Check if this is a LID JID
    if (jid.endsWith('@lid')) {
      const mapping = this.getContactMappingByLid(jid);
      if (mapping && mapping.lid_jid) {return mapping.lid_jid;} // Prefer LID
    }

    // Check if this is a phone JID
    if (jid.endsWith('@s.whatsapp.net')) {
      const mapping = this.getContactMappingByPhoneJid(jid);
      if (mapping) {
        // Prefer LID if available, otherwise use phone JID
        return mapping.lid_jid || mapping.phone_jid || jid;
      }
    }

    // No mapping found, return original
    return jid;
  }

  /**
   * Get both JID formats for a contact if known.
   * @param jid - Any JID format to look up
   * @returns Object with both JID formats if available
   */
  public getJidMapping (jid: string): { lidJid?: string; phoneJid?: string; phoneNumber?: string } | null {
    if (!jid) {return null;}

    let mapping: ContactMapping | null = null;
    if (jid.endsWith('@lid')) {
      mapping = this.getContactMappingByLid(jid);
    } else if (jid.endsWith('@s.whatsapp.net')) {
      mapping = this.getContactMappingByPhoneJid(jid);
    }

    if (!mapping) {return null;}

    return {
      lidJid: mapping.lid_jid || undefined,
      phoneJid: mapping.phone_jid || undefined,
      phoneNumber: mapping.phone_number || undefined
    };
  }

  /**
   * Get all chats with duplicate JID entries merged.
   * Uses contact_mappings to unify @lid and @s.whatsapp.net JIDs.
   * @param options - Same options as listChats
   * @returns Array of unified chat rows with duplicates merged
   */
  public getAllChatsUnified ({ filter, groupsOnly, limit = 20, offset = 0 }: { filter?: string; groupsOnly?: boolean; limit?: number; offset?: number } = {}): ChatRow[] {
    // Get all legacy contact mappings
    const mappings = this.getAllContactMappings();
    const mappingLookup = new Map<string, ContactMapping>();
    
    for (const mapping of mappings) {
      if (mapping.lid_jid) {mappingLookup.set(mapping.lid_jid, mapping);}
      if (mapping.phone_jid) {mappingLookup.set(mapping.phone_jid, mapping);}
    }

    // Build multi-device JID lookup (contacts/contact_devices/contact_phone_jids)
    const multiDeviceLookup = new Map<string, string>();
    const contactRows = this.db!.prepare(`
      SELECT
        c.id AS contact_id,
        cd.lid_jid AS lid_jid,
        cd.is_primary AS is_primary,
        cd.last_seen AS last_seen,
        cpj.phone_jid AS phone_jid
      FROM contacts c
      LEFT JOIN contact_devices cd ON c.id = cd.contact_id
      LEFT JOIN contact_phone_jids cpj ON c.id = cpj.contact_id
      ORDER BY c.id ASC, cd.is_primary DESC, cd.last_seen DESC, cd.id ASC, cpj.id ASC
    `).all() as Array<{
      contact_id: number;
      lid_jid: string | null;
      is_primary: number | null;
      last_seen: number | null;
      phone_jid: string | null;
    }>;

    const contactBuckets = new Map<number, {
      lids: string[];
      phoneJids: string[];
      primaryLid: string | null;
    }>();

    for (const row of contactRows) {
      let bucket = contactBuckets.get(row.contact_id);
      if (!bucket) {
        bucket = { lids: [], phoneJids: [], primaryLid: null };
        contactBuckets.set(row.contact_id, bucket);
      }

      if (row.lid_jid && !bucket.lids.includes(row.lid_jid)) {
        bucket.lids.push(row.lid_jid);
      }
      if (row.phone_jid && !bucket.phoneJids.includes(row.phone_jid)) {
        bucket.phoneJids.push(row.phone_jid);
      }
      if (row.lid_jid && row.is_primary === 1 && !bucket.primaryLid) {
        bucket.primaryLid = row.lid_jid;
      }
    }

    for (const bucket of contactBuckets.values()) {
      const unifiedJid = bucket.primaryLid || bucket.lids[0] || bucket.phoneJids[0];
      if (!unifiedJid) {continue;}

      for (const lid of bucket.lids) {
        multiDeviceLookup.set(lid, unifiedJid);
      }
      for (const phoneJid of bucket.phoneJids) {
        multiDeviceLookup.set(phoneJid, unifiedJid);
      }
    }

    // Get all chats
    let sql = 'SELECT * FROM chats WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter) {
      sql += ' AND name LIKE ?';
      params.push(`%${filter}%`);
    }
    if (groupsOnly) {
      sql += ' AND is_group = 1';
    }

    sql += ' ORDER BY last_message_at DESC';
    const allChats = this._decryptRows(this.db!.prepare(sql).all(...params)) as ChatRow[];

    // Merge duplicates using mappings
    const unifiedMap = new Map<string, ChatRow>();
    
    for (const chat of allChats) {
      // Skip group chats - they don't have JID duplication issues
      if (chat.is_group) {
        unifiedMap.set(chat.jid, chat);
        continue;
      }

      // Prefer new multi-device lookup; fallback to legacy mapping
      const unifiedFromMultiDevice = multiDeviceLookup.get(chat.jid);
      const mapping = mappingLookup.get(chat.jid);
      const unifiedJid = unifiedFromMultiDevice || mapping?.lid_jid || mapping?.phone_jid || chat.jid;

      // Check if we already have this unified chat
      const existing = unifiedMap.get(unifiedJid);

      if (!existing) {
        // First occurrence, use this chat but with unified JID
        unifiedMap.set(unifiedJid, { ...chat, jid: unifiedJid });
      } else {
        // Merge: keep the most recent data
        const merged: ChatRow = {
          ...existing,
          unread_count: existing.unread_count + chat.unread_count,
          last_message_at: Math.max(existing.last_message_at || 0, chat.last_message_at || 0),
          last_message_preview: chat.last_message_at && (!existing.last_message_at || chat.last_message_at > existing.last_message_at)
            ? chat.last_message_preview
            : existing.last_message_preview,
          updated_at: Math.max(existing.updated_at, chat.updated_at)
        };
        unifiedMap.set(unifiedJid, merged);
      }
    }

    // Convert back to array and apply pagination
    const unifiedChats = Array.from(unifiedMap.values())
      .sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));

    return unifiedChats.slice(offset, offset + limit);
  }

  // ── Multi-Device Contact Operations (Phase 4) ─────────────────

  /**
   * Get or create a contact by phone number.
   * Creates the contact if it doesn't exist.
   */
  public getOrCreateContactByPhone (phoneNumber: string, name?: string | null): Contact {
    const existing = this._getContactByPhone.get(phoneNumber) as any;
    if (existing) {
      return this._buildContactFromRow(existing);
    }

    // Create new contact
    const result = this._createContact.run(phoneNumber, name || null);
    const contactId = result.lastInsertRowid as number;
    
    return {
      id: contactId,
      phoneNumber,
      canonicalName: name || null,
      isSelf: false,
      devices: [],
      phoneJids: []
    };
  }

  /**
   * Add a device LID to an existing contact.
   * If contact doesn't exist, creates it.
   */
  public addDeviceLid (phoneNumber: string, lidJid: string, options?: {
    deviceType?: 'phone' | 'desktop' | 'web' | 'unknown';
    deviceName?: string | null;
    isPrimary?: boolean;
    lastSeen?: number | null;
  }): ContactDevice {
    const contact = this.getOrCreateContactByPhone(phoneNumber);
    const deviceType = options?.deviceType || 'unknown';
    const deviceName = options?.deviceName || null;
    const isPrimary = options?.isPrimary ? 1 : 0;
    const lastSeen = options?.lastSeen || Math.floor(Date.now() / 1000);

    this._addDevice.run(contact.id, lidJid, deviceType, deviceName, isPrimary, lastSeen);

    return {
      id: 0, // Will be assigned by DB
      lidJid,
      deviceType,
      deviceName,
      isPrimary: Boolean(isPrimary),
      lastSeen
    };
  }

  /**
   * Find contact by any associated JID (LID or phone JID).
   * Returns all devices and phone JIDs for unified display.
   */
  public getContactByJid (jid: string): Contact | null {
    if (!jid) {return null;}

    let contactRow: any = null;

    // Try LID first
    if (jid.endsWith('@lid')) {
      contactRow = this._getContactByLid.get(jid) as any;
    } else if (jid.endsWith('@s.whatsapp.net')) {
      contactRow = this._getContactByPhoneJid.get(jid) as any;
    }

    if (!contactRow) {return null;}

    return this._buildContactFromRow(contactRow);
  }

  /**
   * Get all devices for a contact.
   */
  public getContactDevices (contactId: number): ContactDevice[] {
    const devices = this._getDevicesForContact.all(contactId) as any[];
    return devices.map((d) => ({
      id: d.id,
      lidJid: d.lid_jid,
      deviceType: d.device_type as 'phone' | 'desktop' | 'web' | 'unknown',
      deviceName: d.device_name,
      isPrimary: Boolean(d.is_primary),
      lastSeen: d.last_seen
    }));
  }

  /**
   * Get all JIDs associated with a contact (for message retrieval).
   */
  public getAllJidsForContact (phoneNumber: string): string[] {
    const contact = this.getOrCreateContactByPhone(phoneNumber);
    const jids: string[] = [];

    // Add all device LIDs
    const devices = this.getContactDevices(contact.id);
    for (const device of devices) {
      jids.push(device.lidJid);
    }

    // Add all phone JIDs
    const phoneJids = this._getPhoneJidsForContact.all(contact.id) as any[];
    for (const pj of phoneJids) {
      jids.push(pj.phone_jid);
    }

    return jids;
  }

  /**
   * Set primary device for a contact.
   */
  public setPrimaryDevice (lidJid: string): void {
    const device = this._getDeviceByLid.get(lidJid) as any;
    if (!device) {return;}

    this._setPrimaryDevice.run(device.contact_id);
    this._setPrimaryDevice2.run(lidJid, device.contact_id);
  }

  /**
   * Mark a contact as the MCP user's own account (self-account).
   */
  public markContactAsSelf (contactId: number): void {
    this._markContactAsSelf.run(contactId);
  }

  /**
   * Add a phone JID to a contact.
   */
  public addPhoneJidToContact (contactId: number, phoneJid: string): void {
    this._addPhoneJid.run(contactId, phoneJid, phoneJid);
  }

  /**
   * Helper to build a Contact object from a database row.
   */
  private _buildContactFromRow (row: any): Contact {
    const contactId = row.id;
    const devices = this.getContactDevices(contactId);
    const phoneJidRows = this._getPhoneJidsForContact.all(contactId) as any[];
    const phoneJids = phoneJidRows.map((pj) => pj.phone_jid);

    return {
      id: contactId,
      phoneNumber: row.phone_number,
      canonicalName: row.canonical_name,
      isSelf: Boolean(row.is_self),
      devices,
      phoneJids
    };
  }

  /**
   * Migrate existing contact_mappings to the new multi-device schema.
   * Creates contacts with devices from legacy single-device mappings.
   */
  public migrateToMultiDevice (): {
    contactsCreated: number;
    devicesMigrated: number;
    errors: string[];
  } {
    const results: { contactsCreated: number; devicesMigrated: number; errors: string[] } = { contactsCreated: 0, devicesMigrated: 0, errors: [] };

    // Get all existing mappings
    const existingMappings = this.getAllContactMappings();

    for (const mapping of existingMappings) {
      try {
        // Find or create contact by phone number
        const contact = this.getOrCreateContactByPhone(
          mapping.phone_number || '',
          mapping.contact_name
        );

        if (!contact.id) {
          results.errors.push(`Failed to create contact for ${mapping.phone_number || 'unknown'}`);
          continue;
        }

        // Add LID device if present
        if (mapping.lid_jid) {
          this.addDeviceLid(
            mapping.phone_number || '',
            mapping.lid_jid,
            { deviceType: 'unknown', lastSeen: Math.floor(mapping.updated_at / 1000) }
          );
          results.devicesMigrated++;
        }

        // Add phone JID if present
        if (mapping.phone_jid) {
          this.addPhoneJidToContact(contact.id, mapping.phone_jid);
        }

        results.contactsCreated++;
      } catch (err) {
        results.errors.push(`Failed to migrate ${mapping.lid_jid || 'unknown'}: ${(err as Error).message}`);
      }
    }

    console.error(`[STORE] Multi-device migration complete: ${results.contactsCreated} contacts, ${results.devicesMigrated} devices`);
    return results;
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
    pollMetadata?: {
      pollCreationMessageKey?: string;
      voteOptions?: string[];
    };
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

  // ── Poll Vote Operations ──────────────────────────────────────

  /**
   * Add a poll vote to the database.
   * @param pollMessageId - The ID of the original poll creation message
   * @param voterJid - The JID of the voter
   * @param voterName - The display name of the voter (optional)
   * @param voteOptions - Array of selected option(s)
   * @param timestamp - Unix timestamp of the vote
   * @param chatJid - The JID of the chat where the poll was sent
   */
  public addPollVote ({
    pollMessageId,
    voterJid,
    voterName,
    voteOptions,
    timestamp,
    chatJid
  }: {
    pollMessageId: string;
    voterJid: string;
    voterName: string | null;
    voteOptions: string[];
    timestamp: number;
    chatJid: string;
  }): void {
    // Store each vote option as a separate row for easier aggregation
    for (const option of voteOptions) {
      if (!option.trim()) {continue;}
      this._insertPollVote.run(pollMessageId, voterJid, voterName, option, timestamp, chatJid);
    }
  }

  /**
   * Get all votes for a specific poll message.
   * @param pollMessageId - The ID of the poll creation message
   * @param chatJid - The JID of the chat where the poll was sent
   * @returns Array of poll votes with voter information
   */
  public getPollVotes (pollMessageId: string, chatJid: string): Array<{
    voter_jid: string;
    voter_name: string | null;
    vote_option: string;
    timestamp: number;
  }> {
    return this._decryptRows(
      this._getPollVotes.all(pollMessageId, chatJid)
    ) as Array<{
      voter_jid: string;
      voter_name: string | null;
      vote_option: string;
      timestamp: number;
    }>;
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
      SELECT c.jid, c.name, c.is_group, c.unread_count, c.last_message_at,
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

  /**
   * Migrate existing duplicate chats by creating contact mappings.
   * Finds chats with the same name but different JID formats (@lid vs @s.whatsapp.net)
   * and creates mappings to unify them.
   * @returns Object with migration statistics
   */
  public migrateDuplicateChats (): { migrated: number; skipped: number } {
    console.error('[STORE] Starting JID unification migration...');
    
    // Get all non-group chats
    const allChats = this.db!.prepare(`
      SELECT jid, name, last_message_at, unread_count, last_message_preview
      FROM chats
      WHERE is_group = 0 AND name IS NOT NULL
      ORDER BY name, last_message_at DESC
    `).all() as Array<{
      jid: string;
      name: string;
      last_message_at: number | null;
      unread_count: number;
      last_message_preview: string | null;
    }>;

    // Group chats by name
    const chatsByName = new Map<string, typeof allChats>();
    for (const chat of allChats) {
      const existing = chatsByName.get(chat.name) || [];
      existing.push(chat);
      chatsByName.set(chat.name, existing);
    }

    let migrated = 0;
    let skipped = 0;

    // Process each group of chats with the same name
    for (const [name, chats] of chatsByName.entries()) {
      if (chats.length < 2) {continue;} // No duplicates for this name

      // Look for @lid and @s.whatsapp.net pairs
      const lidChat = chats.find((c) => c.jid.endsWith('@lid'));
      const phoneChats = chats.filter((c) => c.jid.endsWith('@s.whatsapp.net'));

      if (!lidChat || phoneChats.length === 0) {
        skipped += chats.length;
        continue;
      }

      // Extract phone number from phone JID
      for (const phoneChat of phoneChats) {
        const phoneNumber = phoneChat.jid.match(/^([0-9]+)@/)?.[1] || null;
        
        if (!phoneNumber) {
          skipped++;
          continue;
        }

        // Create mapping
        try {
          this.upsertContactMapping(
            lidChat.jid,
            phoneChat.jid,
            phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`,
            name
          );
          migrated++;
          console.error(`[STORE] Migrated mapping: ${lidChat.jid} ↔ ${phoneChat.jid} (${name})`);
        } catch (error) {
          console.error(`[STORE] Migration failed for ${phoneChat.jid}:`, (error as Error).message);
          skipped++;
        }
      }
    }

    console.error(`[STORE] Migration complete: ${migrated} mappings created, ${skipped} skipped`);
    return { migrated, skipped };
  }

  /**
   * Repair misrouted chats where @lid JIDs have is_group=0 but should be is_group=1.
   * This can happen when group participant messages were incorrectly routed using
   * the sender JID instead of the group JID.
   * @returns Object with repair statistics
   */
  public repairMisroutedChats (): { repaired: number; scanned: number } {
    console.error('[STORE] Starting chat repair migration...');
    
    // Find @lid JIDs that have is_group=0 but whose messages suggest they belong to a group
    // A @lid JID is typically a group participant, not a DM contact
    const lidChatsAsNonGroup = this.db!.prepare(`
      SELECT jid, name FROM chats
      WHERE is_group = 0 AND jid LIKE '%@lid'
    `).all() as Array<{ jid: string; name: string | null }>;

    let repaired = 0;
    const scanned = lidChatsAsNonGroup.length;

    for (const chat of lidChatsAsNonGroup) {
      // Check if this chat has messages from multiple different senders
      // (a strong indicator it's actually a group chat)
      const distinctSenders = this.db!.prepare(`
        SELECT COUNT(DISTINCT sender_jid) as cnt FROM messages
        WHERE chat_jid = ? AND sender_jid IS NOT NULL
      `).get(chat.jid) as { cnt: number };

      // If there are 3+ distinct senders, this is almost certainly a group
      if (distinctSenders.cnt >= 3) {
        this.db!.prepare(
          'UPDATE chats SET is_group = 1 WHERE jid = ? AND is_group = 0'
        ).run(chat.jid);
        repaired++;
        console.error(`[STORE] Repaired: ${chat.jid} -> is_group=1 (${distinctSenders.cnt} senders)`);
      }
    }

    console.error(`[STORE] Chat repair complete: ${repaired} chats repaired out of ${scanned} scanned`);
    return { repaired, scanned };
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
