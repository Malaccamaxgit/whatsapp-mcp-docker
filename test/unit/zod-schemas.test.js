import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PhoneSchema, PhoneArraySchema } from '../../src/utils/zod-schemas.js';

// Helper: parse via Zod and return { ok, value, error }
function tryParse(schema, value) {
  const r = schema.safeParse(value);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, error: r.error.issues[0]?.message };
}

describe('PhoneSchema', () => {
  describe('valid inputs', () => {
    it('accepts a well-formed E.164 number', () => {
      const r = tryParse(PhoneSchema, '+15145551234');
      assert.equal(r.ok, true);
    });

    it('accepts a JID (user)', () => {
      const r = tryParse(PhoneSchema, '15145551234@s.whatsapp.net');
      assert.equal(r.ok, true);
    });

    it('accepts a JID (group)', () => {
      const r = tryParse(PhoneSchema, '120363001234@g.us');
      assert.equal(r.ok, true);
    });

    it('accepts a number without leading +', () => {
      // validatePhoneNumber allows pure digit strings of valid length
      const r = tryParse(PhoneSchema, '353871234567');
      assert.equal(r.ok, true);
    });

    it('accepts a number with spaces and dashes', () => {
      const r = tryParse(PhoneSchema, '+1 514-555-1234');
      assert.equal(r.ok, true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects a local number starting with 0', () => {
      const r = tryParse(PhoneSchema, '0612345678');
      assert.equal(r.ok, false);
      assert.match(r.error, /local number|country code/i);
    });

    it('rejects a too-short number', () => {
      const r = tryParse(PhoneSchema, '+123');
      assert.equal(r.ok, false);
      assert.match(r.error, /too short/i);
    });

    it('rejects a too-long number', () => {
      const r = tryParse(PhoneSchema, '+1234567890123456');
      assert.equal(r.ok, false);
      assert.match(r.error, /too long/i);
    });

    it('rejects 00-prefixed international format', () => {
      const r = tryParse(PhoneSchema, '0033612345678');
      assert.equal(r.ok, false);
      assert.match(r.error, /Use "\+"/i);
    });

    it('rejects empty string', () => {
      const r = tryParse(PhoneSchema, '');
      assert.equal(r.ok, false);
    });

    it('rejects a plain contact name (not a number or JID)', () => {
      const r = tryParse(PhoneSchema, 'John Smith');
      // Has no '@' and validatePhoneNumber('John Smith') is invalid
      assert.equal(r.ok, false);
    });

    it('rejects null', () => {
      const r = tryParse(PhoneSchema, null);
      assert.equal(r.ok, false);
    });
  });
});

describe('PhoneArraySchema', () => {
  it('accepts an array of valid phones', () => {
    const schema = PhoneArraySchema(1, 5);
    const r = tryParse(schema, ['+15145551234', '353871234567@s.whatsapp.net']);
    assert.equal(r.ok, true);
  });

  it('rejects an empty array when min is 1', () => {
    const schema = PhoneArraySchema(1, 5);
    const r = tryParse(schema, []);
    assert.equal(r.ok, false);
  });

  it('rejects when array exceeds max', () => {
    const schema = PhoneArraySchema(1, 2);
    const r = tryParse(schema, ['+15145551234', '+15145551235', '+15145551236']);
    assert.equal(r.ok, false);
  });

  it('propagates per-item validation errors', () => {
    const schema = PhoneArraySchema(1, 5);
    const r = tryParse(schema, ['+15145551234', '0612345678']);
    assert.equal(r.ok, false);
    // Error message should reference the bad phone
    assert.match(r.error, /local number|country code/i);
  });

  it('accepts an array with only JIDs', () => {
    const schema = PhoneArraySchema(1, 10);
    const r = tryParse(schema, ['120363001234@g.us', '15145551234@s.whatsapp.net']);
    assert.equal(r.ok, true);
  });

  it('respects custom min and max bounds', () => {
    const schema = PhoneArraySchema(2, 3);
    // Too few
    assert.equal(tryParse(schema, ['+15145551234']).ok, false);
    // Too many
    assert.equal(
      tryParse(schema, ['+15145551234', '+15145551235', '+15145551236', '+15145551237']).ok,
      false
    );
    // Just right
    assert.equal(tryParse(schema, ['+15145551234', '+15145551235']).ok, true);
  });
});
