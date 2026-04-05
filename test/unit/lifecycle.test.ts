import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performShutdown } from '../../src/lifecycle.js';

describe('lifecycle / performShutdown', () => {
  it('disconnects, closes resources, logs audit, and exits with code 0', async () => {
    const calls: string[] = [];
    let exitCode: number | null = null;

    const waClient = {
      async disconnect () {
        calls.push('disconnect');
      }
    };
    const store = {
      close () {
        calls.push('store.close');
      }
    };
    const audit = {
      close () {
        calls.push('audit.close');
      },
      log (scope: string, action: string, data?: unknown) {
        assert.equal(scope, 'server');
        assert.equal(action, 'shutdown');
        assert.deepEqual(data, { reason: 'sigint' });
        calls.push('audit.log');
      }
    };

    await performShutdown('sigint', {
      waClient,
      store,
      audit,
      exit: (code: number) => {
        exitCode = code;
      },
      logger: { error: () => {} }
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, ['audit.log', 'disconnect', 'store.close', 'audit.close']);
  });

  it('still closes resources and exits when disconnect throws', async () => {
    const calls: string[] = [];
    let exitCode: number | null = null;
    const logged: unknown[][] = [];

    const waClient = {
      async disconnect () {
        calls.push('disconnect');
        throw new Error('disconnect failed');
      }
    };
    const store = {
      close () {
        calls.push('store.close');
      }
    };
    const audit = {
      close () {
        calls.push('audit.close');
      },
      log () {
        calls.push('audit.log');
      }
    };

    await performShutdown('stdin_closed', {
      waClient,
      store,
      audit,
      exit: (code: number) => {
        exitCode = code;
      },
      logger: {
        error: (...args: unknown[]) => {
          logged.push(args);
        }
      }
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, ['audit.log', 'disconnect', 'store.close', 'audit.close']);
    assert.ok(logged.some((args) => String(args[0]).includes('disconnect failed')));
  });
});
