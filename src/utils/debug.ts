/**
 * Debug Logging Utility
 *
 * Provides conditional logging based on DEBUG environment variable.
 * When DEBUG is set, logs are prefixed with namespace and timestamp.
 *
 * Usage:
 *   import { debug } from './utils/debug.js';
 *   const log = debug('auth');
 *   log('Pairing code requested for', phoneNumber);
 *
 * Enable with: DEBUG=auth,client,store npm start
 * Or: DEBUG=* npm start (all namespaces)
 */

type LogFn = (message: string, ...args: unknown[]) => void;

const enabled: string[] = process.env.DEBUG ? process.env.DEBUG.split(',') : [];

/**
 * Create a debug logger for a specific namespace.
 * @param namespace - Category name (e.g., 'auth', 'client', 'store')
 * @returns A log function that accepts message and variadic args
 */
export function debug(namespace: string): LogFn {
  const isEnabled = enabled.includes('*') || enabled.includes(namespace);

  if (!isEnabled) {
    // Return no-op function when disabled (zero overhead)
    return () => {};
  }

  return (message: string, ...args: unknown[]) => {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const prefix = `[${timestamp}] [${namespace.toUpperCase()}]`;
    console.error(prefix, message, ...args);
  };
}

/**
 * Check if debug logging is enabled for a namespace.
 * @param namespace - The namespace to check
 * @returns true if debug is enabled for this namespace
 */
export function isDebugEnabled(namespace: string): boolean {
  return enabled.includes('*') || enabled.includes(namespace);
}

/**
 * One-time debug log (useful for startup messages).
 * @param namespace - The namespace for this log
 * @param message - The message to log
 * @param args - Additional arguments to pass to the log function
 */
export function debugOnce(namespace: string, message: string, ...args: unknown[]): void {
  const log = debug(namespace);
  log(message, ...args);
}

export default debug;
