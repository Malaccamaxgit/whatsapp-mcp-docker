import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PermissionManager } from '../../src/security/permissions.js';

describe('permissions', () => {
  beforeEach(() => {
    // Reset env
    delete process.env.ALLOWED_CONTACTS;
    delete process.env.RATE_LIMIT_PER_MIN;
    delete process.env.DISABLED_TOOLS;
  });

  describe('isToolEnabled', () => {
    it('allows all tools by default', () => {
      const pm = new PermissionManager();
      assert.equal(pm.isToolEnabled('send_message').allowed, true);
      assert.equal(pm.isToolEnabled('download_media').allowed, true);
    });

    it('disables specified tools', () => {
      process.env.DISABLED_TOOLS = 'send_file,download_media';
      const pm = new PermissionManager();
      assert.equal(pm.isToolEnabled('send_file').allowed, false);
      assert.match(pm.isToolEnabled('send_file').error ?? '', /disabled/i);
      assert.equal(pm.isToolEnabled('download_media').allowed, false);
      assert.equal(pm.isToolEnabled('send_message').allowed, true);
    });
  });

  describe('canSendTo', () => {
    it('allows all contacts when whitelist is empty', () => {
      const pm = new PermissionManager();
      assert.equal(pm.canSendTo('15145551234@s.whatsapp.net').allowed, true);
    });

    it('allows whitelisted contacts', () => {
      process.env.ALLOWED_CONTACTS = '+15145551234,+353871234567';
      const pm = new PermissionManager();
      assert.equal(pm.canSendTo('15145551234@s.whatsapp.net').allowed, true);
      assert.equal(pm.canSendTo('353871234567@s.whatsapp.net').allowed, true);
    });

    it('rejects non-whitelisted contacts', () => {
      process.env.ALLOWED_CONTACTS = '+15145551234';
      const pm = new PermissionManager();
      const r = pm.canSendTo('999999999@s.whatsapp.net');
      assert.equal(r.allowed, false);
      assert.match(r.error ?? '', /not in the allowed/i);
    });
  });

  describe('checkRateLimit', () => {
    it('allows messages under the limit', () => {
      process.env.RATE_LIMIT_PER_MIN = '5';
      const pm = new PermissionManager();
      for (let i = 0; i < 5; i++) {
        assert.equal(pm.checkRateLimit().allowed, true);
      }
    });

    it('rejects messages over the limit', () => {
      process.env.RATE_LIMIT_PER_MIN = '3';
      const pm = new PermissionManager();
      pm.checkRateLimit();
      pm.checkRateLimit();
      pm.checkRateLimit();
      const r = pm.checkRateLimit();
      assert.equal(r.allowed, false);
      assert.match(r.error ?? '', /rate limit/i);
      assert.ok(r.retryAfterSec > 0);
    });
  });

  describe('checkDownloadRateLimit', () => {
    it('allows downloads under the limit', () => {
      const pm = new PermissionManager();
      for (let i = 0; i < 20; i++) {
        assert.equal(pm.checkDownloadRateLimit().allowed, true);
      }
    });

    it('rejects downloads over the limit', () => {
      const pm = new PermissionManager();
      // Default DOWNLOADS_PER_MIN is 30; exhaust all slots then expect rejection
      for (let i = 0; i < 30; i++) {pm.checkDownloadRateLimit();}
      const r = pm.checkDownloadRateLimit();
      assert.equal(r.allowed, false);
      assert.match(r.error ?? '', /download rate limit/i);
    });
  });

  describe('checkAuthRateLimit', () => {
    it('allows first attempt', () => {
      const pm = new PermissionManager();
      assert.equal(pm.checkAuthRateLimit().allowed, true);
    });

    it('rejects after 5 attempts in 30 min window', () => {
      const pm = new PermissionManager();
      for (let i = 0; i < 5; i++) {
        pm.checkAuthRateLimit();
        pm.recordAuthAttempt(false);
      }
      const r = pm.checkAuthRateLimit();
      assert.equal(r.allowed, false);
      assert.match(r.error ?? '', /too many/i);
    });
  });

  describe('recordAuthAttempt / backoff', () => {
    it('applies exponential backoff on failure', () => {
      const pm = new PermissionManager();

      pm.checkAuthRateLimit();
      pm.recordAuthAttempt(false);
      assert.equal(pm.authBackoffSec, 60);

      // The next attempt should be blocked by cooldown
      const r = pm.checkAuthRateLimit();
      assert.equal(r.allowed, false);
      assert.match(r.error ?? '', /cooldown/i);
    });

    it('resets backoff on success', () => {
      const pm = new PermissionManager();

      pm.checkAuthRateLimit();
      pm.recordAuthAttempt(false);
      assert.equal(pm.authBackoffSec, 60);

      pm.recordAuthAttempt(true);
      assert.equal(pm.authBackoffSec, 0);
    });

    it('resetAuthBackoff clears backoff', () => {
      const pm = new PermissionManager();
      pm.recordAuthAttempt(false);
      pm.recordAuthAttempt(false);
      assert.ok(pm.authBackoffSec > 0);

      pm.resetAuthBackoff();
      assert.equal(pm.authBackoffSec, 0);
    });

    it('caps backoff at 900 seconds', () => {
      const pm = new PermissionManager();
      for (let i = 0; i < 10; i++) {
        (pm as unknown as { _authBackoffSec: number })._authBackoffSec = 0; // reset for next recordAuthAttempt
        (pm as unknown as { _lastAuthAttempt: number })._lastAuthAttempt = 0;
        pm.recordAuthAttempt(false);
      }
      // Manually escalate to verify cap
      const pm2 = new PermissionManager();
      (pm2 as unknown as { _authBackoffSec: number })._authBackoffSec = 480;
      (pm2 as unknown as { _lastAuthAttempt: number })._lastAuthAttempt = 0;
      pm2.recordAuthAttempt(false);
      assert.equal(pm2.authBackoffSec, 900);

      pm2.recordAuthAttempt(false);
      assert.equal(pm2.authBackoffSec, 900);
    });
  });
});
