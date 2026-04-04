import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, getErrorCode, createErrorResponse } from '../../src/utils/errors.js';
import { ERROR_CODES } from '../../src/constants.js';

// ── classifyError ─────────────────────────────────────────────────────────────

describe('classifyError', () => {
  describe('transient errors (retry: true, code: 503)', () => {
    const transientMessages = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ENOTFOUND host',
      'ENETUNREACH',
      'network error occurred',
      'timed out waiting for response',
      'temporarily unavailable',
      'rate limit exceeded',
      'health check failed',
      'heartbeat missed',
      'silent timeout',
      'connection lost',
      'socket hang up',
      'stream:error',
      'disconnect event',
      'reconnect attempt',
      'websocket not connected',
      'media connection reset',
      'refresh media connection',
      'query media failed'
    ];

    for (const msg of transientMessages) {
      it(`classifies "${msg}" as transient`, () => {
        const result = classifyError(new Error(msg));
        assert.equal(result.type, 'transient', `"${msg}" should be transient`);
        assert.equal(result.code, 503);
        assert.equal(result.retry, true);
      });
    }
  });

  describe('permanent errors (retry: false, code: 401)', () => {
    const permanentMessages = [
      'revoked session',
      'replaced by another device',
      'banned account',
      'account banned permanently',
      'unlinked device',
      'device_removed',
      'logged out',
      'logged_out',
      'multidevice_mismatch',
      'session expired',
      'authentication failed',
      'not authorized to perform',
      'pairing failed',
      'qr expired',
      'device limit reached',
      'not logged in'
    ];

    for (const msg of permanentMessages) {
      it(`classifies "${msg}" as permanent`, () => {
        const result = classifyError(new Error(msg));
        assert.equal(result.type, 'permanent', `"${msg}" should be permanent`);
        assert.equal(result.code, 401);
        assert.equal(result.retry, false);
      });
    }
  });

  describe('client errors (retry: false, code: 400)', () => {
    const clientMessages = [
      'not found',
      'invalid phone number',
      'missing required field',
      'required parameter absent',
      'contact blocked',
      'not in whitelist',
      'tool disabled',
      'permission denied',
      'message too long',
      'file too large',
      'quota exceeded',
      'path traversal detected'
    ];

    for (const msg of clientMessages) {
      it(`classifies "${msg}" as client_error`, () => {
        const result = classifyError(new Error(msg));
        assert.equal(result.type, 'client_error', `"${msg}" should be client_error`);
        assert.equal(result.code, 400);
        assert.equal(result.retry, false);
      });
    }
  });

  describe('unknown errors (retry: false, code: 500)', () => {
    it('classifies a totally unrecognised message as unknown', () => {
      const result = classifyError(new Error('something completely unexpected happened'));
      assert.equal(result.type, 'unknown');
      assert.equal(result.code, 500);
      assert.equal(result.retry, false);
    });

    it('handles null gracefully', () => {
      const result = classifyError(null as unknown as Error | string);
      assert.equal(result.type, 'unknown');
    });

    it('handles undefined gracefully', () => {
      const result = classifyError(undefined as unknown as Error | string);
      assert.equal(result.type, 'unknown');
    });

    it('handles a plain string (not an Error)', () => {
      const result = classifyError('some raw string error');
      assert.ok(['transient', 'permanent', 'client_error', 'unknown'].includes(result.type));
    });

    it('handles an Error with no message', () => {
      const result = classifyError(new Error());
      assert.equal(result.type, 'unknown');
    });
  });

  describe('precedence: transient wins over permanent when both match', () => {
    it('marks "rate limit" as transient even if other words are present', () => {
      // "rate limit" is transient; classified before permanent check
      const result = classifyError(new Error('rate limit revoked'));
      assert.equal(result.type, 'transient');
    });
  });
});

// ── getErrorCode ──────────────────────────────────────────────────────────────

describe('getErrorCode', () => {
  it('returns 401 for authentication-related errors', () => {
    assert.equal(getErrorCode(new Error('authentication failed')), 401);
    assert.equal(getErrorCode(new Error('not authorized')), 401);
    assert.equal(getErrorCode(new Error('account banned')), 401);
  });

  it('returns 429 for rate limit errors', () => {
    assert.equal(getErrorCode(new Error('rate limit exceeded')), 429);
  });

  it('returns 404 for not-found errors', () => {
    assert.equal(getErrorCode(new Error('contact not found')), 404);
    assert.equal(getErrorCode(new Error('missing message')), 404);
  });

  it('returns 403 for permission/blocked errors', () => {
    assert.equal(getErrorCode(new Error('permission denied')), 403);
    assert.equal(getErrorCode(new Error('contact blocked')), 403);
    assert.equal(getErrorCode(new Error('forbidden')), 403);
  });

  it('returns 503 for timeout/unavailable', () => {
    assert.equal(getErrorCode(new Error('timeout reached')), 503);
    assert.equal(getErrorCode(new Error('service unavailable')), 503);
  });

  it('returns 400 for invalid/bad-request errors', () => {
    assert.equal(getErrorCode(new Error('invalid phone number')), 400);
    assert.equal(getErrorCode(new Error('bad request format')), 400);
  });

  it('returns 500 for unrecognised errors', () => {
    assert.equal(getErrorCode(new Error('something weird happened')), 500);
  });

  it('returns 500 for null/undefined input', () => {
    assert.equal(getErrorCode(null as unknown as Error | string), 500);
    assert.equal(getErrorCode(undefined as unknown as Error | string), 500);
  });
});

// ── createErrorResponse ───────────────────────────────────────────────────────

describe('createErrorResponse', () => {
  it('returns isError: true', () => {
    const response = createErrorResponse('send_message', new Error('not found'));
    assert.equal(response.isError, true);
  });

  it('includes the tool name in the response text', () => {
    const response = createErrorResponse('send_message', new Error('not found'));
    assert.ok(response.content[0].text.includes('send_message'), 'tool name should appear in error text');
  });

  it('includes the error message in the response text', () => {
    const response = createErrorResponse('list_chats', new Error('quota exceeded'));
    assert.ok(response.content[0].text.includes('quota exceeded'));
  });

  it('includes a recoveryHint for transient errors', () => {
    const response = createErrorResponse('send_message', new Error('ECONNRESET'));
    assert.ok(response.recoveryHint, 'transient errors should include a recoveryHint');
  });

  it('includes a recoveryHint for permanent errors', () => {
    const response = createErrorResponse('send_message', new Error('session expired'));
    assert.ok(response.recoveryHint, 'permanent errors should include a recoveryHint');
  });

  it('returns a content array with exactly one text element', () => {
    const response = createErrorResponse('list_chats', new Error('network error'));
    assert.ok(Array.isArray(response.content));
    assert.equal(response.content.length, 1);
    assert.equal(response.content[0].type, 'text');
  });

  it('handles plain string errors', () => {
    const response = createErrorResponse('search_messages', 'something went wrong');
    assert.equal(response.isError, true);
    assert.ok(response.content[0].text.includes('something went wrong'));
  });

  it('includes context keys in the response text when provided', () => {
    const response = createErrorResponse('send_message', new Error('not found'), { recipient: 'John' });
    assert.ok(response.content[0].text.includes('recipient') || response.content[0].text.includes('John'));
  });
});

// ── ERROR_CODES constant ──────────────────────────────────────────────────────

describe('ERROR_CODES', () => {
  it('exports a non-empty object from constants.js', () => {
    assert.ok(typeof ERROR_CODES === 'object');
    assert.ok(Object.keys(ERROR_CODES).length > 0);
  });

  it('each value is a numeric HTTP status code (200–599)', () => {
    for (const [, value] of Object.entries(ERROR_CODES)) {
      assert.ok(typeof value === 'number', 'value should be a number');
      assert.ok(value >= 200 && value <= 599, 'value should be a valid HTTP status code');
    }
  });

  it('includes expected authentication codes', () => {
    assert.equal(ERROR_CODES.AUTH_RATE_LIMITED, 429);
    assert.equal(ERROR_CODES.AUTH_SESSION_EXPIRED, 401);
    assert.equal(ERROR_CODES.AUTH_BANNED, 403);
  });

  it('includes expected messaging codes', () => {
    assert.equal(ERROR_CODES.MESSAGE_RATE_LIMITED, 429);
    assert.equal(ERROR_CODES.MESSAGE_RECIPIENT_NOT_FOUND, 404);
    assert.equal(ERROR_CODES.MESSAGE_TOO_LONG, 413);
  });

  it('includes expected media codes', () => {
    assert.equal(ERROR_CODES.MEDIA_QUOTA_EXCEEDED, 413);
    assert.equal(ERROR_CODES.MEDIA_PATH_TRAVERSAL, 403);
  });
});
