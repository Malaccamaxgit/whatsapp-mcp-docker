import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripNonDigits,
  validatePhoneNumber,
  toJid,
  isJid,
  isGroupJid
} from '../../src/utils/phone.js';

describe('stripNonDigits', () => {
  it('removes spaces, dashes, parens, and plus', () => {
    assert.equal(stripNonDigits('+1 (514) 555-1234'), '15145551234');
  });

  it('returns empty string for non-digit input', () => {
    assert.equal(stripNonDigits('abc'), '');
  });

  it('preserves pure digit strings', () => {
    assert.equal(stripNonDigits('15145551234'), '15145551234');
  });
});

describe('validatePhoneNumber', () => {
  it('accepts valid E.164 with +', () => {
    const r = validatePhoneNumber('+15145551234');
    assert.equal(r.valid, true);
    assert.equal(r.number, '15145551234');
    assert.equal(r.error, null);
  });

  it('accepts valid number without + (digits only)', () => {
    const r = validatePhoneNumber('353871234567');
    assert.equal(r.valid, true);
    assert.equal(r.number, '353871234567');
  });

  it('rejects null/undefined/empty', () => {
    assert.equal(validatePhoneNumber(null).valid, false);
    assert.equal(validatePhoneNumber(undefined).valid, false);
    assert.equal(validatePhoneNumber('').valid, false);
    assert.equal(validatePhoneNumber('   ').valid, false);
  });

  it('rejects non-string input', () => {
    assert.equal(validatePhoneNumber(12345).valid, false);
  });

  it('rejects no-digit input', () => {
    const r = validatePhoneNumber('+++');
    assert.equal(r.valid, false);
    assert.match(r.error, /no digits/);
  });

  it('detects "00" international prefix and suggests "+"', () => {
    const r = validatePhoneNumber('0033612345678');
    assert.equal(r.valid, false);
    assert.match(r.error, /Use "\+" instead of "00"/);
    assert.match(r.error, /33612345678/);
  });

  it('detects local number starting with 0', () => {
    const r = validatePhoneNumber('0612345678');
    assert.equal(r.valid, false);
    assert.match(r.error, /local number/i);
    assert.match(r.error, /country code/i);
  });

  it('does NOT reject "+0..." (leading 0 after +) as local', () => {
    // "+0..." starts with "+" so it should NOT be caught as a "local number"
    // but it will be caught as too short or the 00-prefix rule
    const r = validatePhoneNumber('+0612345678');
    // This starts with + and digits are 0612345678 (10 digits, valid length).
    // digits don't start with 00, and trimmed starts with +
    // so it should pass as valid
    assert.equal(r.valid, true);
  });

  it('rejects too-short numbers', () => {
    const r = validatePhoneNumber('+123');
    assert.equal(r.valid, false);
    assert.match(r.error, /too short/);
  });

  it('rejects too-long numbers', () => {
    const r = validatePhoneNumber('+1234567890123456');
    assert.equal(r.valid, false);
    assert.match(r.error, /too long/);
  });

  it('handles whitespace and dashes gracefully', () => {
    const r = validatePhoneNumber('+1 514-555-1234');
    assert.equal(r.valid, true);
    assert.equal(r.number, '15145551234');
  });
});

describe('toJid', () => {
  it('converts a phone number to a user JID', () => {
    assert.equal(toJid('+15145551234'), '15145551234@s.whatsapp.net');
  });

  it('returns an existing JID unchanged', () => {
    assert.equal(toJid('15145551234@s.whatsapp.net'), '15145551234@s.whatsapp.net');
    assert.equal(toJid('123@g.us'), '123@g.us');
  });

  it('returns null for falsy input', () => {
    assert.equal(toJid(null), null);
    assert.equal(toJid(undefined), null);
    assert.equal(toJid(''), null);
  });

  it('throws on invalid phone number', () => {
    assert.throws(() => toJid('abc'), /no digits/i);
  });
});

describe('isJid', () => {
  it('recognises user JIDs', () => {
    assert.equal(isJid('12345@s.whatsapp.net'), true);
  });

  it('recognises group JIDs', () => {
    assert.equal(isJid('12345@g.us'), true);
  });

  it('rejects non-JIDs', () => {
    assert.equal(isJid('+15145551234'), false);
    assert.equal(isJid('hello'), false);
    assert.equal(isJid(null), false);
    assert.equal(isJid(42), false);
  });
});

describe('isGroupJid', () => {
  it('returns true for group JIDs', () => {
    assert.equal(isGroupJid('1234-5678@g.us'), true);
  });

  it('returns false for user JIDs', () => {
    assert.equal(isGroupJid('12345@s.whatsapp.net'), false);
  });

  it('returns false for non-strings', () => {
    assert.equal(isGroupJid(null), false);
    assert.equal(isGroupJid(123), false);
  });
});
