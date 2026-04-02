/**
 * WhatsApp Client Wrapper
 *
 * Wraps @whatsmeow-node/whatsmeow-node with event handling, message
 * persistence to SQLite, and approval response detection.
 * Uses the whatsmeow Go protocol directly via JSON-line IPC.
 *
 * Resilience: startup retry with backoff, operation-level retry for
 * transient errors, health heartbeat, automatic reconnection.
 *
 * Presence & Receipts: delivery receipts, read receipts via markRead,
 * auto-read on incoming messages, online/offline presence.
 */

import { createClient } from '@whatsmeow-node/whatsmeow-node';
import { createRequire } from 'node:module';
import { unlink } from 'node:fs/promises';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { isGroupJid } from '../utils/phone.js';
import { assertPathWithin, sanitizeFilename, checkExtension } from '../security/file-guard.js';
import { decrypt } from '../security/crypto.js';
import { classifyError } from '../utils/errors.js';
import { PERMANENT_LOGOUT_REASONS, APPROVAL_KEYWORDS } from '../constants.js';

/**
 * Match text against approval keywords using word boundaries for text keywords
 * and substring match for emoji, preventing false positives like "nobody" → "no".
 */
function matchesApprovalKeywords(text, keywords) {
  return keywords.some((k) => {
    // Emoji characters: use simple substring match (they don't form partial words)
    if (/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(k)) return text.includes(k);
    // Text keywords: require whole-word match to avoid e.g. "nobody" triggering "no"
    return new RegExp(`\\b${k}\\b`, 'i').test(text);
  });
}

function resolveMuslBinary() {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve('@whatsmeow-node/linux-x64-musl/bin/whatsmeow-node');
  } catch {
    return undefined;
  }
}

export class WhatsAppClient {
  constructor({ 
    storePath, 
    messageStore, 
    onMessage, 
    onConnected, 
    onDisconnected,
    client,           // Optional: inject mock client for testing
    config = {},      // Optional: config object to override process.env
    logger = console  // Optional: inject logger for testing
  }) {
    this.storePath = storePath || config.STORE_PATH || process.env.STORE_PATH || '/data/store';
    this.messageStore = messageStore;
    this.onMessage = onMessage || (() => {});
    this.onConnected = onConnected || (() => {});
    this.onDisconnected = onDisconnected || (() => {});
    this.logger = logger || console;

    this.client = client || null;
    this.jid = null;
    this._connected = false;
    this._pendingPairResolve = null;
    this._lastQrCode = null;

    // Session lifecycle
    this._logoutReason = null;
    this._reconnecting = false;
    this._connectedAt = null;

    // Health monitoring
    this._healthInterval = null;
    this._recentErrors = [];

    // Auth state tracking
    this._lastQrTimestamp = null;    // Timestamp of the most recent QR code event
    this._authInProgress = false;    // True while user has explicitly triggered auth
    this._qrWaiters = [];            // Resolve callbacks waiting for next QR event
    this._readyWaiters = [];         // Resolve callbacks waiting for connected event
    this._connectCalled = false;     // Whether connect() has been initiated at least once
    this._sessionExists = false;     // Whether a session was loaded from disk at init

    // Message waiters for wait_for_message tool
    this._messageWaiters = [];       // { filter, resolve } entries waiting for an incoming message

    // Track message IDs sent by THIS server process to distinguish
    // "server-originated" from "other-device echo" when isFromMe is true
    this._sentMessageIds = new Set();

    // Presence & receipts config (from config object or process.env)
    this._sendReadReceipts = config.SEND_READ_RECEIPTS !== undefined ? config.SEND_READ_RECEIPTS : (process.env.SEND_READ_RECEIPTS !== 'false');
    this._autoReadReceipts = config.AUTO_READ_RECEIPTS !== undefined ? config.AUTO_READ_RECEIPTS : (process.env.AUTO_READ_RECEIPTS !== 'false');
    this._presenceMode = config.PRESENCE_MODE || process.env.PRESENCE_MODE || 'available';
  }

  // ── Initialization ──────────────────────────────────────────

  async initialize({ autoConnect = true } = {}) {
    this.client = createClient({
      store: `${this.storePath}/session.db`,
      binaryPath: resolveMuslBinary()
    });

    this._registerEvents();

    const { jid } = await this.client.init();
    this._sessionExists = !!jid;

    if (jid) {
      this.jid = jid;
      console.error('[WA] Resuming session for', jid);
    } else {
      console.error('[WA] No existing session — call authenticate tool to link device');
      // Do NOT call getQRChannel() eagerly — deferring auth method choice to the authenticate tool
      // prevents committing to QR mode before the user can choose pairing code instead
    }

    if (autoConnect) {
      await this._connectWithRetry();
      this._connectCalled = true;
      console.error('[WA] WebSocket connect() completed');

      if (this._sessionExists) {
        // Wait briefly for the session to restore (connected event fires asynchronously)
        const ready = await this.waitForReady(5000);
        if (ready.connected) {
          console.error(`[WA] Session restored — connected as ${ready.jid}`);
        } else {
          console.error('[WA] Session file found but connected event not yet received');
        }
      }
    } else {
      console.error('[WA] Auto-connect disabled — call authenticate tool to connect');
    }
  }

  async _connectWithRetry(maxAttempts = 5) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.client.connect();
        return;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        console.error(
          `[WA] Connect attempt ${attempt}/${maxAttempts} failed (${err.message}), retrying in ${delay}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  /**
   * Wait for the authenticated 'connected' state, with a timeout.
   * Resolves immediately if already connected; otherwise waits for the
   * connected event or times out.
   */
  async waitForReady(timeoutMs = 5000) {
    if (this.isConnected()) return { connected: true, jid: this.jid };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this._readyWaiters.indexOf(wrappedResolve);
        if (idx !== -1) this._readyWaiters.splice(idx, 1);
        resolve({ connected: false });
      }, timeoutMs);

      const wrappedResolve = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      this._readyWaiters.push(wrappedResolve);
    });
  }

  /**
   * Wait for a fresh QR code event. If a recent QR code (less than 15s old)
   * is already available, returns it immediately. Otherwise waits up to
   * timeoutMs for the next qr event from the Go bridge.
   */
  async waitForFreshQR(timeoutMs = 30000) {
    if (this._lastQrCode && this._lastQrTimestamp && Date.now() - this._lastQrTimestamp < 15000) {
      return this._lastQrCode;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this._qrWaiters.indexOf(wrappedResolve);
        if (idx !== -1) this._qrWaiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      const wrappedResolve = (code) => {
        clearTimeout(timer);
        resolve(code);
      };
      this._qrWaiters.push(wrappedResolve);
    });
  }

  /**
   * Re-establish connection using an existing session (no re-pairing needed).
   * If connect() was already called but we are not yet authenticated, waits
   * for the connected event. If connect() was never called, initiates it.
   */
  async reconnect() {
    if (this.isConnected()) return { connected: true, jid: this.jid };

    if (!this._connectCalled) {
      console.error('[WA] Initiating connection for session restore...');
      this._authInProgress = true;
      await this._connectWithRetry();
      this._connectCalled = true;
      console.error('[WA] WebSocket connect() completed for reconnect');
    }

    return this.waitForReady(10000);
  }

  // ── Event Handling ──────────────────────────────────────────

  _registerEvents() {
    this.client.on('connected', ({ jid }) => {
      this.jid = jid;
      this._connected = true;
      this._logoutReason = null;
      this._reconnecting = false;
      this._connectedAt = Date.now();
      this._authInProgress = false;
      console.error('[WA] Connected as', jid);

      // Notify any waiters for ready/authenticated state
      const readyWaiters = this._readyWaiters.splice(0);
      for (const resolve of readyWaiters) resolve({ connected: true, jid });

      this.onConnected();
      this._startHealthCheck();
      this._setupPresence();
      this._ensureWelcomeGroup();

      if (this._pendingPairResolve) {
        this._pendingPairResolve();
        this._pendingPairResolve = null;
      }
    });

    this.client.on('logged_out', ({ reason }) => {
      console.error('[WA] Logged out:', reason);
      this._connected = false;
      this.jid = null;
      this._logoutReason = reason || 'unknown';
      this._stopHealthCheck();

      const permanent = this._isPermanentLogout(reason);

      if (permanent) {
        this._cleanupSession();
        this.onDisconnected({ reason: this._logoutReason, permanent: true });
      } else {
        this._attemptReconnect();
      }
    });

    this.client.on('qr', ({ code }) => {
      this._lastQrCode = code;
      this._lastQrTimestamp = Date.now();

      // Notify any waiters for a fresh QR code
      const qrWaiters = this._qrWaiters.splice(0);
      for (const resolve of qrWaiters) resolve(code);

      // Only render QR art to the terminal when auth is explicitly in progress.
      // Suppresses the spurious QR codes that appear in logs during initialization,
      // where multiple codes fire before the user has triggered the authenticate tool.
      if (this._authInProgress) {
        console.error('[WA] QR code available — scan with WhatsApp > Linked Devices > Link a Device');
        console.error(`[WA-QR] ${code}`);
        QRCode.toString(code, { type: 'terminal', small: true }, (err, art) => {
          if (!err && art) console.error(art);
        });
      } else {
        console.error('[WA] QR code received (suppressed — call authenticate tool to display)');
      }
    });

    this.client.on('message', (evt) => {
      this._handleIncomingMessage(evt);
    });

    this.client.on('history_sync', (evt) => {
      let count = 0;
      const recentThreshold = Math.floor(Date.now() / 1000) - 120;
      const recentIncoming = [];

      if (evt.conversations) {
        for (const conv of evt.conversations) {
          if (!conv.id) continue;
          const chatJid = conv.id;
          const name = conv.displayName || conv.name || null;
          const isGroup = typeof chatJid === 'string' && chatJid.endsWith('@g.us');

          if (name) {
            this.messageStore.upsertChat(chatJid, name, isGroup, null, null);
          }

          if (conv.messages) {
            for (const rawMsg of conv.messages) {
              const msg = this._persistMessage(rawMsg, true);
              count++;
              if (msg && msg.timestamp >= recentThreshold) {
                recentIncoming.push(msg);
              }
            }
          }
        }
      }

      if (evt.messages) {
        for (const rawMsg of evt.messages) {
          const msg = this._persistMessage(rawMsg, true);
          count++;
          if (msg && msg.timestamp >= recentThreshold) {
            recentIncoming.push(msg);
          }
        }
      }

      if (count > 0) {
        console.error(`[WA] History sync: ${count} messages`);
      }

      // Dispatch recent messages to any active waiters so wait_for_message
      // and approval listeners work even if messages arrive via sync
      for (const msg of recentIncoming) {
        if (msg.id && this._sentMessageIds.has(msg.id)) continue;
        this._checkApprovalResponse(msg);
        this._notifyMessageWaiters(msg);
      }
    });
  }

  // ── Session Lifecycle ───────────────────────────────────────

  _isPermanentLogout(reason) {
    if (!reason) return false;
    const lower = reason.toLowerCase();
    return PERMANENT_LOGOUT_REASONS.some((r) => lower.includes(r));
  }

  async _cleanupSession() {
    const sessionPath = `${this.storePath}/session.db`;
    try {
      await unlink(sessionPath);
      console.error('[WA] session.db removed');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[WA] Failed to remove session.db:', err.message);
      }
    }
    this._sessionExists = false;
    this.jid = null;
  }

  async _attemptReconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;

    const delay = 5000;
    console.error(`[WA] Transient disconnect — attempting reconnect in ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));

    try {
      await this.client.connect();
      console.error('[WA] Reconnect succeeded');
    } catch (err) {
      console.error('[WA] Reconnect failed:', err.message);
      this._reconnecting = false;
      this.onDisconnected({ reason: this._logoutReason || 'reconnect_failed', permanent: false });
    }
  }

  // ── Health Monitoring ───────────────────────────────────────

  _startHealthCheck() {
    this._stopHealthCheck();
    this._healthInterval = setInterval(() => this._heartbeat(), 60_000);
  }

  _stopHealthCheck() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  async _heartbeat() {
    if (!this._connected) return;

    try {
      const alive = await this._withTimeout(
        Promise.resolve(this.client.isConnected?.() ?? this.client.isLoggedIn?.() ?? true),
        10_000,
        'health check'
      );
      if (!alive && this._connected) {
        console.error('[WA] Health check detected silent disconnect');
        this._connected = false;
        this._logoutReason = 'connection_lost';
        this._stopHealthCheck();
        this._attemptReconnect();
      }
    } catch (err) {
      console.error('[WA] Health check error:', err.message);
      this._recordError(err);
    }
  }

  _recordError(err) {
    const now = Date.now();
    this._recentErrors.push({ time: now, message: err.message });
    this._recentErrors = this._recentErrors.filter((e) => e.time > now - 300_000);
  }

  getHealthStats() {
    const now = Date.now();
    return {
      uptime: this._connectedAt ? Math.floor((now - this._connectedAt) / 1000) : 0,
      recentErrorCount: this._recentErrors.filter((e) => e.time > now - 300_000).length,
      reconnecting: this._reconnecting,
      logoutReason: this._logoutReason
    };
  }

  // ── Presence & Receipts ─────────────────────────────────────

  async _setupPresence() {
    try {
      await this.client.setForceActiveDeliveryReceipts(true);
      console.error('[WA] Delivery receipts enabled');
    } catch (err) {
      console.error('[WA] Failed to enable delivery receipts:', err.message);
    }

    try {
      await this.client.sendPresence(this._presenceMode);
      console.error(`[WA] Presence set to "${this._presenceMode}"`);
    } catch (err) {
      console.error('[WA] Failed to set presence:', err.message);
    }
  }

  async markMessagesRead({ chatJid, messageIds, senderJid }) {
    const ids = messageIds || [];

    if (ids.length > 0 && this._sendReadReceipts && this.isConnected()) {
      try {
        await this.client.markRead(ids, chatJid, senderJid);
      } catch (err) {
        console.error('[WA] Failed to send read receipts:', err.message);
      }
    }

    return this.messageStore.markRead({ chatJid, messageIds });
  }

  // ── Retry & Timeout Helpers ─────────────────────────────────

  async _withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async _withRetry(fn, label, maxRetries = 1) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        this._recordError(err);
        const errType = classifyError(err);
        if (errType.type !== 'transient' || attempt === maxRetries) {
          throw err;
        }
        const isMediaUpload = label === 'uploadMedia';
        const delay = isMediaUpload ? 4000 * (attempt + 1) : 2000 * (attempt + 1);
        console.error(`[WA] ${label} failed (${err.message}), retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  // ── Message Handling ────────────────────────────────────────

  _trackSentId(id) {
    if (!id) return;
    this._sentMessageIds.add(id);
    if (this._sentMessageIds.size > 1000) {
      const oldest = this._sentMessageIds.values().next().value;
      this._sentMessageIds.delete(oldest);
    }
  }

  _handleIncomingMessage(evt) {
    const msg = this._persistMessage(evt, false);
    if (!msg) return;

    // Skip messages that THIS server process sent (prevent echo loops).
    // Allow isFromMe messages from OTHER devices on the same account —
    // these are legitimate incoming messages for wait_for_message & approvals.
    if (msg.id && this._sentMessageIds.has(msg.id)) {
      this._sentMessageIds.delete(msg.id);
      return;
    }

    this._checkApprovalResponse(msg);

    if (!msg.isFromMe && this._autoReadReceipts && msg.id && msg.chatJid) {
      this.client.markRead([msg.id], msg.chatJid, msg.senderJid).catch(() => {});
    }

    this.onMessage(msg);
    this._notifyMessageWaiters(msg);
  }

  /**
   * Register a waiter that resolves when the next matching incoming message arrives.
   * @param {Function|null} filter - Predicate (msg) => boolean, or null to match any
   * @param {Function} resolve - Called with the matching message object
   */
  addMessageWaiter(filter, resolve) {
    this._messageWaiters.push({ filter, resolve });
  }

  _notifyMessageWaiters(msg) {
    const remaining = [];
    for (const w of this._messageWaiters) {
      if (!w.filter || w.filter(msg)) {
        w.resolve(msg);
      } else {
        remaining.push(w);
      }
    }
    this._messageWaiters = remaining;
  }

  _persistMessage(evt, isHistorySync) {
    try {
      const info = evt.info;
      const rawMessage = evt.message || null;
      const mediaInfo = rawMessage ? this._extractMediaInfo(rawMessage) : null;

      const msg = {
        id:
          info?.id ||
          evt.id ||
          evt.key?.id ||
          `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        chatJid: info?.chat || evt.chatJID || evt.key?.remoteJID || evt.from || null,
        senderJid: info?.sender || evt.senderJID || evt.key?.participant || evt.from || null,
        senderName: info?.pushName || evt.pushName || evt.senderName || null,
        body:
          evt.text ||
          evt.body ||
          rawMessage?.conversation ||
          rawMessage?.extendedTextMessage?.text ||
          '',
        timestamp: info?.timestamp || evt.timestamp || Math.floor(Date.now() / 1000),
        isFromMe: info?.isFromMe ?? evt.isFromMe ?? evt.key?.fromMe ?? false,
        hasMedia: !!(evt.mediaType || evt.hasMedia || mediaInfo),
        mediaType: evt.mediaType || mediaInfo?.type || null
      };

      this.messageStore.addMessage(msg);

      if (mediaInfo && msg.id) {
        this.messageStore.updateMediaInfo(msg.id, {
          mimetype: mediaInfo.mimetype,
          filename: mediaInfo.filename,
          rawJson: JSON.stringify(rawMessage)
        });
      }

      if (msg.chatJid) {
        const chatName = evt.chatName || evt.pushName || null;
        const isGroup = isGroupJid(msg.chatJid);
        this.messageStore.upsertChat(
          msg.chatJid,
          chatName,
          isGroup,
          msg.timestamp,
          msg.body?.substring(0, 100)
        );

        if (!chatName && !isHistorySync) {
          const existing = this.messageStore.getChatByJid(msg.chatJid);
          if (!existing?.name || existing.name === msg.chatJid) {
            this._resolveAndUpdateName(msg.chatJid, isGroup);
          }
        }
      }

      return msg;
    } catch (e) {
      console.error('[WA] Failed to persist message:', e.message);
      return null;
    }
  }

  async _resolveAndUpdateName(jid, isGroup) {
    try {
      const name = isGroup ? await this.resolveGroupName(jid) : await this.resolveContactName(jid);
      if (name) {
        this.messageStore.updateChatName(jid, name);
      }
    } catch (error) {
      this.logger.error(`[WA] Name resolution failed for ${jid}:`, error.message);
    }
  }

  async _ensureWelcomeGroup() {
    const groupName = process.env.WELCOME_GROUP_NAME || 'WhatsAppMCP';
    try {
      const existing = this.messageStore
        .getAllChatsForMatching()
        .find((c) => c.name === groupName && c.jid?.endsWith('@g.us'));

      if (existing) {
        console.error(`[WA] Welcome group "${groupName}" already exists (${existing.jid})`);
        return;
      }

      console.error(`[WA] Creating welcome group "${groupName}"...`);
      const group = await this.client.createGroup(groupName, []);
      console.error(`[WA] Group created: ${group.jid}`);

      this.messageStore.upsertChat(group.jid, groupName, true, Math.floor(Date.now() / 1000), null);

      await this.sendMessage(
        group.jid,
        `Hello from ${groupName} Server! Connected as ${this.jid}.`
      );
      console.error(`[WA] Welcome message sent to ${groupName}`);
    } catch (err) {
      console.error(`[WA] Welcome group setup failed: ${err.message}`);
    }
  }

  _checkApprovalResponse(msg) {
    if (!msg.body) return;

    const text = msg.body.toLowerCase().trim();
    const idMatch = msg.body.match(/approval_\w+/);

    const pendingApprovals = this.messageStore.getPendingApprovals();
    if (pendingApprovals.length === 0) return;

    let targetApproval = null;
    if (idMatch) {
      targetApproval = pendingApprovals.find((a) => a.id === idMatch[0]);
    }
    if (!targetApproval) {
      targetApproval = pendingApprovals.find((a) => a.to_jid === msg.chatJid);
    }
    if (!targetApproval) return;

    const isApproved = matchesApprovalKeywords(text, APPROVAL_KEYWORDS.APPROVE);
    const isDenied = matchesApprovalKeywords(text, APPROVAL_KEYWORDS.DENY);

    if (isApproved && !isDenied) {
      this.messageStore.respondToApproval(targetApproval.id, true, msg.body);
      console.error('[WA] Approval', targetApproval.id, 'APPROVED');
    } else if (isDenied && !isApproved) {
      this.messageStore.respondToApproval(targetApproval.id, false, msg.body);
      console.error('[WA] Approval', targetApproval.id, 'DENIED');
    }
  }

  // ── Public API ───────────────────────────────────────────────

  isConnected() {
    return this._connected && !!this.jid;
  }

  /** True if a session was loaded from disk at startup or is currently authenticated. */
  get hasSession() {
    return this._sessionExists || !!this.jid;
  }

  /**
   * Health check method for Docker HEALTHCHECK
   * Verifies actual WhatsApp connectivity, not just file existence
   * @returns {Promise<{healthy: boolean, reason?: string}>}
   */
  async checkHealth() {
    if (!this._connected || !this.jid) {
      return { healthy: false, reason: 'not_connected' };
    }

    try {
      // Check if client reports being connected/logged in
      const alive = this.client?.isConnected?.() ?? this.client?.isLoggedIn?.() ?? true;
      if (!alive) {
        return { healthy: false, reason: 'client_disconnected' };
      }

      // Check uptime - if recently connected, consider healthy
      if (this._connectedAt && Date.now() - this._connectedAt < 30000) {
        return { healthy: true };
      }

      // For long-running connections, verify we can get basic info
      try {
        await this.client.getContact(this.jid);
        return { healthy: true };
      } catch (err) {
        return { healthy: false, reason: 'contact_check_failed' };
      }
    } catch (err) {
      return { healthy: false, reason: `health_check_error: ${err.message}` };
    }
  }

  async generateQrImage(data) {
    // Large margin (16 modules) for better QR code scanning
    const buf = await QRCode.toBuffer(data, {
      width: 320,
      margin: 16,
      errorCorrectionLevel: 'M'
    });
    return buf.toString('base64');
  }

  async requestPairingCode(phoneNumber) {
    if (this.isConnected()) {
      return { alreadyConnected: true, jid: this.jid };
    }

    // Cancel any previous pending pair resolve to prevent timer/callback leaks
    if (this._pendingPairResolve) {
      const prev = this._pendingPairResolve;
      this._pendingPairResolve = null;
      try { prev(); } catch { /* ignore */ }
    }

    this._authInProgress = true;

    // Ensure the WebSocket connection has been initiated before calling pairCode.
    // The correct pairing sequence is: connect() → wait → pairCode().
    // If AUTO_CONNECT_ON_STARTUP=false, connect() was never called by initialize().
    if (!this._connectCalled) {
      console.error('[WA] Connection not yet initiated — connecting for authentication...');
      await this._connectWithRetry();
      this._connectCalled = true;
      console.error('[WA] WebSocket connect() completed');
      // Allow the connection to stabilize before calling pairCode — the Go bridge
      // needs a moment after connect() before it can accept pairing requests.
      await new Promise((r) => setTimeout(r, 5000));
    }

    // If a session exists on disk, the connected event may fire shortly after connect().
    // Wait briefly to catch session restores before attempting a new pairing.
    if (this._sessionExists) {
      const ready = await this.waitForReady(5000);
      if (ready.connected) {
        this._authInProgress = false;
        return { alreadyConnected: true, jid: ready.jid };
      }
    }

    const digits = phoneNumber.replace(/[^0-9]/g, '');
    console.error(`[WA] Requesting pairing code for ${digits}`);

    try {
      const code = await this.client.pairCode(digits);

      let pairingTimeoutId;
      const waitForConnection = new Promise((resolve) => {
        let settled = false;
        const onConnected = () => finish({ connected: true });
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(pairingTimeoutId);
          if (this._pendingPairResolve === onConnected) {
            this._pendingPairResolve = null;
          }
          resolve(result);
        };
        this._pendingPairResolve = onConnected;
        pairingTimeoutId = setTimeout(() => {
          if (this._pendingPairResolve === onConnected) {
            this._pendingPairResolve = null;
          }
          finish({ connected: false, reason: 'pairing_wait_timeout' });
        }, 120_000);
      });

      return { alreadyConnected: false, code, waitForConnection };
    } catch (pairErr) {
      console.error(`[WA] Pairing code failed (${pairErr.message}), switching to QR code mode`);

      // Switch to QR mode: close current unauthenticated connection, set up QR channel,
      // then reconnect. getQRChannel() must be called before connect() for QR events to flow.
      try {
        await this.client.disconnect();
        await this.client.getQRChannel();
        await this._connectWithRetry();
        console.error('[WA] Switched to QR code mode — waiting for QR code...');
      } catch (switchErr) {
        console.error('[WA] Failed to switch to QR mode:', switchErr.message);
      }

      // Wait for a fresh QR code from the Go bridge (up to 30 seconds)
      const qrCode = await this.waitForFreshQR(30000);
      if (qrCode) {
        const qrImageBase64 = await this.generateQrImage(qrCode);
        return { alreadyConnected: false, qrCode, qrImageBase64 };
      }

      this._authInProgress = false;
      throw pairErr;
    }
  }

  async sendMessage(jid, text) {
    if (!this.isConnected()) {
      throw new Error('WhatsApp not connected. Use the authenticate tool first.');
    }

    return this._withRetry(async () => {
      const result = await this.client.sendMessage(jid, { conversation: text });
      const id = result?.id || result?.key?.id;
      this._trackSentId(id);
      return {
        id,
        timestamp: result?.timestamp || Math.floor(Date.now() / 1000)
      };
    }, 'sendMessage');
  }

  async getChats() {
    if (!this.isConnected()) {
      throw new Error('WhatsApp not connected.');
    }
    try {
      return await this.client.getChats();
    } catch {
      return [];
    }
  }

  async resolveGroupName(jid) {
    if (!this.isConnected() || typeof jid !== 'string' || !jid.endsWith('@g.us')) return null;
    try {
      const info = await this.client.getGroupInfo(jid);
      return info?.subject || info?.name || null;
    } catch {
      return null;
    }
  }

  async resolveContactName(jid) {
    if (!this.isConnected()) return null;
    try {
      const contact = await this.client.getContact(jid);
      return contact?.fullName || contact?.pushName || null;
    } catch {
      return null;
    }
  }

  _extractMediaInfo(message) {
    if (!message) return null;
    if (message.imageMessage) {
      return { type: 'image', mimetype: message.imageMessage.mimetype, filename: null };
    }
    if (message.videoMessage) {
      return { type: 'video', mimetype: message.videoMessage.mimetype, filename: null };
    }
    if (message.audioMessage) {
      return { type: 'audio', mimetype: message.audioMessage.mimetype, filename: null };
    }
    if (message.documentMessage) {
      return {
        type: 'document',
        mimetype: message.documentMessage.mimetype,
        filename: message.documentMessage.fileName || message.documentMessage.title || null
      };
    }
    if (message.stickerMessage) {
      return { type: 'sticker', mimetype: message.stickerMessage.mimetype, filename: null };
    }
    return null;
  }

  async downloadMedia(messageId) {
    if (!this.isConnected()) {
      throw new Error('WhatsApp not connected.');
    }

    const dbMsg = this.messageStore.db
      .prepare('SELECT media_raw_json, media_type, chat_jid FROM messages WHERE id = ?')
      .get(messageId);

    if (!dbMsg?.media_raw_json) {
      throw new Error(
        'No media metadata stored for this message. Media may have been received before metadata tracking was enabled.'
      );
    }

    const rawMessage = JSON.parse(decrypt(dbMsg.media_raw_json));

    const tempPath = await this._withRetry(
      () => this.client.downloadAny(rawMessage),
      'downloadMedia'
    );

    const safeType = sanitizeFilename(dbMsg.media_type || 'other');
    const mediaDir = `${this.storePath}/media/${safeType}`;
    await mkdir(mediaDir, { recursive: true });

    const rawExt = path.extname(tempPath) || this._defaultExt(dbMsg.media_type);
    const safeExt = sanitizeFilename(rawExt);
    const safeId = sanitizeFilename(messageId);
    const dest = path.join(
      mediaDir,
      `${safeId}${safeExt.startsWith('.') ? safeExt : '.' + safeExt}`
    );

    assertPathWithin(dest, `${this.storePath}/media`);

    const extCheck = checkExtension(dest);
    if (extCheck.dangerous) {
      console.error(`[FILEGUARD] Blocked file with restricted extension: ${dest}`);
      throw new Error(extCheck.warning);
    }

    await copyFile(tempPath, dest);

    this.messageStore.updateMediaInfo(messageId, { localPath: dest });

    return { path: dest, mediaType: dbMsg.media_type, chatJid: dbMsg.chat_jid };
  }

  async uploadAndSendMedia(jid, filePath, mediaType, caption) {
    if (!this.isConnected()) {
      throw new Error('WhatsApp not connected. Use the authenticate tool first.');
    }

    const uploadResult = await this._withRetry(
      () => this.client.uploadMedia(filePath, mediaType),
      'uploadMedia',
      3
    );

    const filename = path.basename(filePath);
    const mimeMap = {
      image: 'image/jpeg',
      video: 'video/mp4',
      audio: 'audio/ogg',
      document: 'application/octet-stream'
    };
    const mimetype = mimeMap[mediaType] || 'application/octet-stream';

    let message;
    switch (mediaType) {
      case 'image':
        message = { imageMessage: { caption, mimetype, ...uploadResult } };
        break;
      case 'video':
        message = { videoMessage: { caption, mimetype, ...uploadResult } };
        break;
      case 'audio':
        message = {
          audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, ...uploadResult }
        };
        break;
      case 'document':
        message = {
          documentMessage: {
            title: filename,
            caption,
            mimetype,
            fileName: filename,
            ...uploadResult
          }
        };
        break;
      default:
        message = {
          documentMessage: { title: filename, mimetype, fileName: filename, ...uploadResult }
        };
    }

    const result = await this._withRetry(
      () => this.client.sendRawMessage(jid, message),
      'sendRawMessage'
    );
    const id = result?.id || result?.key?.id;
    this._trackSentId(id);
    return {
      id,
      timestamp: result?.timestamp || Math.floor(Date.now() / 1000),
      mediaType
    };
  }

  _defaultExt(mediaType) {
    const map = { image: '.jpg', video: '.mp4', audio: '.ogg', document: '.bin', sticker: '.webp' };
    return map[mediaType] || '.bin';
  }

  // ── Group Management ─────────────────────────────────────────────────────────

  async createGroup(name, participantJids) {
    return this._withRetry(() => this.client.createGroup(name, participantJids), 'createGroup');
  }

  async getGroupInfo(jid) {
    return this._withRetry(() => this.client.getGroupInfo(jid), 'getGroupInfo');
  }

  async getJoinedGroups() {
    return this._withRetry(() => this.client.getJoinedGroups(), 'getJoinedGroups');
  }

  async getGroupInviteLink(jid) {
    const link = await this._withRetry(() => this.client.getGroupInviteLink(jid), 'getGroupInviteLink');
    return link;
  }

  async joinGroupWithLink(code) {
    return this._withRetry(() => this.client.joinGroupWithLink(code), 'joinGroupWithLink');
  }

  async leaveGroup(jid) {
    return this._withRetry(() => this.client.leaveGroup(jid), 'leaveGroup');
  }

  async updateGroupParticipants(jid, participantJids, action) {
    return this._withRetry(
      () => this.client.updateGroupParticipants(jid, participantJids, action),
      'updateGroupParticipants'
    );
  }

  async setGroupName(jid, name) {
    return this._withRetry(() => this.client.setGroupName(jid, name), 'setGroupName');
  }

  async setGroupTopic(jid, topic) {
    return this._withRetry(() => this.client.setGroupTopic(jid, topic), 'setGroupTopic');
  }

  // ── Message Actions ──────────────────────────────────────────────────────────

  async sendReaction(jid, messageId, emoji) {
    return this._withRetry(
      () => this.client.sendReaction(jid, messageId, emoji),
      'sendReaction'
    );
  }

  async editMessage(jid, messageId, newText) {
    return this._withRetry(
      () => this.client.editMessage(jid, messageId, { conversation: newText }),
      'editMessage'
    );
  }

  async revokeMessage(jid, messageId) {
    return this._withRetry(() => this.client.revokeMessage(jid, messageId), 'revokeMessage');
  }

  async createPoll(jid, question, options, allowMultiple) {
    const result = await this._withRetry(
      () => this.client.sendPollCreation(jid, question, options, allowMultiple ? options.length : 1),
      'createPoll'
    );
    const id = result?.id || result?.key?.id;
    this._trackSentId(id);
    return { id };
  }

  // ── Contact Info ─────────────────────────────────────────────────────────────

  async getUserInfo(jids) {
    return this._withRetry(() => this.client.getUserInfo(jids), 'getUserInfo');
  }

  async isOnWhatsApp(phones) {
    return this._withRetry(() => this.client.isOnWhatsApp(phones), 'isOnWhatsApp');
  }

  async getProfilePicture(jid) {
    return this._withRetry(() => this.client.getProfilePicture(jid), 'getProfilePicture');
  }

  /**
   * Explicit logout: disconnects from WhatsApp AND deletes the local session file.
   * Called by the 'disconnect' MCP tool. Requires full re-authentication afterwards.
   */
  async logout() {
    this._stopHealthCheck();

    // Cancel any pending pairing flow
    if (this._pendingPairResolve) {
      this._pendingPairResolve = null;
    }
    // Cancel any ready/QR/message waiters
    for (const resolve of this._readyWaiters.splice(0)) {
      try { resolve({ connected: false }); } catch { /* ignore */ }
    }
    for (const resolve of this._qrWaiters.splice(0)) {
      try { resolve(null); } catch { /* ignore */ }
    }
    for (const w of this._messageWaiters.splice(0)) {
      try { w.resolve(null); } catch { /* ignore */ }
    }

    if (this.client) {
      try {
        await this.client.sendPresence('unavailable');
      } catch (error) {
        this.logger.error('[WA] Error sending presence during logout:', error.message);
      }
      try {
        await this.client.disconnect();
      } catch (error) {
        this.logger.error('[WA] Error during logout disconnect:', error.message);
      }
      try {
        await this.client.close();
      } catch (error) {
        this.logger.error('[WA] Error closing client during logout:', error.message);
      }
    }
    this._connected = false;
    this._authInProgress = false;
    this._connectCalled = false;
    // Delete session file — _cleanupSession also clears jid and _sessionExists
    await this._cleanupSession();
  }

  /**
   * Graceful shutdown disconnect: closes the WebSocket and terminates the Go
   * subprocess. Session file is preserved on disk so the session can be resumed
   * on next container start.
   * Called on SIGINT/SIGTERM and in test teardown.
   */
  async disconnect() {
    this._stopHealthCheck();
    if (this.client) {
      try {
        await this.client.sendPresence('unavailable');
      } catch (error) {
        this.logger.error('[WA] Error sending presence during disconnect:', error.message);
      }
      try {
        await this.client.disconnect();
      } catch (error) {
        this.logger.error('[WA] Error during disconnect:', error.message);
      }
      try {
        await this.client.close();
      } catch (error) {
        this.logger.error('[WA] Error closing client subprocess:', error.message);
      }
      this._connected = false;
    }
  }
}
