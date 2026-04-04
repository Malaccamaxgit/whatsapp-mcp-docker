/**
 * Field-Level Encryption
 *
 * AES-256-GCM encryption for sensitive database fields.
 * Opt-in via DATA_ENCRYPTION_KEY env var.
 * Values are prefixed with "enc:" so plaintext and encrypted
 * values can coexist during migration.
 *
 * Key derivation: scrypt (N=2^17, r=8, p=1) with a fixed application salt.
 * Using a fixed salt is intentional — this is deterministic key derivation
 * from a passphrase, not password storage. scrypt's memory-hardness makes
 * brute-force of the passphrase expensive even with a known salt.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:';
const IV_LEN = 12;
const TAG_LEN = 16;
// Fixed application salt for deterministic key derivation (not password storage).
const KDF_SALT = Buffer.from('whatsapp-mcp-docker-kdf-v1');
// N=2^14 (NIST minimum for interactive use): needs 16 MB, well within Node's 32 MB maxmem default.
const KDF_OPTS = { N: 1 << 14, r: 8, p: 1 };

let _key: Buffer | null = null;

/**
 * Initialize encryption with a passphrase.
 * Derives a 32-byte AES key using scrypt (memory-hard KDF).
 * Returns true if encryption is active.
 */
export function initEncryption (passphrase: string): boolean {
  if (!passphrase) {
    _key = null;
    return false;
  }
  _key = scryptSync(passphrase, KDF_SALT, 32, KDF_OPTS);
  console.error('[CRYPTO] Field-level encryption enabled');
  return true;
}

export function isEncryptionEnabled (): boolean {
  return _key !== null;
}

/**
 * Encrypt a plaintext string. Returns prefixed ciphertext.
 * Returns the original value unchanged if encryption is off or value is empty.
 */
export function encrypt (plaintext: string): string {
  if (!_key || !plaintext) {return plaintext;}

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
export function decrypt (value: string): string {
  if (!value || typeof value !== 'string' || !value.startsWith(PREFIX)) {
    return value;
  }
  if (!_key) {return value;}

  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    if (buf.length < IV_LEN + TAG_LEN + 1) {return value;}

    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const data = buf.subarray(IV_LEN + TAG_LEN);

    const decipher = createDecipheriv(ALGORITHM, _key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final('utf8');
  } catch (e) {
    console.error('[CRYPTO] Decryption failed, returning raw value:', (e as Error).message);
    return value;
  }
}
