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

export function createMockWaClient(overrides = {}) {
  const sentMessages = [];
  const sentMedia = [];
  const readReceipts = [];
  const downloadResults = new Map();
  const uploadResults = new Map();
  const createGroupCalls = [];
  let createGroupResult = null;
  let createGroupError = null;
  let messageWaiters = [];  // mirrors real client _messageWaiters
  
  // Configurable behaviors
  const behaviors = {
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
  let _errorSimulation = {
    sendMessage: null,
    uploadMedia: null,
    downloadMedia: null
  };

  let _connected = true;
  let _jid = '15145559999@s.whatsapp.net';

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

    setConnected(connected) {
      this._connected = connected;
      if (!connected) {
        this.jid = null;
      }
    },

    // Health monitoring
    getHealthStats() {
      return {
        uptime: this._connectedAt && this._connected ? Math.floor((Date.now() - this._connectedAt) / 1000) : 0,
        recentErrorCount: this._recentErrors.length,
        reconnecting: this._reconnecting,
        logoutReason: this._logoutReason
      };
    },

    // Authentication
    async requestPairingCode(phone) {
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
    async pairCode(digits) {
      if (behaviors.pairCode) {
        return behaviors.pairCode(digits);
      }
      // Return a mock pairing code (8 digits, formatted as XXXX-XXXX)
      return '12345678';
    },

    // Messaging - supports custom behavior for retry testing
    async sendMessage(jid, message) {
      if (behaviors.sendMessage) {
        return behaviors.sendMessage(jid, message);
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      // Handle both object format { conversation: text } and direct text
      const text = typeof message === 'object' ? message.conversation : message;
      sentMessages.push({ jid, text });
      return {
        id: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Math.floor(Date.now() / 1000),
        key: { id: `mock_${Date.now()}` }
      };
    },

    // Read receipts
    async markMessagesRead({ chatJid, messageIds, senderJid }) {
      if (behaviors.markRead) {
        return behaviors.markRead({ chatJid, messageIds, senderJid });
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      if (messageIds?.length) {
        readReceipts.push({ chatJid, messageIds, senderJid });
      }
      return messageIds?.length || 0;
    },

    setDownloadResult(messageId, result) {
      downloadResults.set(messageId, result);
    },

    // Set upload result for specific file path
    setUploadResult(filePath, result) {
      uploadResults.set(filePath, result);
    },

    // Configure error simulation for retry testing
    simulateError(method, error, callCount = 1) {
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
    setBehavior(method, implementation) {
      behaviors[method] = implementation;
    },

    resetBehaviors() {
      Object.keys(behaviors).forEach(key => behaviors[key] = null);
      _errorSimulation = { sendMessage: null, uploadMedia: null, downloadMedia: null };
    },

    // Media upload and send - supports retry testing
    async uploadAndSendMedia(jid, filePath, mediaType, caption) {
      if (behaviors.uploadAndSendMedia) {
        return behaviors.uploadAndSendMedia(jid, filePath, mediaType, caption);
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
    async uploadMedia(filePath) {
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
    async downloadMedia(messageId) {
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
    async downloadAny(rawMessage) {
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
    async resolveGroupName(jid) {
      if (behaviors.resolveGroupName) {
        return behaviors.resolveGroupName(jid);
      }
      if (!this._connected) {
        return null;
      }
      return jid.endsWith('@g.us') ? 'Mock Group' : null;
    },

    async resolveContactName(jid) {
      if (behaviors.resolveContactName) {
        return behaviors.resolveContactName(jid);
      }
      if (!this._connected) {
        return null;
      }
      return 'Mock Contact';
    },

    // Chat listing - supports custom behaviors and error simulation
    async getChats() {
      if (behaviors.getChats) {
        return behaviors.getChats();
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      return [];
    },

    // Contact info - supports custom behaviors
    async getContact(jid) {
      if (behaviors.getContact) {
        return behaviors.getContact(jid);
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      return { fullName: 'Mock Contact', pushName: 'Mock' };
    },

    // Group info - supports custom behaviors
    async getGroupInfo(jid) {
      if (behaviors.getGroupInfo) {
        return behaviors.getGroupInfo(jid);
      }
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      return { subject: 'Mock Group' };
    },

    // Session existence (mirrors real client hasSession getter)
    get hasSession() {
      return this._connected || this.jid !== null;
    },

    // Explicit logout: disconnects and clears session (mirrors real client logout())
    async logout() {
      this._connected = false;
      this.jid = null;
    },

    // Reconnect using existing session (mirrors real client reconnect())
    async reconnect() {
      if (this._connected && this.jid) {
        return { connected: true, jid: this.jid };
      }
      return { connected: false };
    },

    // Graceful shutdown disconnect: closes WebSocket, preserves session on disk
    async disconnect() {
      this._connected = false;
      this.jid = null;
    },

    // Test helpers for simulating scenarios
    simulateLogout(reason) {
      this._connected = false;
      this.jid = null;
      this._logoutReason = reason || 'unknown';
    },

    simulateIncomingMessage(msg) {
      if (this._onMessage) {
        this._onMessage(msg);
      }
      // Also notify any message waiters (mirrors real _notifyMessageWaiters)
      const remaining = [];
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
    addMessageWaiter(filter, resolve) {
      messageWaiters.push({ filter, resolve });
      this._messageWaiters = messageWaiters;
    },

    on(event, handler) {
      if (event === 'message') {
        this._onMessage = handler;
      }
    },

    // Behavior setters for test configuration
    setBehavior(method, implementation) {
      behaviors[method] = implementation;
    },

    resetBehaviors() {
      Object.keys(behaviors).forEach(key => behaviors[key] = null);
      _errorSimulation = { sendMessage: null, uploadMedia: null, downloadMedia: null };
    },

    // Test helpers - state inspection
    getSentMessages() {
      return sentMessages;
    },
    getSentMedia() {
      return sentMedia;
    },
    getReadReceipts() {
      return readReceipts;
    },

    // Group creation helpers for welcome group tests
    async createGroup(name, participants = []) {
      if (!this._connected) {
        throw new Error('WhatsApp not connected');
      }
      if (behaviors.createGroup) {
        return behaviors.createGroup(name, participants);
      }
      const jid = `120363${Date.now()}@g.us`;
      createGroupCalls.push({ name, participants, jid });
      return { jid, name };
    },

    getCreateGroupCalls() {
      return createGroupCalls;
    },

    resetCreateGroupCalls() {
      createGroupCalls.length = 0;
    },

    setCreateGroupResult(result) {
      behaviors.createGroup = () => result;
    },

    setCreateGroupError(error) {
      behaviors.createGroup = () => { throw error; };
    },

    clearSentMessages() {
      sentMessages.length = 0;
    },

    // ── Group Management ────────────────────────────────────────────────────────

    async getJoinedGroups() {
      if (behaviors.getJoinedGroups) return behaviors.getJoinedGroups();
      if (!this._connected) throw new Error('WhatsApp not connected');
      return [
        { jid: '120363001234@g.us', name: 'Engineering Team', participants: [] },
        { jid: '120363005678@g.us', name: 'WhatsAppMCP',       participants: [] }
      ];
    },

    async getGroupInviteLink(jid) {
      if (behaviors.getGroupInviteLink) return behaviors.getGroupInviteLink(jid);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return 'ABC123INVITELINK';
    },

    async joinGroupWithLink(code) {
      if (behaviors.joinGroupWithLink) return behaviors.joinGroupWithLink(code);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return { jid: '120363099999@g.us' };
    },

    async leaveGroup(jid) {
      if (behaviors.leaveGroup) return behaviors.leaveGroup(jid);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return null;
    },

    async updateGroupParticipants(jid, participantJids, action) {
      if (behaviors.updateGroupParticipants) {
        return behaviors.updateGroupParticipants(jid, participantJids, action);
      }
      if (!this._connected) throw new Error('WhatsApp not connected');
      return participantJids.map((p) => ({ jid: p, error: null }));
    },

    async setGroupName(jid, name) {
      if (behaviors.setGroupName) return behaviors.setGroupName(jid, name);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return null;
    },

    async setGroupTopic(jid, topic) {
      if (behaviors.setGroupTopic) return behaviors.setGroupTopic(jid, topic);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return null;
    },

    // ── Message Actions ──────────────────────────────────────────────────────────

    async sendReaction(jid, messageId, emoji) {
      if (behaviors.sendReaction) return behaviors.sendReaction(jid, messageId, emoji);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return { id: `reaction_${Date.now()}` };
    },

    async editMessage(jid, messageId, content) {
      if (behaviors.editMessage) return behaviors.editMessage(jid, messageId, content);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return { id: messageId };
    },

    async revokeMessage(jid, messageId) {
      if (behaviors.revokeMessage) return behaviors.revokeMessage(jid, messageId);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return null;
    },

    async createPoll(jid, question, options, allowMultiple) {
      if (behaviors.createPoll) return behaviors.createPoll(jid, question, options, allowMultiple);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return { id: `poll_${Date.now()}` };
    },

    // ── Contact Info ─────────────────────────────────────────────────────────────

    async getUserInfo(jids) {
      if (behaviors.getUserInfo) return behaviors.getUserInfo(jids);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return Object.fromEntries(jids.map((j) => [j, { name: 'Mock User', status: 'Hey there!' }]));
    },

    async isOnWhatsApp(phones) {
      if (behaviors.isOnWhatsApp) return behaviors.isOnWhatsApp(phones);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return phones.map((p) => ({ jid: `${p.replace(/\D/g, '')}@s.whatsapp.net`, phone: p, exists: true }));
    },

    async getProfilePicture(jid) {
      if (behaviors.getProfilePicture) return behaviors.getProfilePicture(jid);
      if (!this._connected) throw new Error('WhatsApp not connected');
      return 'https://mock.whatsapp.net/profile/abc123.jpg';
    },

    // Allow test overrides
    ...overrides
  };

  // Sync internal state
  Object.defineProperty(client, '_connected', {
    get: () => _connected,
    set: (val) => { _connected = val; }
  });

  Object.defineProperty(client, 'jid', {
    get: () => _jid,
    set: (val) => { _jid = val; }
  });

  return client;
}
