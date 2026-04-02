/**
 * Field-Level Encryption
 *
 * AES-256-GCM encryption for sensitive database fields.
 * Opt-in via DATA_ENCRYPTION_KEY env var.
 * Values are prefixed with "enc:" so plaintext and encrypted
 * values can coexist during migration.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:';
const IV_LEN = 12;
const TAG_LEN = 16;

let _key = null;

/**
 * Initialize encryption with a passphrase.
 * The passphrase is hashed to a 32-byte key via SHA-256.
 * Returns true if encryption is active.
 */
export function initEncryption(passphrase) {
  if (!passphrase) {
    _key = null;
    return false;
  }
  _key = createHash('sha256').update(passphrase).digest();
  console.error('[CRYPTO] Field-level encryption enabled');
  return true;
}

export function isEncryptionEnabled() {
  return _key !== null;
}

/**
 * Encrypt a plaintext string. Returns prefixed ciphertext.
 * Returns the original value unchanged if encryption is off or value is empty.
 */
export function encrypt(plaintext) {
  if (!_key || !plaintext) return plaintext;

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, _key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a value. Detects the "enc:" prefix to distinguish
 * encrypted values from legacy plaintext (allows gradual migration).
 * Returns the original value if encryption is off or value is not encrypted.
 */
export function decrypt(value) {
  if (!value || typeof value !== 'string' || !value.startsWith(PREFIX)) {
    return value;
  }
  if (!_key) return value;

  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    if (buf.length < IV_LEN + TAG_LEN + 1) return value;

    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const data = buf.subarray(IV_LEN + TAG_LEN);

    const decipher = createDecipheriv(ALGORITHM, _key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final('utf8');
  } catch (e) {
    console.error('[CRYPTO] Decryption failed, returning raw value:', e.message);
    return value;
  }
}
