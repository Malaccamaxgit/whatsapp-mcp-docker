/**
 * Process lifecycle helpers.
 *
 * Keep shutdown behavior in one place so it can be tested without
 * sending real POSIX signals in unit tests.
 */

export interface ShutdownDependencies {
  waClient: { disconnect: () => Promise<void> };
  store: { close: () => void };
  audit: {
    close: () => void;
    log: (scope: string, action: string, data?: Record<string, unknown>, success?: boolean) => void;
  };
  exit?: (code: number) => never | void;
  logger?: { error: (...args: unknown[]) => void };
}

export async function performShutdown (
  reason: 'sigint' | 'sigterm' | 'stdin_closed',
  deps: ShutdownDependencies
): Promise<void> {
  const logger = deps.logger ?? console;
  const exit = deps.exit ?? process.exit;

  if (reason === 'sigterm') {
    logger.error('[SHUTDOWN] SIGTERM received');
  } else if (reason === 'stdin_closed') {
    logger.error('[SHUTDOWN] stdin closed — gateway disconnected, self-terminating');
  } else {
    logger.error('[SHUTDOWN] Closing...');
  }

  deps.audit.log('server', 'shutdown', { reason });

  try {
    await deps.waClient.disconnect();
  } catch (error) {
    logger.error('[SHUTDOWN] disconnect failed:', error);
  }

  deps.store.close();
  deps.audit.close();
  exit(0);
}
