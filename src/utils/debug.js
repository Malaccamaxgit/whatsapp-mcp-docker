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

const enabled = process.env.DEBUG ? process.env.DEBUG.split(',') : [];

/**
 * Create a debug logger for a specific namespace.
 * @param {string} namespace - Category name (e.g., 'auth', 'client', 'store')
 * @returns {(message: string, ...args: any[]) => void}
 */
export function debug(namespace) {
  const isEnabled = enabled.includes('*') || enabled.includes(namespace);

  if (!isEnabled) {
    // Return no-op function when disabled (zero overhead)
    return () => {};
  }

  return (message, ...args) => {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const prefix = `[${timestamp}] [${namespace.toUpperCase()}]`;
    console.error(prefix, message, ...args);
  };
}

/**
 * Check if debug logging is enabled for a namespace.
 * @param {string} namespace
 * @returns {boolean}
 */
export function isDebugEnabled(namespace) {
  return enabled.includes('*') || enabled.includes(namespace);
}

/**
 * One-time debug log (useful for startup messages).
 * @param {string} namespace
 * @param {string} message
 * @param {...any} args
 */
export function debugOnce(namespace, message, ...args) {
  const log = debug(namespace);
  log(message, ...args);
}

export default debug;
