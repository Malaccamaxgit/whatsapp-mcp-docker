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
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { isGroupJid } from '../utils/phone.js';
import { isLidJid, isPhoneJid, extractPhoneNumber } from '../utils/jid-utils.js';
import { assertPathWithin, sanitizeFilename, checkExtension } from '../security/file-guard.js';
import { decrypt } from '../security/crypto.js';
import { debug } from '../utils/debug.js';
import { classifyError } from '../utils/errors.js';
import { PERMANENT_LOGOUT_REASONS, APPROVAL_KEYWORDS } from '../constants.js';
import type { MessageStore } from './store.js';

// ── Type declarations for @whatsmeow-node/whatsmeow-node (no bundled .d.ts) ──

export interface WhatsmeowClient {
  init(): Promise<{ jid: string | null }>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  close(): Promise<void>;
  on(event: 'connected', cb: (data: { jid: string }) => void): void;
  on(event: 'logged_out', cb: (data: { reason: string }) => void): void;
  on(event: 'qr', cb: (data: { code: string }) => void): void;
  on(event: 'message', cb: (evt: WaMessageEvent) => void): void;
  on(event: 'history_sync', cb: (evt: HistorySyncEvent) => void): void;
  on(event: string, cb: (data: unknown) => void): void;
  isConnected?(): boolean;
  isLoggedIn?(): boolean;
  getQRChannel(): Promise<void>;
  pairCode(digits: string): Promise<string>;
  sendPresence(mode: string): Promise<void>;
  setForceActiveDeliveryReceipts(enabled: boolean): Promise<void>;
  markRead(ids: string[], chatJid: string, senderJid: string | null | undefined): Promise<void>;
  sendMessage(jid: string, message: { conversation: string }): Promise<SendResult>;
  sendRawMessage(jid: string, message: object): Promise<SendResult>;
  getChats?(): Promise<unknown[]>;
  getGroupInfo(jid: string): Promise<{ subject?: string; name?: string } | null>;
  getContact?(jid: string): Promise<{ fullName?: string; pushName?: string } | null>;
  createGroup(name: string, participants: string[]): Promise<{ jid: string }>;
  getJoinedGroups(): Promise<unknown[]>;
  getGroupInviteLink(jid: string): Promise<string>;
  joinGroupWithLink(code: string): Promise<unknown>;
  leaveGroup(jid: string): Promise<void>;
  updateGroupParticipants(jid: string, participants: string[], action: string): Promise<unknown>;
  setGroupName(jid: string, name: string): Promise<void>;
  setGroupTopic(jid: string, topic: string): Promise<void>;
  sendReaction(jid: string, messageId: string, emoji: string): Promise<unknown>;
  editMessage(jid: string, messageId: string, message: { conversation: string }): Promise<unknown>;
  revokeMessage(jid: string, messageId: string): Promise<unknown>;
  sendPollCreation(jid: string, question: string, options: string[], maxSelections: number): Promise<SendResult>;
  getUserInfo(jids: string[]): Promise<unknown>;
  isOnWhatsApp(phones: string[]): Promise<unknown>;
  getProfilePicture(jid: string): Promise<unknown>;
  uploadMedia(filePath: string, mediaType: string): Promise<object>;
  downloadAny(message: object): Promise<string>;
}

interface SendResult {
  id?: string;
  key?: { id?: string };
  timestamp?: number;
}

interface WaMessageEvent {
  info?: {
    id?: string;
    chat?: string;
    sender?: string;
    pushName?: string;
    timestamp?: number;
    isFromMe?: boolean;
  };
  id?: string;
  key?: { id?: string; remoteJID?: string; participant?: string; fromMe?: boolean };
  from?: string;
  chatJID?: string;
  senderJID?: string;
  pushName?: string;
  senderName?: string;
  text?: string;
  body?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { mimetype?: string; caption?: string };
    videoMessage?: { mimetype?: string; caption?: string };
    audioMessage?: { mimetype?: string };
    documentMessage?: { mimetype?: string; fileName?: string; title?: string; caption?: string };
    stickerMessage?: { mimetype?: string };
    ephemeralMessage?: { message?: { conversation?: string; extendedTextMessage?: { text?: string } } };
    viewOnceMessage?: { message?: { conversation?: string; extendedTextMessage?: { text?: string } } };
    viewOnceMessageV2?: { message?: { conversation?: string; extendedTextMessage?: { text?: string } } };
    viewOnceMessageV2Extension?: { message?: { conversation?: string } };
    listResponseMessage?: { title?: string; singleSelectReply?: { selectedRowId?: string } };
    buttonsResponseMessage?: { selectedButtonId?: string };
    templateButtonReplyMessage?: { selectedId?: string };
    pollCreationMessage?: { name?: string };
    contactMessage?: Record<string, unknown>;
    locationMessage?: Record<string, unknown>;
    pollCreationMessageV2?: Record<string, unknown>;
    pollCreationMessageV3?: Record<string, unknown>;
    reactionMessage?: Record<string, unknown>;
    listMessage?: Record<string, unknown>;
    protocolMessage?: {
      type?: number;
      pollUpdateMessage?: {
        pollCreationMessageKey?: { id?: string };
        vote?: { selectedOption?: string; selectedOptions?: string[] };
      };
    };
    pollUpdateMessage?: {
      pollCreationMessageKey?: { id?: string };
      vote?: { selectedOption?: string; selectedOptions?: string[] };
    };
  };
  timestamp?: number;
  isFromMe?: boolean;
  mediaType?: string;
  hasMedia?: boolean;
  chatName?: string;
}

interface HistorySyncConversation {
  id?: string;
  displayName?: string;
  name?: string;
  messages?: WaMessageEvent[];
}

interface HistorySyncEvent {
  conversations?: HistorySyncConversation[];
  messages?: WaMessageEvent[];
}

export interface StoredMessage {
  id: string;
  chatJid: string | null;
  senderJid: string | null;
  senderName: string | null;
  body: string;
  timestamp: number;
  isFromMe: boolean;
  hasMedia: boolean;
  mediaType: string | null;
  pollMetadata?: {
    pollCreationMessageKey?: string;
    voteOptions?: string[];
  };
}

interface MediaInfo {
  type: string;
  mimetype: string | undefined | null;
  filename: string | null;
}

interface MediaDbRow {
  media_raw_json: string | null;
  media_type: string | null;
  chat_jid: string;
}

export interface WaitReadyResult {
  connected: boolean;
  jid?: string;
}

interface MessageWaiter {
  filter: ((msg: StoredMessage) => boolean) | null;
  resolve: (msg: StoredMessage | null) => void;
}

interface RecentError {
  time: number;
  message: string;
}

export interface HealthStats {
  uptime: number;
  recentErrorCount: number;
  reconnecting: boolean;
  logoutReason: string | null;
}

interface ClientConfig {
  STORE_PATH?: string;
  SEND_READ_RECEIPTS?: string | boolean;
  AUTO_READ_RECEIPTS?: string | boolean;
  PRESENCE_MODE?: string;
}

export interface WhatsAppClientOptions {
  storePath?: string;
  messageStore: MessageStore;
  onMessage?: (msg: StoredMessage) => void;
  onConnected?: () => void;
  onDisconnected?: (info: { reason: string | null; permanent: boolean }) => void;
  client?: WhatsmeowClient | null;
  config?: ClientConfig;
  logger?: { error: (...args: unknown[]) => void };
}

type PairingCodeResult =
  | { alreadyConnected: true; jid: string }
  | { alreadyConnected: false; code: string; waitForConnection: Promise<WaitReadyResult> }
  | { alreadyConnected: false; qrCode: string; qrImageBase64: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Match text against approval keywords using word boundaries for text keywords
 * and substring match for emoji, preventing false positives like "nobody" → "no".
 */
function matchesApprovalKeywords (text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => {
    // Emoji characters: use simple substring match (they don't form partial words)
    if (/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(k)) {return text.includes(k);}
    // Text keywords: require whole-word match to avoid e.g. "nobody" triggering "no"
    return new RegExp(`\\b${k}\\b`, 'i').test(text);
  });
}

function resolveMuslBinary (): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve('@whatsmeow-node/linux-x64-musl/bin/whatsmeow-node');
  } catch {
    return undefined;
  }
}

// ── Debug ─────────────────────────────────────────────────────────────────────

const log = debug('client');

// ── Class ─────────────────────────────────────────────────────────────────────

export class WhatsAppClient {
  storePath: string;
  messageStore: MessageStore;
  onMessage: (msg: StoredMessage) => void;
  onConnected: () => void;
  onDisconnected: (info: { reason: string | null; permanent: boolean }) => void;
  logger: { error: (...args: unknown[]) => void };

  client: WhatsmeowClient | null;
  jid: string | null;
  _connected: boolean;
  _pendingPairResolve: (() => void) | null;
  _lastQrCode: string | null;

  // Session lifecycle
  _logoutReason: string | null;
  _reconnecting: boolean;
  _connectedAt: number | null;
  _probeVerified: boolean;
  _probeLastError: string | null;

  // Health monitoring
  _healthInterval: ReturnType<typeof setInterval> | null;
  _recentErrors: RecentError[];

  // Auth state tracking
  _lastQrTimestamp: number | null;
  _authInProgress: boolean;
  _qrWaiters: ((code: string) => void)[];
  _readyWaiters: ((result: WaitReadyResult) => void)[];
  _connectCalled: boolean;
  _sessionExists: boolean;

  // Message waiters for wait_for_message tool
  _messageWaiters: MessageWaiter[];

  // Track message IDs sent by THIS server process
  _sentMessageIds: Set<string>;

  // Presence & receipts config
  _sendReadReceipts: string | boolean;
  _autoReadReceipts: string | boolean;
  _presenceMode: string;

  constructor ({
    storePath,
    messageStore,
    onMessage,
    onConnected,
    onDisconnected,
    client, // Optional: inject mock client for testing
    config = {}, // Optional: config object to override process.env
    logger = console // Optional: inject logger for testing
  }: WhatsAppClientOptions) {
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
    this._probeVerified = false;
    this._probeLastError = null;

    // Health monitoring
    this._healthInterval = null;
    this._recentErrors = [];

    // Auth state tracking
    this._lastQrTimestamp = null; // Timestamp of the most recent QR code event
    this._authInProgress = false; // True while user has explicitly triggered auth
    this._qrWaiters = []; // Resolve callbacks waiting for next QR event
    this._readyWaiters = []; // Resolve callbacks waiting for connected event
    this._connectCalled = false; // Whether connect() has been initiated at least once
    this._sessionExists = false; // Whether a session was loaded from disk at init

    // Message waiters for wait_for_message tool
    this._messageWaiters = []; // { filter, resolve } entries waiting for an incoming message

    // Track message IDs sent by THIS server process to distinguish
    // "server-originated" from "other-device echo" when isFromMe is true
    this._sentMessageIds = new Set();

    // Presence & receipts config (from config object or process.env)
    this._sendReadReceipts = config.SEND_READ_RECEIPTS !== undefined ? config.SEND_READ_RECEIPTS : (process.env.SEND_READ_RECEIPTS !== 'false');
    this._autoReadReceipts = config.AUTO_READ_RECEIPTS !== undefined ? config.AUTO_READ_RECEIPTS : (process.env.AUTO_READ_RECEIPTS !== 'false');
    this._presenceMode = config.PRESENCE_MODE || process.env.PRESENCE_MODE || 'available';
  }

  // ── Initialization ──────────────────────────────────────────

  async initialize ({ autoConnect = true } = {}): Promise<void> {
    this.client = createClient({
      store: `${this.storePath}/session.db`,
      binaryPath: resolveMuslBinary()
    }) as unknown as WhatsmeowClient;

    this._registerEvents();

    const { jid } = await this.client.init();
    this._sessionExists = Boolean(jid);

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

  async _connectWithRetry (maxAttempts = 5): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.client!.connect();
        return;
      } catch (err) {
        // The Go subprocess dies permanently after logout() calls client.close().
        // Recreate the entire client on the first such failure so re-authentication
        // works without requiring a container restart.
        if ((err as Error).message?.includes('Go process exited') && attempt === 1) {
          console.error('[WA] Go subprocess dead — reinitializing client for re-authentication...');
          try {
            await this._reinitializeClient();
            continue;
          } catch (reinitErr) {
            console.error('[WA] Reinitialize failed:', (reinitErr as Error).message);
          }
        }
        if (attempt === maxAttempts) {throw err;}
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        console.error(
          `[WA] Connect attempt ${attempt}/${maxAttempts} failed (${(err as Error).message}), retrying in ${delay}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  async _reinitializeClient (): Promise<void> {
    this.client = createClient({
      store: `${this.storePath}/session.db`,
      binaryPath: resolveMuslBinary()
    }) as unknown as WhatsmeowClient;
    this._registerEvents();
    const { jid } = await this.client.init();
    this._sessionExists = Boolean(jid);
    this._connectCalled = false;
    console.error('[WA] Client reinitialized');
  }

  /**
   * Wait for the authenticated 'connected' state, with a timeout.
   * Resolves immediately if already connected; otherwise waits for the
   * connected event or times out.
   */
  async waitForReady (timeoutMs = 5000): Promise<WaitReadyResult> {
    if (this.isConnected()) {return { connected: true, jid: this.jid! };}

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this._readyWaiters.indexOf(wrappedResolve);
        if (idx !== -1) {this._readyWaiters.splice(idx, 1);}
        resolve({ connected: false });
      }, timeoutMs);

      const wrappedResolve = (result: WaitReadyResult) => {
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
  async waitForFreshQR (timeoutMs = 30000): Promise<string | null> {
    if (this._lastQrCode && this._lastQrTimestamp && Date.now() - this._lastQrTimestamp < 15000) {
      return this._lastQrCode;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this._qrWaiters.indexOf(wrappedResolve);
        if (idx !== -1) {this._qrWaiters.splice(idx, 1);}
        resolve(null);
      }, timeoutMs);

      const wrappedResolve = (code: string) => {
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
  async reconnect (): Promise<WaitReadyResult> {
    if (this.isConnected()) {return { connected: true, jid: this.jid! };}

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

  _registerEvents (): void {
    this.client!.on('connected', ({ jid }) => {
      this.jid = jid;
      this._connected = true;
      this._logoutReason = null;
      this._reconnecting = false;
      this._connectedAt = Date.now();
      this._authInProgress = false;
      console.error('[WA] Connected as', jid);

      // Run a lightweight probe to verify the Go WebSocket is actually usable
      this._probeWebSocket().catch((err) => {
        this._probeVerified = false;
        this._probeLastError = (err as Error).message;
        console.error('[WA] WebSocket probe failed:', (err as Error).message);
      });

      // Notify any waiters for ready/authenticated state
      const readyWaiters = this._readyWaiters.splice(0);
      for (const resolve of readyWaiters) {resolve({ connected: true, jid });}

      this.onConnected();
      this._startHealthCheck();
      this._setupPresence();
      this._ensureWelcomeGroup();
      this.cleanupQrCodeFile().catch((err) => {
        this.logger.error('[WA] QR cleanup failed:', (err as Error).message);
      });

      if (this._pendingPairResolve) {
        this._pendingPairResolve();
        this._pendingPairResolve = null;
      }
    });

    this.client!.on('logged_out', ({ reason }) => {
      console.error('[WA] Logged out:', reason);
      this._connected = false;
      this.jid = null;
      this._logoutReason = reason || 'unknown';
      this._probeVerified = false;
      this._probeLastError = null;
      this._stopHealthCheck();

      const permanent = this._isPermanentLogout(reason);

      if (permanent) {
        this._cleanupSession();
        this.onDisconnected({ reason: this._logoutReason, permanent: true });
      } else {
        this._attemptReconnect();
      }
    });

    this.client!.on('qr', ({ code }) => {
      this._lastQrCode = code;
      this._lastQrTimestamp = Date.now();

      // Notify any waiters for a fresh QR code
      const qrWaiters = this._qrWaiters.splice(0);
      for (const resolve of qrWaiters) {resolve(code);}

      // Only render QR art to the terminal when auth is explicitly in progress.
      // Suppresses the spurious QR codes that appear in logs during initialization,
      // where multiple codes fire before the user has triggered the authenticate tool.
      if (this._authInProgress) {
        console.error('[WA] QR code available — scan with WhatsApp > Linked Devices > Link a Device');
        console.error(`[WA-QR] ${code}`);
        QRCode.toString(code, { type: 'terminal', small: true }, (err, art) => {
          if (!err && art) {console.error(art);}
        });
      } else {
        console.error('[WA] QR code received (suppressed — call authenticate tool to display)');
      }
    });

    this.client!.on('message', (evt) => {
      this._handleIncomingMessage(evt as WaMessageEvent);
    });

    this.client!.on('history_sync', (evt) => {
      const hsEvt = evt as HistorySyncEvent;
      let count = 0;
      const recentThreshold = Math.floor(Date.now() / 1000) - 120;
      const recentIncoming: StoredMessage[] = [];

      if (hsEvt.conversations) {
        for (const conv of hsEvt.conversations) {
          if (!conv.id) {continue;}
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

      if (hsEvt.messages) {
        for (const rawMsg of hsEvt.messages) {
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
        if (msg.id && this._sentMessageIds.has(msg.id)) {continue;}
        this._checkApprovalResponse(msg);
        this._notifyMessageWaiters(msg);
      }
    });
  }

  // ── Session Lifecycle ───────────────────────────────────────

  _isPermanentLogout (reason: string): boolean {
    if (!reason) {return false;}
    const lower = reason.toLowerCase();
    return PERMANENT_LOGOUT_REASONS.some((r) => lower.includes(r));
  }

  async _cleanupSession (): Promise<void> {
    const sessionPath = `${this.storePath}/session.db`;
    try {
      await unlink(sessionPath);
      console.error('[WA] session.db removed');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[WA] Failed to remove session.db:', (err as Error).message);
      }
    }
    this._sessionExists = false;
    this.jid = null;
  }

  async _attemptReconnect (): Promise<void> {
    if (this._reconnecting) {return;}
    this._reconnecting = true;

    const delay = 5000;
    console.error(`[WA] Transient disconnect — attempting reconnect in ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));

    try {
      await this.client!.connect();
      console.error('[WA] Reconnect succeeded');
    } catch (err) {
      console.error('[WA] Reconnect failed:', (err as Error).message);
      this._reconnecting = false;
      this.onDisconnected({ reason: this._logoutReason || 'reconnect_failed', permanent: false });
    }
  }

  // ── Health Monitoring ───────────────────────────────────────

  _startHealthCheck (): void {
    this._stopHealthCheck();
    this._healthInterval = setInterval(() => this._heartbeat(), 60_000);
  }

  _stopHealthCheck (): void {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  async _heartbeat (): Promise<void> {
    if (!this._connected) {return;}

    try {
      const alive = await this._withTimeout(
        Promise.resolve(this.client!.isConnected?.() ?? this.client!.isLoggedIn?.() ?? true),
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
      console.error('[WA] Health check error:', (err as Error).message);
      this._recordError(err as Error);
    }
  }

  _recordError (err: Error): void {
    const now = Date.now();
    this._recentErrors.push({ time: now, message: err.message });
    this._recentErrors = this._recentErrors.filter((e) => e.time > now - 300_000);
  }

  getHealthStats (): HealthStats {
    const now = Date.now();
    return {
      uptime: this._connectedAt ? Math.floor((now - this._connectedAt) / 1000) : 0,
      recentErrorCount: this._recentErrors.filter((e) => e.time > now - 300_000).length,
      reconnecting: this._reconnecting,
      logoutReason: this._logoutReason
    };
  }

  /** Return the current WebSocket probe verification status for diagnostics. */
  getProbeStatus (): { verified: boolean; lastError: string | null } {
    return { verified: this._probeVerified, lastError: this._probeLastError };
  }

  // ── Presence & Receipts ─────────────────────────────────────

  async _setupPresence (): Promise<void> {
    try {
      await this.client!.setForceActiveDeliveryReceipts(true);
      console.error('[WA] Delivery receipts enabled');
    } catch (err) {
      console.error('[WA] Failed to enable delivery receipts:', (err as Error).message);
    }

    try {
      await this.client!.sendPresence(this._presenceMode);
      console.error(`[WA] Presence set to "${this._presenceMode}"`);
    } catch (err) {
      // On a fresh link WhatsApp hasn't propagated the PushName yet — retry once
      // after a short delay rather than logging a confusing permanent error.
      if ((err as Error).message?.toLowerCase().includes('pushname')) {
        console.error('[WA] Presence deferred — PushName not set yet, retrying in 10s...');
        setTimeout(async () => {
          try {
            await this.client!.sendPresence(this._presenceMode);
            console.error(`[WA] Presence set to "${this._presenceMode}" (deferred)`);
          } catch (retryErr) {
            console.error('[WA] Failed to set presence (deferred retry):', (retryErr as Error).message);
          }
        }, 10_000);
      } else {
        console.error('[WA] Failed to set presence:', (err as Error).message);
      }
    }
  }

  async markMessagesRead ({ chatJid, messageIds, senderJid }: {
    chatJid: string | undefined;
    messageIds: string[] | null | undefined;
    senderJid: string | null | undefined;
  }): Promise<unknown> {
    const ids = messageIds || [];
    const sender = senderJid ?? undefined;

    if (ids.length > 0 && this._sendReadReceipts && this.isConnected() && chatJid) {
      try {
        await this.client!.markRead(ids, chatJid, sender);
      } catch (err) {
        console.error('[WA] Failed to send read receipts:', (err as Error).message);
      }
    }

    return this.messageStore.markRead({ chatJid: chatJid!, messageIds: ids });
  }

  // ── Retry & Timeout Helpers ─────────────────────────────────

  async _withTimeout<T> (promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  async _withRetry<T> (fn: () => Promise<T>, label: string, maxRetries = 1): Promise<T> {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err as Error;
        this._recordError(lastErr);
        const errType = classifyError(lastErr);
        if (errType.type !== 'transient' || attempt === maxRetries) {
          throw err;
        }
        const isMediaUpload = label === 'uploadMedia';
        const delay = isMediaUpload ? 4000 * (attempt + 1) : 2000 * (attempt + 1);
        console.error(`[WA] ${label} failed (${lastErr.message}), retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  // ── Message Handling ────────────────────────────────────────

  _trackSentId (id: string | undefined): void {
    if (!id) {return;}
    this._sentMessageIds.add(id);
    if (this._sentMessageIds.size > 1000) {
      const oldest = this._sentMessageIds.values().next().value;
      if (oldest) {this._sentMessageIds.delete(oldest);}
    }
  }

  _handleIncomingMessage (evt: WaMessageEvent): void {
    const msg = this._persistMessage(evt, false);
    if (!msg) {return;}

    // Skip messages that THIS server process sent (prevent echo loops).
    // Allow isFromMe messages from OTHER devices on the same account —
    // these are legitimate incoming messages for wait_for_message & approvals.
    if (msg.id && this._sentMessageIds.has(msg.id)) {
      this._sentMessageIds.delete(msg.id);
      return;
    }

    this._checkApprovalResponse(msg);

    if (!msg.isFromMe && this._autoReadReceipts && msg.id && msg.chatJid) {
      this.client!.markRead([msg.id], msg.chatJid, msg.senderJid ?? undefined).catch(() => {});
    }

    this.onMessage(msg);
    this._notifyMessageWaiters(msg);
  }

  /**
   * Register a waiter that resolves when the next matching incoming message arrives.
   * @param {Function|null} filter - Predicate (msg) => boolean, or null to match any
   * @param {Function} resolve - Called with the matching message object
   */
  addMessageWaiter (filter: ((msg: StoredMessage) => boolean) | null, resolve: (msg: StoredMessage | null) => void): void {
    this._messageWaiters.push({ filter, resolve });
  }

  _notifyMessageWaiters (msg: StoredMessage): void {
    const remaining: MessageWaiter[] = [];
    for (const w of this._messageWaiters) {
      if (!w.filter || w.filter(msg)) {
        w.resolve(msg);
      } else {
        remaining.push(w);
      }
    }
    this._messageWaiters = remaining;
  }

  _persistMessage (evt: WaMessageEvent, isHistorySync: boolean): StoredMessage | null {
    try {
      const info = evt.info;
      const rawMessage = evt.message || null;
      const mediaInfo = rawMessage ? this._extractMediaInfo(rawMessage) : null;

      // Fix chatJid extraction: for group participant messages, remoteJID is the group JID.
      // Without this, evt.from (sender JID) would be used as the chat JID, causing
      // group messages to be misrouted to individual contact chats.
      let chatJid: string | null = null;
      if (evt.key?.participant && evt.key?.remoteJID) {
        chatJid = evt.key.remoteJID;
      } else {
        chatJid = info?.chat || evt.chatJID || evt.key?.remoteJID || evt.from || null;
      }

      // Expand body extraction to cover all Go bridge field paths
      const body: string =
        evt.text ||
        evt.body ||
        rawMessage?.conversation ||
        rawMessage?.extendedTextMessage?.text ||
        rawMessage?.ephemeralMessage?.message?.conversation ||
        rawMessage?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        rawMessage?.viewOnceMessage?.message?.conversation ||
        rawMessage?.viewOnceMessage?.message?.extendedTextMessage?.text ||
        rawMessage?.imageMessage?.caption ||
        rawMessage?.videoMessage?.caption ||
        rawMessage?.documentMessage?.caption ||
        rawMessage?.listResponseMessage?.title ||
        rawMessage?.listResponseMessage?.singleSelectReply?.selectedRowId ||
        rawMessage?.buttonsResponseMessage?.selectedButtonId ||
        rawMessage?.templateButtonReplyMessage?.selectedId ||
        rawMessage?.pollCreationMessage?.name ||
        rawMessage?.pollUpdateMessage?.vote?.selectedOption ||
        rawMessage?.pollUpdateMessage?.vote?.selectedOptions?.join(', ') ||
        rawMessage?.protocolMessage?.pollUpdateMessage?.vote?.selectedOption ||
        rawMessage?.protocolMessage?.pollUpdateMessage?.vote?.selectedOptions?.join(', ') ||
        '';

      const msg: StoredMessage = {
        id:
          info?.id ||
          evt.id ||
          evt.key?.id ||
          `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        chatJid,
        senderJid: info?.sender || evt.senderJID || evt.key?.participant || evt.from || null,
        senderName: info?.pushName || evt.pushName || evt.senderName || null,
        body,
        timestamp: info?.timestamp || evt.timestamp || Math.floor(Date.now() / 1000),
        isFromMe: info?.isFromMe ?? evt.isFromMe ?? evt.key?.fromMe ?? false,
        hasMedia: Boolean(evt.mediaType || evt.hasMedia || mediaInfo),
        mediaType: evt.mediaType || mediaInfo?.type || null,
        pollMetadata: undefined
      };

      // Extract poll metadata for poll creation messages (after msg is defined)
      if (rawMessage?.pollCreationMessage) {
        const pollCreation = rawMessage.pollCreationMessage as Record<string, unknown>;
        const options = (pollCreation.options as Array<{ optionName?: string }> | undefined) || [];
        msg.pollMetadata = {
          pollCreationMessageKey: msg.id,
          voteOptions: options.map((opt) => opt.optionName || '').filter(Boolean)
        };
      }

      if (!msg.body && !msg.hasMedia) {
        log('Empty body event (isFromMe=%s, isHistorySync=%s): %s', String(msg.isFromMe), String(isHistorySync), JSON.stringify(evt));
      }

      this.messageStore.addMessage(msg);

      // Store poll vote if this is a poll update message
      if (rawMessage?.pollUpdateMessage || rawMessage?.protocolMessage?.pollUpdateMessage) {
        const pollUpdate = rawMessage.pollUpdateMessage || rawMessage.protocolMessage?.pollUpdateMessage;
        if (pollUpdate?.pollCreationMessageKey?.id) {
          this.messageStore.addPollVote({
            pollMessageId: pollUpdate.pollCreationMessageKey.id,
            voterJid: msg.senderJid || '',
            voterName: msg.senderName || null,
            voteOptions: pollUpdate.vote?.selectedOptions || (pollUpdate.vote?.selectedOption ? [pollUpdate.vote.selectedOption] : []),
            timestamp: msg.timestamp,
            chatJid: msg.chatJid || ''
          });
        }
      }

      if (mediaInfo && msg.id) {
        this.messageStore.updateMediaInfo(msg.id, {
          mimetype: mediaInfo.mimetype,
          filename: mediaInfo.filename,
          rawJson: JSON.stringify(rawMessage)
        });
      }

      if (msg.chatJid) {
        const isGroup = isGroupJid(msg.chatJid);
        // For groups, only use evt.chatName (the actual group name).
        // evt.pushName / info?.pushName is the *sender's* display name — using it for
        // group chats would overwrite the group name with the sender's name (Bug fix).
        const chatName = evt.chatName || (!isGroup ? (evt.pushName || info?.pushName) : null) || null;
        this.messageStore.upsertChat(
          msg.chatJid,
          chatName,
          isGroup,
          msg.timestamp,
          msg.body?.substring(0, 100)
        );

        // Store contact mapping for JID unification (non-blocking, best-effort)
        if (!isGroup && msg.senderJid && msg.senderName) {
          this._storeContactMapping(msg.chatJid, msg.senderJid, msg.senderName);
        }

        if (!chatName && !isHistorySync) {
          const existing = this.messageStore.getChatByJid(msg.chatJid);
          // For groups: always re-resolve from WhatsApp (async, non-blocking) because
          // the stored name may have been incorrectly set to a sender's pushName.
          // For DMs: only resolve when the name is unset (null or equal to JID).
          if (isGroup || !existing?.name || existing.name === msg.chatJid) {
            if (!isGroup && msg.senderName) {
              // For DMs, immediately store the sender's push name so that
              // resolveRecipient can match the contact by display name.
              this.messageStore.updateChatName(msg.chatJid, msg.senderName);
            } else {
              this._resolveAndUpdateName(msg.chatJid, isGroup);
            }
          }
        }
      }

      return msg;
    } catch (e) {
      console.error('[WA] Failed to persist message:', (e as Error).message);
      return null;
    }
  }

  async _resolveAndUpdateName (jid: string, isGroup: boolean): Promise<void> {
    try {
      const name = isGroup ? await this.resolveGroupName(jid) : await this.resolveContactName(jid);
      if (name) {
        this.messageStore.updateChatName(jid, name);
      }
    } catch (error) {
      this.logger.error(`[WA] Name resolution failed for ${jid}:`, (error as Error).message);
    }
  }

  /**
   * Store contact mapping between LID and phone JID formats.
   * This enables JID unification for duplicate contact detection.
   * Updated for Phase 4 multi-device support: stores devices in the new schema.
   * Non-blocking, best-effort operation.
   */
  _storeContactMapping (chatJid: string, senderJid: string, senderName: string): void {
    try {
      // Determine which JID is LID and which is phone-based
      let lidJid: string | null = null;
      let phoneJid: string | null = null;
      let phoneNumber: string | null = null;

      if (isLidJid(chatJid)) {
        lidJid = chatJid;
      } else if (isPhoneJid(chatJid)) {
        phoneJid = chatJid;
        phoneNumber = extractPhoneNumber(chatJid);
      }

      if (isLidJid(senderJid)) {
        lidJid = senderJid;
      } else if (isPhoneJid(senderJid)) {
        phoneJid = senderJid;
        phoneNumber = extractPhoneNumber(senderJid);
      }

      // Phase 4: Use new multi-device schema
      if (phoneNumber) {
        // Get or create contact by phone number
        const contact = this.messageStore.getOrCreateContactByPhone(phoneNumber, senderName);
        
        // Add LID device if present
        if (lidJid) {
          this.messageStore.addDeviceLid(phoneNumber, lidJid, {
            deviceType: 'unknown',
            deviceName: null,
            isPrimary: false,
            lastSeen: Math.floor(Date.now() / 1000)
          });
        }
        
        // Add phone JID if present
        if (phoneJid && contact.id) {
          this.messageStore.addPhoneJidToContact(contact.id, phoneJid);
        }
      }

      // Legacy fallback: also store in contact_mappings for backward compatibility
      if (lidJid || phoneJid) {
        this.messageStore.upsertContactMapping(
          lidJid || phoneJid!,
          phoneJid,
          phoneNumber,
          senderName
        );
      }

      // If we have a phone JID but no LID yet, try to resolve the LID from WhatsApp
      if (phoneJid && !lidJid && this.isConnected()) {
        this._resolveLidFromPhoneJid(phoneJid, senderName).catch((err) => {
          this.logger.error(`[WA] LID resolution failed for ${phoneJid}:`, (err as Error).message);
        });
      }
    } catch (error) {
      this.logger.error('[WA] Contact mapping storage failed:', (error as Error).message);
    }
  }

  /**
   * Resolve LID from a phone-based JID using WhatsApp's getUserInfo.
   * Updated for Phase 4 multi-device support.
   * @param phoneJid - The @s.whatsapp.net format JID
   * @param contactName - The contact name to store
   */
  async _resolveLidFromPhoneJid (phoneJid: string, contactName: string): Promise<void> {
    try {
      const userInfo = await this.client!.getUserInfo([phoneJid]);
      if (userInfo && typeof userInfo === 'object') {
        const info = userInfo as Record<string, any>;
        const lidJid = info[phoneJid]?.lid_jid || info[phoneJid]?.lid;
        
        if (lidJid && isLidJid(lidJid)) {
          const phoneNumber = extractPhoneNumber(phoneJid);
          
          // Phase 4: Use new multi-device schema
          if (phoneNumber) {
            const contact = this.messageStore.getOrCreateContactByPhone(phoneNumber, contactName || undefined);
            this.messageStore.addDeviceLid(phoneNumber, lidJid, {
              deviceType: 'unknown',
              deviceName: null,
              isPrimary: false,
              lastSeen: Math.floor(Date.now() / 1000)
            });
            
            // Also add phone JID if not already present
            if (contact.id) {
              this.messageStore.addPhoneJidToContact(contact.id, phoneJid);
            }
            
            // Legacy fallback for backward compatibility
            this.messageStore.upsertContactMapping(lidJid, phoneJid, phoneNumber, contactName);
            
            console.error(`[WA] Resolved LID mapping: ${lidJid} ↔ ${phoneJid}`);
          }
        }
      }
    } catch (error) {
      // Best-effort, don't throw
      this.logger.error(`[WA] getUserInfo failed for LID resolution:`, (error as Error).message);
    }
  }

  async _ensureWelcomeGroup (): Promise<void> {
    const groupName = process.env.WELCOME_GROUP_NAME || 'WhatsAppMCP';
    try {
      // 1. Check local DB first (fast path)
      const existing = this.messageStore
        .getAllChatsForMatching()
        .find((c) => c.name === groupName && c.jid?.endsWith('@g.us'));

      if (existing) {
        console.error(`[WA] Welcome group "${groupName}" already exists (${existing.jid})`);
        return;
      }

      // 2. Check WhatsApp directly — local DB name may be stale (e.g. corrupted by a
      //    previous bug). If the group already exists on WhatsApp, repair the local name
      //    and return without creating a duplicate.
      try {
        const joinedGroups = await this.client!.getJoinedGroups() as Array<{ jid?: string; subject?: string; name?: string }>;
        const remoteMatch = joinedGroups.find((g) => (g.subject || g.name) === groupName);
        if (remoteMatch?.jid) {
          console.error(`[WA] Welcome group "${groupName}" found on WhatsApp (${remoteMatch.jid}) — repairing local name`);
          this.messageStore.upsertChat(remoteMatch.jid, groupName, true, null, null);
          return;
        }
      } catch (lookupErr) {
        console.error(`[WA] Could not check joined groups: ${(lookupErr as Error).message}`);
      }

      console.error(`[WA] Creating welcome group "${groupName}"...`);
      const group = await this.client!.createGroup(groupName, []);
      console.error(`[WA] Group created: ${group.jid}`);

      this.messageStore.upsertChat(group.jid, groupName, true, Math.floor(Date.now() / 1000), null);

      await this.sendMessage(
        group.jid,
        `Hello from ${groupName} Server! Connected as ${this.jid}.`
      );
      console.error(`[WA] Welcome message sent to ${groupName}`);
    } catch (err) {
      console.error(`[WA] Welcome group setup failed: ${(err as Error).message}`);
    }
  }

  _checkApprovalResponse (msg: StoredMessage): void {
    if (!msg.body) {return;}

    const text = msg.body.toLowerCase().trim();
    const idMatch = msg.body.match(/approval_\w+/);

    const pendingApprovals = this.messageStore.getPendingApprovals();
    if (pendingApprovals.length === 0) {return;}

    let targetApproval = null;
    if (idMatch) {
      targetApproval = pendingApprovals.find((a) => a.id === idMatch[0]);
    }
    if (!targetApproval) {
      targetApproval = pendingApprovals.find((a) => a.to_jid === msg.chatJid);
    }
    if (!targetApproval) {return;}

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

  isConnected (): boolean {
    return this._connected && Boolean(this.jid) && this._probeVerified;
  }

  /**
   * Perform a lightweight RPC call to verify the Go WebSocket bridge is
   * actually responsive. This prevents false-positive connected states where
   * the 'connected' event fired but the Go subprocess isn't ready.
   */
  async _probeWebSocket (): Promise<void> {
    try {
      // Try getContact first (most reliable if available)
      if (typeof this.client!.getContact === 'function') {
        const result = await this._withTimeout(
          Promise.resolve(this.client!.getContact(this.jid!)),
          8000,
          'ws-probe'
        );
        this._probeVerified = result !== null && result !== undefined;
      } else if (typeof this.client!.getChats === 'function') {
        // Fallback to getChats if getContact is not available
        await this._withTimeout(
          Promise.resolve(this.client!.getChats()),
          8000,
          'ws-probe-fallback'
        );
        this._probeVerified = true;
      } else {
        // Last resort: just check if client reports connected
        // This is less reliable but better than nothing
        const alive = this.client?.isConnected?.() ?? this.client?.isLoggedIn?.() ?? true;
        this._probeVerified = alive;
        console.error('[WA] WebSocket probe: No RPC method available, using isConnected/isLoggedIn fallback');
      }
      this._probeLastError = null;
      console.error('[WA] WebSocket probe:', this._probeVerified ? 'PASSED' : 'FAILED (null response)');
    } catch (err) {
      this._probeVerified = false;
      this._probeLastError = (err as Error).message;
      throw err;
    }
  }

  /** True if a session was loaded from disk at startup or is currently authenticated. */
  get hasSession (): boolean {
    return this._sessionExists || Boolean(this.jid);
  }

  /**
   * Health check method for Docker HEALTHCHECK
   * Verifies actual WhatsApp connectivity, not just file existence
   * @returns {Promise<{healthy: boolean, reason?: string}>}
   */
  async checkHealth (): Promise<{ healthy: boolean; reason?: string }> {
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
        if (typeof this.client!.getContact === 'function') {
          await this.client!.getContact(this.jid);
        } else if (typeof this.client!.getChats === 'function') {
          await this.client!.getChats();
        }
        // If neither method is available, we still consider it healthy
        // since the client reports connected
        return { healthy: true };
      } catch {
        return { healthy: false, reason: 'contact_check_failed' };
      }
    } catch {
      return { healthy: false, reason: 'health_check_error' };
    }
  }

  async generateQrImage (data: string): Promise<string> {
    const buf = await QRCode.toBuffer(data, {
      width: 150,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
    return buf.toString('base64');
  }

  async saveQrCodeToFile (base64Data: string): Promise<string> {
    const filePath = `${this.storePath}/qr-code.png`;
    await writeFile(filePath, Buffer.from(base64Data, 'base64'));
    console.error('[WA] QR code saved to', filePath);
    return filePath;
  }

  async cleanupQrCodeFile (): Promise<void> {
    const filePath = `${this.storePath}/qr-code.png`;
    try {
      await unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async requestPairingCode (phoneNumber: string, force = false): Promise<PairingCodeResult> {
    // When not forcing, treat a missing probe verification as "not truly connected"
    // so that a broken session can be recovered without requiring a container restart.
    if (this.isConnected() && !force) {
      return { alreadyConnected: true, jid: this.jid! };
    }

    // Force mode: if probe hasn't been verified, reset the connection state
    // to allow re-pairing even when isConnected() superficially returns true.
    if (force && this._connected && !this._probeVerified) {
      console.error('[WA] Force re-pairing: resetting broken connection state');
      this._connected = false;
      this._pendingPairResolve = null;
    }

    if (this.isConnected()) {
      return { alreadyConnected: true, jid: this.jid! };
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
    }

    // Wait for the connection to stabilize and for AUTH_READY_DELAY_MS to ensure
    // the Go bridge is ready to accept pairing requests. This improves pairing
    // code success rate by giving the WebSocket time to fully initialize.
    const authReadyDelayMs = parseInt(process.env.AUTH_READY_DELAY_MS || '8000', 10);
    const stabilizedDelay = Math.max(5000, authReadyDelayMs);
    console.error(`[WA] Waiting ${stabilizedDelay}ms for authentication readiness (Go bridge stabilization)...`);
    await new Promise((r) => setTimeout(r, stabilizedDelay));

    // If a session exists on disk, the connected event may fire shortly after connect().
    // Wait briefly to catch session restores before attempting a new pairing.
    if (this._sessionExists) {
      const ready = await this.waitForReady(5000);
      if (ready.connected) {
        this._authInProgress = false;
        return { alreadyConnected: true, jid: ready.jid! };
      }
    }

    const digits = phoneNumber.replace(/[^0-9]/g, '');
    console.error(`[WA] Requesting pairing code for ${digits}`);

    // Retry logic for pairing code: max 2 attempts with 3s delays between retries
    const maxPairingAttempts = 2;
    const pairingRetryDelayMs = 3000;
    let lastPairingError: Error | undefined;

    for (let attempt = 1; attempt <= maxPairingAttempts; attempt++) {
      try {
        const code = await this.client!.pairCode(digits);

        let pairingTimeoutId: ReturnType<typeof setTimeout>;
        const waitForConnection = new Promise<WaitReadyResult>((resolve) => {
          let settled = false;
          const onConnected = () => finish({ connected: true });
          const finish = (result: WaitReadyResult) => {
            if (settled) {return;}
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
            finish({ connected: false, jid: undefined });
          }, 120_000);
        });

        return { alreadyConnected: false, code, waitForConnection };
      } catch (pairErr) {
        lastPairingError = pairErr as Error;
        console.error(`[WA] Pairing code attempt ${attempt}/${maxPairingAttempts} failed: ${(pairErr as Error).message}`);
        
        if (attempt < maxPairingAttempts) {
          console.error(`[WA] Retrying pairing code in ${pairingRetryDelayMs}ms...`);
          await new Promise((r) => setTimeout(r, pairingRetryDelayMs));
        } else {
          console.error(`[WA] All pairing attempts failed, switching to QR code mode`);
        }
      }
    }

    // All retry attempts exhausted, fall through to QR mode
    const pairErr = lastPairingError!;
    console.error(`[WA] Pairing code failed (${(pairErr as Error).message}), switching to QR code mode`);

    // Switch to QR mode: close current unauthenticated connection, set up QR channel,
    // then reconnect. getQRChannel() must be called before connect() for QR events to flow.
    try {
      await this.client!.disconnect();
      await this.client!.getQRChannel();
      await this._connectWithRetry();
      console.error('[WA] Switched to QR code mode — waiting for QR code...');
    } catch (switchErr) {
      console.error('[WA] Failed to switch to QR mode:', (switchErr as Error).message);
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

  async sendMessage (jid: string, text: string): Promise<{ id: string | undefined; timestamp: number }> {
    if (!this.isConnected()) {
      throw new Error('WhatsApp not connected. Use the authenticate tool first.');
    }

    return this._withRetry(async () => {
      const result = await this.client!.sendMessage(jid, { conversation: text });
      const id = result?.id || result?.key?.id;
      const timestamp = result?.timestamp || Math.floor(Date.now() / 1000);
      this._trackSentId(id);

      // Persist immediately — don't rely on the echo event.
      // Echoes may not arrive for self-chat, single-participant groups, or
      // messages that are filtered out of _handleIncomingMessage by _sentMessageIds.
      if (id) {
        this.messageStore.addMessage({
          id,
          chatJid: jid,
          senderJid: this.jid,
          senderName: null,
          body: text,
          timestamp,
          isFromMe: true,
          hasMedia: false,
          mediaType: null
        });
        this.messageStore.upsertChat(
          jid,
          null,
          isGroupJid(jid),
          timestamp,
          text?.substring(0, 100)
        );

        // Store contact mapping if sending to a phone JID (best-effort, non-blocking)
        if (!isGroupJid(jid) && isPhoneJid(jid)) {
          const phoneNumber = extractPhoneNumber(jid);
          if (phoneNumber) {
            // Try to resolve LID asynchronously
            this._resolveLidFromPhoneJid(jid, '').catch((err) => {
              this.logger.error(`[WA] LID resolution failed on send:`, (err as Error).message);
            });
          }
        }
      }

      return { id, timestamp };
    }, 'sendMessage');
  }

  async getChats (): Promise<unknown[]> {
    if (!this.isConnected()) {
      throw new Error('WhatsApp not connected.');
    }
    try {
      if (typeof this.client!.getChats === 'function') {
        return await this.client!.getChats();
      }
      return [];
    } catch {
      return [];
    }
  }

  async resolveGroupName (jid: string): Promise<string | null> {
    if (!this.isConnected() || typeof jid !== 'string' || !jid.endsWith('@g.us')) {return null;}
    try {
      const info = await this.client!.getGroupInfo(jid);
      return info?.subject || info?.name || null;
    } catch {
      return null;
    }
  }

  async resolveContactName (jid: string): Promise<string | null> {
    if (!this.isConnected()) {return null;}
    try {
      if (typeof this.client!.getContact !== 'function') {return null;}
      const contact = await this.client!.getContact(jid);
      return contact?.fullName || contact?.pushName || null;
    } catch {
      return null;
    }
  }

  _extractMediaInfo (message: NonNullable<WaMessageEvent['message']>): MediaInfo | null {
    if (!message) {return null;}

    // Check nested message wrappers (ephemeralMessage, viewOnceMessage)
    const nestedMessage = message.ephemeralMessage?.message
      || message.viewOnceMessage?.message
      || message.viewOnceMessageV2?.message
      || message.viewOnceMessageV2Extension?.message
      || null;

    // Type assertion: nestedMessage has the same structure as message.message
    const msg = (nestedMessage || message) as typeof message;

    if (msg.imageMessage) {
      return { type: 'image', mimetype: msg.imageMessage.mimetype, filename: null };
    }
    if (msg.videoMessage) {
      return { type: 'video', mimetype: msg.videoMessage.mimetype, filename: null };
    }
    if (msg.audioMessage) {
      return { type: 'audio', mimetype: msg.audioMessage.mimetype, filename: null };
    }
    if (msg.documentMessage) {
      return {
        type: 'document',
        mimetype: msg.documentMessage.mimetype,
        filename: msg.documentMessage.fileName || msg.documentMessage.title || null
      };
    }
    if (msg.stickerMessage) {
      return { type: 'sticker', mimetype: msg.stickerMessage.mimetype, filename: null };
    }
    if (msg.contactMessage) {
      return { type: 'contact', mimetype: undefined, filename: null };
    }
    if (msg.locationMessage) {
      return { type: 'location', mimetype: undefined, filename: null };
    }
    if (msg.pollCreationMessage) {
      return { type: 'poll', mimetype: undefined, filename: null };
    }
    if (msg.pollCreationMessageV2) {
      return { type: 'poll', mimetype: undefined, filename: null };
    }
    if (msg.pollCreationMessageV3) {
      return { type: 'poll', mimetype: undefined, filename: null };
    }
    if (msg.reactionMessage) {
      return { type: 'reaction', mimetype: undefined, filename: null };
    }
    if (msg.listMessage) {
      return { type: 'list', mimetype: undefined, filename: null };
    }
    if (msg.listResponseMessage) {
      return { type: 'list_response', mimetype: undefined, filename: null };
    }
    return null;
  }

  async downloadMedia (messageId: string): Promise<{ path: string; mediaType: string | null; chatJid: string }> {
    if (!this.isConnected()) {
      throw new Error('WhatsApp not connected.');
    }

    const dbMsg = this.messageStore.db!
      .prepare('SELECT media_raw_json, media_type, chat_jid FROM messages WHERE id = ?')
      .get(messageId) as MediaDbRow | undefined;

    if (!dbMsg?.media_raw_json) {
      throw new Error(
        'No media metadata stored for this message. Media may have been received before metadata tracking was enabled.'
      );
    }

    const rawMessage = JSON.parse(decrypt(dbMsg.media_raw_json));

    const tempPath = await this._withRetry(
      () => this.client!.downloadAny(rawMessage),
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
      throw new Error(extCheck.warning ?? 'File extension not allowed');
    }

    await copyFile(tempPath, dest);

    this.messageStore.updateMediaInfo(messageId, { localPath: dest });

    return { path: dest, mediaType: dbMsg.media_type, chatJid: dbMsg.chat_jid };
  }

  async uploadAndSendMedia (jid: string, filePath: string, mediaType: string, caption: string): Promise<{
    id: string | undefined;
    timestamp: number;
    mediaType: string;
  }> {
    if (!this.isConnected()) {
      throw new Error('WhatsApp not connected. Use the authenticate tool first.');
    }

    const uploadResult = await this._withRetry(
      () => this.client!.uploadMedia(filePath, mediaType),
      'uploadMedia',
      3
    );

    const filename = path.basename(filePath);
    const mimeMap: Record<string, string> = {
      image: 'image/jpeg',
      video: 'video/mp4',
      audio: 'audio/ogg',
      document: 'application/octet-stream'
    };
    const mimetype = mimeMap[mediaType] || 'application/octet-stream';

    let message: object;
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
      () => this.client!.sendRawMessage(jid, message),
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

  _defaultExt (mediaType: string | null): string {
    const map: Record<string, string> = { image: '.jpg', video: '.mp4', audio: '.ogg', document: '.bin', sticker: '.webp' };
    return map[mediaType ?? ''] || '.bin';
  }

  // ── Group Management ─────────────────────────────────────────────────────────

  async createGroup (name: string, participantJids: string[]): Promise<{ jid: string }> {
    return this._withRetry(() => this.client!.createGroup(name, participantJids), 'createGroup');
  }

  async getGroupInfo (jid: string): Promise<{ subject?: string; name?: string } | null> {
    return this._withRetry(() => this.client!.getGroupInfo(jid), 'getGroupInfo');
  }

  async getJoinedGroups (): Promise<unknown[]> {
    return this._withRetry(() => this.client!.getJoinedGroups(), 'getJoinedGroups');
  }

  async getGroupInviteLink (jid: string): Promise<string> {
    const link = await this._withRetry(() => this.client!.getGroupInviteLink(jid), 'getGroupInviteLink');
    return link;
  }

  async joinGroupWithLink (code: string): Promise<unknown> {
    return this._withRetry(() => this.client!.joinGroupWithLink(code), 'joinGroupWithLink');
  }

  async leaveGroup (jid: string): Promise<void> {
    return this._withRetry(() => this.client!.leaveGroup(jid), 'leaveGroup');
  }

  async updateGroupParticipants (jid: string, participantJids: string[], action: string): Promise<unknown> {
    return this._withRetry(
      () => this.client!.updateGroupParticipants(jid, participantJids, action),
      'updateGroupParticipants'
    );
  }

  async setGroupName (jid: string, name: string): Promise<void> {
    return this._withRetry(() => this.client!.setGroupName(jid, name), 'setGroupName');
  }

  async setGroupTopic (jid: string, topic: string): Promise<void> {
    return this._withRetry(() => this.client!.setGroupTopic(jid, topic), 'setGroupTopic');
  }

  // ── Message Actions ──────────────────────────────────────────────────────────

  async sendReaction (jid: string, messageId: string, emoji: string): Promise<unknown> {
    return this._withRetry(
      () => this.client!.sendReaction(jid, messageId, emoji),
      'sendReaction'
    );
  }

  async editMessage (jid: string, messageId: string, newText: string): Promise<unknown> {
    return this._withRetry(
      () => this.client!.editMessage(jid, messageId, { conversation: newText }),
      'editMessage'
    );
  }

  async revokeMessage (jid: string, messageId: string): Promise<unknown> {
    return this._withRetry(() => this.client!.revokeMessage(jid, messageId), 'revokeMessage');
  }

  async createPoll (jid: string, question: string, options: string[], allowMultiple: boolean): Promise<{ id: string | undefined }> {
    const result = await this._withRetry(
      () => this.client!.sendPollCreation(jid, question, options, allowMultiple ? options.length : 1),
      'createPoll'
    );
    const id = result?.id || result?.key?.id;
    this._trackSentId(id);
    return { id };
  }

  // ── Contact Info ─────────────────────────────────────────────────────────────

  async getUserInfo (jids: string[]): Promise<unknown> {
    return this._withRetry(() => this.client!.getUserInfo(jids), 'getUserInfo');
  }

  async isOnWhatsApp (phones: string[]): Promise<unknown> {
    return this._withRetry(() => this.client!.isOnWhatsApp(phones), 'isOnWhatsApp');
  }

  async getProfilePicture (jid: string): Promise<unknown> {
    return this._withRetry(() => this.client!.getProfilePicture(jid), 'getProfilePicture');
  }

  /**
   * Explicit logout: disconnects from WhatsApp AND deletes the local session file.
   * Called by the 'disconnect' MCP tool. Requires full re-authentication afterwards.
   */
  async logout (): Promise<void> {
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
      try { resolve(''); } catch { /* ignore */ }
    }
    for (const w of this._messageWaiters.splice(0)) {
      try { w.resolve(null); } catch { /* ignore */ }
    }

    if (this.client) {
      try {
        await this.client.sendPresence('unavailable');
      } catch (error) {
        this.logger.error('[WA] Error sending presence during logout:', (error as Error).message);
      }
      try {
        await this.client.disconnect();
      } catch (error) {
        this.logger.error('[WA] Error during logout disconnect:', (error as Error).message);
      }
      try {
        await this.client.close();
      } catch (error) {
        this.logger.error('[WA] Error closing client during logout:', (error as Error).message);
      }
    }
    this._connected = false;
    this._authInProgress = false;
    this._connectCalled = false;
    this._probeVerified = false;
    this._probeLastError = null;
    // Delete session file — _cleanupSession also clears jid and _sessionExists
    await this._cleanupSession();
  }

  /**
   * Graceful shutdown disconnect: closes the WebSocket and terminates the Go
   * subprocess. Session file is preserved on disk so the session can be resumed
   * on next container start.
   * Called on SIGINT/SIGTERM and in test teardown.
   */
  async disconnect (): Promise<void> {
    this._stopHealthCheck();
    if (this.client) {
      try {
        await this.client.sendPresence('unavailable');
      } catch (error) {
        this.logger.error('[WA] Error sending presence during disconnect:', (error as Error).message);
      }
      try {
        await this.client.disconnect();
      } catch (error) {
        this.logger.error('[WA] Error during disconnect:', (error as Error).message);
      }
      try {
        await this.client.close();
      } catch (error) {
        this.logger.error('[WA] Error closing client subprocess:', (error as Error).message);
      }
      this._connected = false;
    }
  }
}
