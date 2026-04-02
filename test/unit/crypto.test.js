import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initEncryption,
  isEncryptionEnabled,
  encrypt,
  decrypt
} from '../../src/security/crypto.js';

describe('crypto', () => {
  afterEach(() => {
    initEncryption(null);
  });

  describe('initEncryption', () => {
    it('enables encryption with a passphrase', () => {
      const result = initEncryption('test-passphrase');
      assert.equal(result, true);
      assert.equal(isEncryptionEnabled(), true);
    });

    it('disables encryption with null/empty passphrase', () => {
      initEncryption('test');
      assert.equal(isEncryptionEnabled(), true);

      initEncryption(null);
      assert.equal(isEncryptionEnabled(), false);

      initEncryption('');
      assert.equal(isEncryptionEnabled(), false);
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    beforeEach(() => {
      initEncryption('test-passphrase');
    });

    it('round-trips a simple string', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encrypt(plaintext);
      assert.notEqual(encrypted, plaintext);
      assert.ok(encrypted.startsWith('enc:'));
      assert.equal(decrypt(encrypted), plaintext);
    });

    it('round-trips unicode and emoji', () => {
      const plaintext = 'Bonjour 🌍 café résumé 日本語';
      const encrypted = encrypt(plaintext);
      assert.equal(decrypt(encrypted), plaintext);
    });

    it('round-trips long text', () => {
      const plaintext = 'a'.repeat(10_000);
      const encrypted = encrypt(plaintext);
      assert.equal(decrypt(encrypted), plaintext);
    });

    it('produces different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'same text';
      const e1 = encrypt(plaintext);
      const e2 = encrypt(plaintext);
      assert.notEqual(e1, e2);
      assert.equal(decrypt(e1), plaintext);
      assert.equal(decrypt(e2), plaintext);
    });
  });

  describe('passthrough when disabled', () => {
    beforeEach(() => {
      initEncryption(null);
    });

    it('encrypt returns original value when disabled', () => {
      assert.equal(encrypt('hello'), 'hello');
    });

    it('decrypt returns original value for non-prefixed string', () => {
      assert.equal(decrypt('hello'), 'hello');
    });

    it('decrypt returns enc:-prefixed value unchanged when key is absent', () => {
      assert.equal(decrypt('enc:abc'), 'enc:abc');
    });
  });

  describe('edge cases', () => {
    it('encrypt returns null/empty unchanged', () => {
      initEncryption('test-passphrase');
      assert.equal(encrypt(null), null);
      assert.equal(encrypt(''), '');
      assert.equal(encrypt(undefined), undefined);
    });

    it('decrypt returns non-string unchanged', () => {
      assert.equal(decrypt(null), null);
      assert.equal(decrypt(undefined), undefined);
      assert.equal(decrypt(42), 42);
    });

    it('decrypt returns corrupted enc: values as-is', () => {
      initEncryption('test-passphrase');
      // Truncated value — too short to contain IV+tag+data
      const result = decrypt('enc:dG9vc2hvcnQ=');
      assert.ok(typeof result === 'string');
    });

    it('wrong key fails gracefully', () => {
      initEncryption('key-one');
      const encrypted = encrypt('secret data');

      initEncryption('key-two');
      const result = decrypt(encrypted);
      // Should return the raw value (decryption failed gracefully)
      assert.ok(typeof result === 'string');
    });
  });

  describe('plaintext coexistence', () => {
    it('decrypt passes through legacy plaintext when encryption is on', () => {
      initEncryption('test-passphrase');
      assert.equal(decrypt('plain old text'), 'plain old text');
    });
  });

  describe('key rotation scenarios', () => {
    it('prevents decryption after key change (data becomes unreadable)', () => {
      // Encrypt with first key
      initEncryption('original-key');
      const plaintext = 'sensitive data that needs protection';
      const encrypted = encrypt(plaintext);
      
      // Verify it decrypts correctly with original key
      assert.equal(decrypt(encrypted), plaintext);
      assert.ok(encrypted.startsWith('enc:'));
      
      // Change to different key
      initEncryption('new-different-key');
      
      // Attempt to decrypt with new key
      const result = decrypt(encrypted);
      
      // Data cannot be recovered - returns raw encrypted value
      assert.ok(typeof result === 'string');
      assert.ok(result.startsWith('enc:'), 'Should return prefixed value unchanged');
      assert.notEqual(result, plaintext, 'Should NOT return original plaintext');
    });

    it('allows key to be reset to null and re-enabled', () => {
      // Start with encryption
      initEncryption('first-key');
      const value1 = encrypt('data with first key');
      assert.ok(isEncryptionEnabled());
      
      // Disable encryption
      initEncryption(null);
      assert.equal(isEncryptionEnabled(), false);
      assert.equal(encrypt('new data'), 'new data'); // Passthrough
      
      // Re-enable with same key
      initEncryption('first-key');
      assert.equal(isEncryptionEnabled(), true);
      assert.equal(decrypt(value1), 'data with first key');
    });

    it('handles multiple key changes in sequence', () => {
      const keys = ['key-alpha', 'key-beta', 'key-gamma'];
      const encryptedValues = [];
      
      // Encrypt with each key
      for (const key of keys) {
        initEncryption(key);
        encryptedValues.push(encrypt(`data with ${key}`));
      }
      
      // Verify each value decrypts with its original key
      for (let i = 0; i < keys.length; i++) {
        initEncryption(keys[i]);
        assert.equal(decrypt(encryptedValues[i]), `data with ${keys[i]}`);
      }
      
      // Verify values do NOT decrypt with wrong keys
      initEncryption('wrong-key');
      for (const encrypted of encryptedValues) {
        const result = decrypt(encrypted);
        assert.ok(result.startsWith('enc:'), 'Should return prefixed value, not plaintext');
      }
    });

    it('preserves encrypted values when encryption is toggled on and off', () => {
      // Encrypt with key
      initEncryption('stable-key');
      const encrypted = encrypt('important data');
      
      // Turn off encryption
      initEncryption(null);
      assert.equal(isEncryptionEnabled(), false);
      
      // Re-enable with same key
      initEncryption('stable-key');
      
      // Original value should still decrypt correctly
      assert.equal(decrypt(encrypted), 'important data');
    });

    it('handles key rotation data migration scenario', () => {
      // Simulate: encrypt data, rotate key, cannot read old data
      // This is the expected behavior - database would need manual re-encryption
      
      initEncryption('old-key-2025');
      const oldEncrypted = encrypt('old sensitive data');
      
      // Simulate key rotation (new deployment with new key)
      initEncryption('new-key-2026');
      
      // Old data cannot be read
      const oldResult = decrypt(oldEncrypted);
      assert.notEqual(oldResult, 'old sensitive data', 'Old data should not decrypt');
      
      // New data encrypts fine
      const newEncrypted = encrypt('new sensitive data');
      assert.equal(decrypt(newEncrypted), 'new sensitive data', 'New data should work');
    });

    it('returns prefixed value as fallback when decryption fails', () => {
      initEncryption('key-one');
      const encrypted = encrypt('test data');
      
      // Change key
      initEncryption('key-two');
      
      // Decryption should return the prefixed value unchanged
      const result = decrypt(encrypted);
      assert.ok(result.startsWith('enc:'), 'Should return prefixed value');
      
      // The prefixed value contains base64, not readable text
      assert.ok(!result.includes('test data'), 'Should not contain plaintext');
    });
  });
});
