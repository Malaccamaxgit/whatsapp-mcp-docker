import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkHealth, MIN_SESSION_BYTES } from '../../src/healthcheck.js';

describe('healthcheck / checkHealth', () => {
  it('returns true when session.db exists and is large enough', () => {
    const healthy = checkHealth(
      '/tmp/mock',
      () => ({ size: MIN_SESSION_BYTES + 2048, mtimeMs: 1000 }),
      () => 3000
    );
    assert.equal(healthy, true);
  });

  it('returns false when session.db is too small', () => {
    const healthy = checkHealth(
      '/tmp/mock',
      () => ({ size: MIN_SESSION_BYTES - 1, mtimeMs: 1000 }),
      () => 3000
    );
    assert.equal(healthy, false);
  });

  it('returns false when session.db does not exist', () => {
    const enoent = new Error('not found') as NodeJS.ErrnoException;
    enoent.code = 'ENOENT';
    const healthy = checkHealth('/tmp/mock', () => {
      throw enoent;
    });
    assert.equal(healthy, false);
  });
});
