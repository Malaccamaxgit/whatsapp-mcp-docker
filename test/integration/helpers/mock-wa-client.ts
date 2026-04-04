/**
 * Mock WhatsApp Client
 *
 * Implements the same public API as WhatsAppClient but returns
 * canned responses. No WhatsApp connection needed.
 *
 * Supports:
 * - Connection state transitions
 * - Error simulation with proper Error objects
 * - Configurable method behaviors via overrides
 * - State tracking for assertions
 */

// Type definitions for mock client
interface MockBehavior {
  sendMessage?: (jid: string, message: unknown) => Promise<unknown>;
  getChats?: () => Promise<unknown>;
  getContact?: (jid: string) => Promise<unknown>;
  getGroupInfo?: (jid: string) => Promise<unknown>;
  resolveContactName?: (jid: string) => Promise<string | null>;
  resolveGroupName?: (jid: string) => Promise<string | null>;
  downloadMedia?: (messageId: string) => Promise<unknown>;
  downloadAny?: (rawMessage: unknown) => Promise<string>;
  uploadMedia?: (filePath: string) => Promise<unknown>;
  uploadAndSendMedia?: (jid: string, filePath: string, mediaType: string, caption?: string) => Promise<unknown>;
  markRead?: (params: { chatJid: string; messageIds?: string[]; senderJid?: string }) => Promise<unknown>;
  pairCode?: (digits: string) => Promise<string>;
  createGroup?: (name: string, participants?: string[]) => Promise<unknown>;
  getJoinedGroups?: () => Promise<unknown>;
  getGroupInviteLink?: (jid: string) => Promise<string>;
  joinGroupWithLink?: (code: string) => Promise<unknown>;
  leaveGroup?: (jid: string) => Promise<unknown>;
  updateGroupParticipants?: (jid: string, participantJids: string[], action: string) => Promise<unknown>;
  setGroupName?: (jid: string, name: string) => Promise<unknown>;
  setGroupTopic?: (jid: string, topic: string) => Promise<unknown>;
  sendReaction?: (jid: string, messageId: string, emoji: string) => Promise<unknown>;
  editMessage?: (jid: string, messageId: string, content: string) => Promise<unknown>;
  revokeMessage?: (jid: string, messageId: string) => Promise<unknown>;
  createPoll?: (jid: string, question: string, options: string[], allowMultiple: boolean) => Promise<unknown>;
  getUserInfo?: (jids: string[]) => Promise<unknown>;
  isOnWhatsApp?: (phones: string[]) => Promise<unknown>;
  getProfilePicture?: (jid: string) => Promise<string | null>;
}

interface ErrorSimulation {
  sendMessage?: { error: Error | string; callCount: number } | null;
  uploadMedia?: { error: Error | string; callCount: number } | null;
  downloadMedia?: { error: Error | string; callCount: number } | null;
}

interface SentMessage {
  jid: string;
  text: string;
}

interface SentMedia {
  jid: string;
  filePath: string;
  mediaType: string;
  caption?: string;
}

interface ReadReceipt {
  chatJid: string;
  messageIds?: string[];
  senderJid?: string;
}

interface MessageWaiter {
  filter?: (msg: unknown) => boolean;
  resolve: (msg: unknown) => void;
}

interface GroupInfo {
  jid: string;
  name: string;
  participants?: string[];
}

interface CreateGroupCall {
  name: string;
  participants: string[];
  jid: string;
}

interface HealthStats {
  uptime: number;
  recentErrorCount: number;
  reconnecting: boolean;
  logoutReason: string | null;
}

interface PairingCodeResult {
  alreadyConnected: boolean;
  code?: string;
  jid?: string;
  waitForConnection?: Promise<void>;
}

interface ReconnectResult {
  connected: boolean;
  jid?: string;
}

interface MockWaClient {
  // Internal state
  _connected: boolean;
  jid: string | null;
  storePath: string;
  messageStore: unknown;
  _logoutReason: string | null;
  _reconnecting: boolean;
  _connectedAt: number;
  _recentErrors: unknown[];
  _sendReadReceipts: boolean;
  _messageWaiters: MessageWaiter[];
  _onMessage?: (msg: unknown) => void;

  // Connection state
  isConnected(): boolean;
  setConnected(connected: boolean): void;

  // Health monitoring
  getHealthStats(): HealthStats;

  // Authentication
  requestPairingCode(phone: string): Promise<PairingCodeResult>;
  pairCode(digits: string): Promise<string>;

  // Messaging
  sendMessage(jid: string, message: unknown): Promise<{ id: string; timestamp: number; key: { id: string } }>;
  markMessagesRead(params: { chatJid: string; messageIds?: string[]; senderJid?: string }): Promise<number>;

  // Media
  setDownloadResult(messageId: string, result: unknown): void;
  setUploadResult(filePath: string, result: unknown): void;
  uploadAndSendMedia(jid: string, filePath: string, mediaType: string, caption?: string): Promise<{ id: string; timestamp: number; mediaType: string }>;
  uploadMedia(filePath: string): Promise<{ url: string; mimetype: string; fileLength: number } | unknown>;
  downloadMedia(messageId: string): Promise<{ path: string; mediaType: string; chatJid: string } | unknown>;
  downloadAny(rawMessage: unknown): Promise<string>;

  // Contact/Group resolution
  resolveGroupName(jid: string): Promise<string | null>;
  resolveContactName(jid: string): Promise<string | null>;

  // Chat listing
  getChats(): Promise<unknown[]>;

  // Contact info
  getContact(jid: string): Promise<{ fullName: string; pushName: string } | unknown>;

  // Group info
  getGroupInfo(jid: string): Promise<{ subject: string } | unknown>;

  // Session existence
  hasSession: boolean;

  // Connection management
  logout(): Promise<void>;
  reconnect(): Promise<ReconnectResult>;
  disconnect(): Promise<void>;

  // Test helpers
  simulateLogout(reason?: string): void;
  simulateIncomingMessage(msg: unknown): void;
  addMessageWaiter(filter: ((msg: unknown) => boolean) | undefined, resolve: (msg: unknown) => void): void;
  on(event: string, handler: (arg: unknown) => void): void;

  // Behavior management
  setBehavior(method: string, implementation: (...args: unknown[]) => unknown): void;
  resetBehaviors(): void;

  // State inspection
  getSentMessages(): SentMessage[];
  getSentMedia(): SentMedia[];
  getReadReceipts(): ReadReceipt[];

  // Group creation
  createGroup(name: string, participants?: string[]): Promise<{ jid: string; name: string }>;
  getCreateGroupCalls(): CreateGroupCall[];
  resetCreateGroupCalls(): void;
  setCreateGroupResult(result: unknown): void;
  setCreateGroupError(error: Error): void;
  clearSentMessages(): void;

  // Group management
  getJoinedGroups(): Promise<GroupInfo[]>;
  getGroupInviteLink(jid: string): Promise<string>;
  joinGroupWithLink(code: string): Promise<{ jid: string }>;
  leaveGroup(jid: string): Promise<null>;
  updateGroupParticipants(jid: string, participantJids: string[], action: string): Promise<{ jid: string; error: null }[]>;
  setGroupName(jid: string, name: string): Promise<null>;
  setGroupTopic(jid: string, topic: string): Promise<null>;

  // Message actions
  sendReaction(jid: string, messageId: string, emoji: string): Promise<{ id: string }>;
  editMessage(jid: string, messageId: string, content: string): Promise<{ id: string }>;
  revokeMessage(jid: string, messageId: string): Promise<null>;
  createPoll(jid: string, question: string, options: string[], allowMultiple: boolean): Promise<{ id: string }>;

  // Contact info
  getUserInfo(jids: string[]): Promise<Record<string, { name: string; status: string }>>;
  isOnWhatsApp(phones: string[]): Promise<{ jid: string; phone: string; exists: boolean }[]>;
  getProfilePicture(jid: string): Promise<string>;

  // Error simulation
  simulateError(method: string, error: Error | string, callCount?: number): void;
}

interface MockWaClientOverrides {
  [key: string]: unknown;
}

export function createMockWaClient(overrides: MockWaClientOverrides = {}): MockWaClient {
  const sentMessages: SentMessage[] = [];
  const sentMedia: SentMedia[] = [];
  const readReceipts: ReadReceipt[] = [];
  const downloadResults = new Map<string, unknown>();
  const uploadResults = new Map<string, unknown>();
  const createGroupCalls: CreateGroupCall[] = [];
  let createGroupResult: unknown = null;
  let createGroupError: Error | null = null;
  let messageWaiters: MessageWaiter[] = [];  // mirrors real client _messageWaiters

  // Configurable behaviors
  const behaviors: MockBehavior = {
    sendMessage: null,
    getChats: null,
    getContact: null,
    getGroupInfo: null,
    resolveContactName: null,
    resolveGroupName: null,
    downloadMedia: null,
    downloadAny: null,
    uploadMedia: null,
    uploadAndSendMedia: null,
    markRead: null,
    pairCode: null,
    createGroup: null,
    // Group management
    getJoinedGroups: null,
    getGroupInviteLink: null,
    joinGroupWithLink: null,
    leaveGroup: null,
    updateGroupParticipants: null,
    setGroupName: null,
    setGroupTopic: null,
    // Message actions
    sendReaction: null,
    editMessage: null,
    revokeMessage: null,
    createPoll: null,
    // Contact info
    getUserInfo: null,
    isOnWhatsApp: null,
    getProfilePicture: null
  };

  // Configurable error simulation
  let _errorSimulation: ErrorSimulation = {
    sendMessage: null,
    uploadMedia: null,
    downloadMedia: null
  };

  let _connected = true;
  let _jid: string | null = '15145559999@s.whatsapp.net';

  const client = {
    // Internal state (matches real client)
    _connected: true,
    jid: '15145559999@s.whatsapp.net',
    storePath: '/data/store',
    messageStore: null,  // Will be set by test setup
    _logoutReason: null,
    _reconnecting: false,
    _connectedAt: Date.now(),
    _recentErrors: [],
    _sendReadReceipts: true,
    _messageWaiters: messageWaiters,

    // Connection state management
    isConnected() {
      return this._connected && this.jid !== null;
    },

    setConnected(connected: boolean) {
      this._connected = connected;
      if (!connected) {
        this.jid = null;
      }
    },

    // Health monitoring
    getHealthStats(): HealthStats {
      return {
        uptime: this._connectedAt && this._connected ? Math.floor((Date.now() - this._connectedAt) / 1000) : 0,
        recentErrorCount: this._recentErrors.length,
        reconnecting: this._reconnecting,
        logoutReason: this._logoutReason
      };
    },

    // Authentication
    async requestPairingCode(phone: string): Promise<PairingCodeResult> {
      if (this._connected && this.jid) {
        return { alreadyConnected: true, jid: this.jid };
      }
      return {
        alreadyConnected: false,
        code: '1234-5678',
        waitForConnection: Promise.resolve()
      };
    },

    // Pair code method (called by requestPairingCode)
    async pairCode(digits: string): Promise<string> {
      if (behaviors.pairCode) {
        return behaviors.pairCode(digits);
      }
      // Return a mock pairing code (8 digits, formatted as XXXX-XXXX)
      return '12345678';
    },

    // Messaging - supports custom behavior for retry testing
    async sendMessage(jid: string, message: unknown): Promise<{ id: string; timestamp: number; key: { id: string } }> {
      if (behaviors.sendMessage) {
        return behaviors.sendMessage(jid, message) as Promise<{ id: string; timestamp: number; key: { id: string } }>;
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      // Handle both object format { conversation: text } and direct text
      const text = typeof message === 'object' && message !== null && 'conversation' in message
        ? (message as { conversation: string }).conversation
        : message as string;
      sentMessages.push({ jid, text });
      return {
        id: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Math.floor(Date.now() / 1000),
        key: { id: `mock_${Date.now()}` }
      };
    },

    // Read receipts
    async markMessagesRead(params: { chatJid: string; messageIds?: string[]; senderJid?: string }): Promise<number> {
      const { chatJid, messageIds, senderJid } = params;
      if (behaviors.markRead) {
        return behaviors.markRead({ chatJid, messageIds, senderJid }) as Promise<number>;
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      if (messageIds?.length) {
        readReceipts.push({ chatJid, messageIds, senderJid });
      }
      return messageIds?.length || 0;
    },

    setDownloadResult(messageId: string, result: unknown) {
      downloadResults.set(messageId, result);
    },

    // Set upload result for specific file path
    setUploadResult(filePath: string, result: unknown) {
      uploadResults.set(filePath, result);
    },

    // Configure error simulation for retry testing
    simulateError(method: string, error: Error | string, callCount = 1) {
      let calls = 0;
      _errorSimulation[method] = { error, callCount };

      behaviors[method] = () => {
        calls++;
        if (calls <= callCount) {
          throw typeof error === 'string' ? new Error(error) : error;
        }
        // After simulated errors, return normal behavior
        return method === 'uploadMedia' ? {} : { id: 'mock-success', timestamp: Date.now() };
      };
    },

    // Set custom behavior for any method
    setBehavior(method: string, implementation: (...args: unknown[]) => unknown) {
      behaviors[method] = implementation;
    },

    resetBehaviors() {
      Object.keys(behaviors).forEach(key => behaviors[key] = null);
      _errorSimulation = { sendMessage: null, uploadMedia: null, downloadMedia: null };
    },

    // Media upload and send - supports retry testing
    async uploadAndSendMedia(jid: string, filePath: string, mediaType: string, caption?: string): Promise<{ id: string; timestamp: number; mediaType: string }> {
      if (behaviors.uploadAndSendMedia) {
        return behaviors.uploadAndSendMedia(jid, filePath, mediaType, caption) as Promise<{ id: string; timestamp: number; mediaType: string }>;
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      sentMedia.push({ jid, filePath, mediaType, caption });
      return {
        id: `mock_media_${Date.now()}`,
        timestamp: Math.floor(Date.now() / 1000),
        mediaType
      };
    },

    // Upload media (separate method for retry testing)
    async uploadMedia(filePath: string): Promise<{ url: string; mimetype: string; fileLength: number } | unknown> {
      if (behaviors.uploadMedia) {
        return behaviors.uploadMedia(filePath);
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      // Check if custom result set
      if (uploadResults.has(filePath)) {
        return uploadResults.get(filePath);
      }
      return {
        url: 'https://mock.whatsapp.net/media/abc123',
        mimetype: 'image/jpeg',
        fileLength: 1024
      };
    },

    // Download media - supports custom results per message
    async downloadMedia(messageId: string): Promise<{ path: string; mediaType: string; chatJid: string } | unknown> {
      if (behaviors.downloadMedia) {
        return behaviors.downloadMedia(messageId);
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      if (downloadResults.has(messageId)) {
        return downloadResults.get(messageId);
      }
      // Default: return a synthetic result so tools tests pass without custom setup
      return {
        path: '/data/store/media/image/mock.jpg',
        mediaType: 'image',
        chatJid: '123@s.whatsapp.net'
      };
    },

    // Download any media (real client uses this)
    async downloadAny(rawMessage: unknown): Promise<string> {
      if (behaviors.downloadAny) {
        return behaviors.downloadAny(rawMessage);
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      // Return a temp file path
      return '/tmp/mock_media_download.tmp';
    },

    // Contact/Group resolution - supports custom behaviors
    async resolveGroupName(jid: string): Promise<string | null> {
      if (behaviors.resolveGroupName) {
        return behaviors.resolveGroupName(jid);
      }
      if (!this._connected) {
        return null;
      }
      return jid.endsWith('@g.us') ? 'Mock Group' : null;
    },

    async resolveContactName(jid: string): Promise<string | null> {
      if (behaviors.resolveContactName) {
        return behaviors.resolveContactName(jid);
      }
      if (!this._connected) {
        return null;
      }
      return 'Mock Contact';
    },

    // Chat listing - supports custom behaviors and error simulation
    async getChats(): Promise<unknown[]> {
      if (behaviors.getChats) {
        return behaviors.getChats();
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      return [];
    },

    // Contact info - supports custom behaviors
    async getContact(jid: string): Promise<{ fullName: string; pushName: string } | unknown> {
      if (behaviors.getContact) {
        return behaviors.getContact(jid);
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      return { fullName: 'Mock Contact', pushName: 'Mock' };
    },

    // Group info - supports custom behaviors
    async getGroupInfo(jid: string): Promise<{ subject: string } | unknown> {
      if (behaviors.getGroupInfo) {
        return behaviors.getGroupInfo(jid);
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      return { subject: 'Mock Group' };
    },

    // Session existence (mirrors real client hasSession getter)
    get hasSession(): boolean {
      return this._connected || this.jid !== null;
    },

    // Explicit logout: disconnects and clears session (mirrors real client logout())
    async logout(): Promise<void> {
      this._connected = false;
      this.jid = null;
    },

    // Reconnect using existing session (mirrors real client reconnect())
    async reconnect(): Promise<ReconnectResult> {
      if (this._connected && this.jid) {
        return { connected: true, jid: this.jid };
      }
      return { connected: false };
    },

    // Graceful shutdown disconnect: closes WebSocket, preserves session on disk
    async disconnect(): Promise<void> {
      this._connected = false;
      this.jid = null;
    },

    // Test helpers for simulating scenarios
    simulateLogout(reason?: string) {
      this._connected = false;
      this.jid = null;
      this._logoutReason = reason || 'unknown';
    },

    simulateIncomingMessage(msg: unknown) {
      if (this._onMessage) {
        this._onMessage(msg);
      }
      // Also notify any message waiters (mirrors real _notifyMessageWaiters)
      const remaining: MessageWaiter[] = [];
      for (const w of messageWaiters) {
        if (!w.filter || w.filter(msg)) {
          w.resolve(msg);
        } else {
          remaining.push(w);
        }
      }
      messageWaiters = remaining;
      this._messageWaiters = messageWaiters;
    },

    // Mirror real client API used by wait_for_message tool
    addMessageWaiter(filter: ((msg: unknown) => boolean) | undefined, resolve: (msg: unknown) => void) {
      messageWaiters.push({ filter, resolve });
      this._messageWaiters = messageWaiters;
    },

    on(event: string, handler: (arg: unknown) => void) {
      if (event === 'message') {
        this._onMessage = handler;
      }
    },

    // Behavior setters for test configuration
    setBehavior(method: string, implementation: (...args: unknown[]) => unknown) {
      behaviors[method] = implementation;
    },

    resetBehaviors() {
      Object.keys(behaviors).forEach(key => behaviors[key] = null);
      _errorSimulation = { sendMessage: null, uploadMedia: null, downloadMedia: null };
    },

    // Test helpers - state inspection
    getSentMessages(): SentMessage[] {
      return sentMessages;
    },
    getSentMedia(): SentMedia[] {
      return sentMedia;
    },
    getReadReceipts(): ReadReceipt[] {
      return readReceipts;
    },

    // Group creation helpers for welcome group tests
    async createGroup(name: string, participants: string[] = []): Promise<{ jid: string; name: string }> {
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      if (behaviors.createGroup) {
        return behaviors.createGroup(name, participants) as Promise<{ jid: string; name: string }>;
      }
      const jid = `120363${Date.now()}@g.us`;
      createGroupCalls.push({ name, participants, jid });
      return { jid, name };
    },

    getCreateGroupCalls(): CreateGroupCall[] {
      return createGroupCalls;
    },

    resetCreateGroupCalls() {
      createGroupCalls.length = 0;
    },

    setCreateGroupResult(result: unknown) {
      behaviors.createGroup = () => result;
    },

    setCreateGroupError(error: Error) {
      behaviors.createGroup = () => { throw error; };
    },

    clearSentMessages() {
      sentMessages.length = 0;
    },

    // ── Group Management ────────────────────────────────────────────────────────

    async getJoinedGroups(): Promise<GroupInfo[]> {
      if (behaviors.getJoinedGroups) return behaviors.getJoinedGroups() as Promise<GroupInfo[]>;
      if (!this._connected) throw new Error('WhatsApp not connected');
      return [
        { jid: '120363001234@g.us', name: 'Engineering Team', participants: [] },
        { jid: '120363005678@g.us', name: 'WhatsAppMCP',       participants: [] }
      ];
    },

    async getGroupInviteLink(jid: string): Promise<string> {
      if (behaviors.getGroupInviteLink) return behaviors.getGroupInviteLink(jid);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return 'ABC123INVITELINK';
    },

    async joinGroupWithLink(code: string): Promise<{ jid: string }> {
      if (behaviors.joinGroupWithLink) return behaviors.joinGroupWithLink(code);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return { jid: '120363099999@g.us' };
    },

    async leaveGroup(jid: string): Promise<null> {
      if (behaviors.leaveGroup) return behaviors.leaveGroup(jid);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return null;
    },

    async updateGroupParticipants(jid: string, participantJids: string[], action: string): Promise<{ jid: string; error: null }[]> {
      if (behaviors.updateGroupParticipants) {
        return behaviors.updateGroupParticipants(jid, participantJids, action) as Promise<{ jid: string; error: null }[]>;
      }
      if (!this._connected) throw new Error('WhatsApp not connected');
      return participantJids.map((p) => ({ jid: p, error: null }));
    },

    async setGroupName(jid: string, name: string): Promise<null> {
      if (behaviors.setGroupName) return behaviors.setGroupName(jid, name);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return null;
    },

    async setGroupTopic(jid: string, topic: string): Promise<null> {
      if (behaviors.setGroupTopic) return behaviors.setGroupTopic(jid, topic);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return null;
    },

    // ── Message Actions ──────────────────────────────────────────────────────────

    async sendReaction(jid: string, messageId: string, emoji: string): Promise<{ id: string }> {
      if (behaviors.sendReaction) return behaviors.sendReaction(jid, messageId, emoji);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return { id: `reaction_${Date.now()}` };
    },

    async editMessage(jid: string, messageId: string, content: string): Promise<{ id: string }> {
      if (behaviors.editMessage) return behaviors.editMessage(jid, messageId, content);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return { id: messageId };
    },

    async revokeMessage(jid: string, messageId: string): Promise<null> {
      if (behaviors.revokeMessage) return behaviors.revokeMessage(jid, messageId);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return null;
    },

    async createPoll(jid: string, question: string, options: string[], allowMultiple: boolean): Promise<{ id: string }> {
      if (behaviors.createPoll) return behaviors.createPoll(jid, question, options, allowMultiple);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return { id: `poll_${Date.now()}` };
    },

    // ── Contact Info ─────────────────────────────────────────────────────────────

    async getUserInfo(jids: string[]): Promise<Record<string, { name: string; status: string }>> {
      if (behaviors.getUserInfo) return behaviors.getUserInfo(jids) as Promise<Record<string, { name: string; status: string }>>;
      if (!this._connected) throw new Error('WhatsApp not connected');
      return Object.fromEntries(jids.map((j) => [j, { name: 'Mock User', status: 'Hey there!' }]));
    },

    async isOnWhatsApp(phones: string[]): Promise<{ jid: string; phone: string; exists: boolean }[]> {
      if (behaviors.isOnWhatsApp) return behaviors.isOnWhatsApp(phones);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return phones.map((p) => ({ jid: `${p.replace(/\D/g, '')}@s.whatsapp.net`, phone: p, exists: true }));
    },

    async getProfilePicture(jid: string): Promise<string> {
      if (behaviors.getProfilePicture) return behaviors.getProfilePicture(jid);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return 'https://mock.whatsapp.net/profile/abc123.jpg';
    },

    // Allow test overrides
    ...overrides
  } as MockWaClient;

  // Sync internal state
  Object.defineProperty(client, '_connected', {
    get: () => _connected,
    set: (val: boolean) => { _connected = val; }
  });

  Object.defineProperty(client, 'jid', {
    get: () => _jid,
    set: (val: string | null) => { _jid = val; }
  });

  return client;
}
