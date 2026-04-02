/**
 * Error Classification and Structured Error Responses
 *
 * Provides error classification (transient/permanent/client_error/unknown),
 * error codes, and structured error responses with recovery hints.
 */

// Error pattern matching for classification
const TRANSIENT_PATTERNS = [
  'econnreset',
  'etimedout',
  'econnrefused',
  'enotfound',
  'enetunreach',
  'network',
  'network error',
  'timed out',
  'timeout',
  'temporarily',
  'rate limit',
  'health',
  'heartbeat',
  'silent',
  'connection lost',
  'socket hang up',
  'socket',
  // WhatsApp-specific transient patterns
  'stream:error',
  'disconnect',
  'reconnect',
  'restart',
  'stream',
  // Media upload transient patterns (Go binary not ready right after session restore)
  'websocket not connected',
  'media connection',
  'refresh media',
  'query media'
];

const PERMANENT_PATTERNS = [
  'revoked',
  'replaced',
  'banned',
  'account banned',
  'unlinked',
  'device_removed',
  'logged out',
  'logged_out',
  'multidevice_mismatch',
  'session expired',
  'authentication failed',
  'not authorized',
  // WhatsApp-specific permanent patterns
  'pairing failed',
  'qr expired',
  'device limit',
  'not logged in'
];

const CLIENT_ERROR_PATTERNS = [
  'not found',
  'invalid',
  'missing',
  'required',
  'blocked',
  'whitelist',
  'disabled',
  'permission',
  'too long',
  'too large',
  'quota',
  'path'
];

/**
 * Classify an error into one of four categories
 * @param {Error|string} err - Error object or message
 * @returns {{type: 'transient'|'permanent'|'client_error'|'unknown', code: number, retry: boolean}}
 */
export function classifyError(err) {
  const message = (err?.message || err?.toString() || '').toLowerCase();

  // Check for transient errors (auto-retry)
  if (TRANSIENT_PATTERNS.some((p) => message.includes(p))) {
    return { type: 'transient', code: 503, retry: true };
  }

  // Check for permanent errors (no retry, re-auth required)
  if (PERMANENT_PATTERNS.some((p) => message.includes(p))) {
    return { type: 'permanent', code: 401, retry: false };
  }

  // Check for client errors (no retry, fix input)
  if (CLIENT_ERROR_PATTERNS.some((p) => message.includes(p))) {
    return { type: 'client_error', code: 400, retry: false };
  }

  // Unknown errors (no retry, investigate)
  return { type: 'unknown', code: 500, retry: false };
}

/**
 * Get error code from error message or return default
 * @param {Error|string} err - Error object or message
 * @returns {number} HTTP-style error code
 */
export function getErrorCode(err) {
  if (!err) return 500;
  
  const message = (err?.message || err?.toString() || '').toLowerCase();
  
  // Check for specific patterns
  if (message.includes('authentication') || message.includes('authorized') || message.includes('banned')) {
    return 401;
  }
  if (message.includes('rate limit')) {
    return 429;
  }
  if (message.includes('not found') || message.includes('missing')) {
    return 404;
  }
  if (message.includes('permission') || message.includes('blocked') || message.includes('forbidden')) {
    return 403;
  }
  if (message.includes('timeout') || message.includes('unavailable')) {
    return 503;
  }
  if (message.includes('invalid') || message.includes('bad request')) {
    return 400;
  }
  
  return 500;
}

/**
 * Create a structured error response for MCP tools
 * @param {string} toolName - Name of the tool that failed
 * @param {Error|string} error - Error object or message
 * @param {object} [context] - Additional context (e.g., recipient, file path)
 * @returns {{content: Array, isError: true, recoveryHint?: string}}
 */
export function createErrorResponse(toolName, error, context = {}) {
  const message = error?.message || error?.toString() || 'Unknown error';
  const classification = classifyError(error);

  const response = {
    content: [
      {
        type: 'text',
        text: formatErrorMessage(toolName, message, classification, context)
      }
    ],
    isError: true
  };

  // Add recovery hint based on error type
  const recoveryHint = getRecoveryHint(classification.type, toolName, context);
  if (recoveryHint) {
    response.recoveryHint = recoveryHint;
  }

  return response;
}

/**
 * Format error message for user consumption
 * @private
 */
function formatErrorMessage(toolName, message, classification, context) {
  const errorType = classification.type.replace('_', ' ');
  const errorCode = classification.code;

  let formatted = `**${toolName} failed** (${errorType}, code: ${errorCode})\n\n`;
  formatted += `Error: ${message}\n`;

  // Add context if available
  if (Object.keys(context).length > 0) {
    formatted += '\nContext:\n';
    for (const [key, value] of Object.entries(context)) {
      formatted += `- ${key}: ${value}\n`;
    }
  }

  return formatted;
}

/**
 * Get recovery hint based on error type
 * @private
 */
function getRecoveryHint(errorType, toolName, context) {
  const hints = {
    transient:
      'This appears to be a temporary issue. The operation may succeed if retried automatically.',
    permanent:
      'This error requires re-authentication. Call the authenticate tool to re-link your WhatsApp session.',
    client_error:
      'This error is caused by invalid input. Please check the parameters and try again.',
    unknown: 'This is an unexpected error. Check the container logs for more details.'
  };

  // Tool-specific hints
  const toolHints = {
    send_message: context.recipient
      ? `Verify that "${context.recipient}" is a valid contact name or phone number.`
      : 'Ensure the recipient exists and is reachable.',
    download_media:
      'Media may have expired on WhatsApp servers (30-day limit) or the message ID is invalid.',
    send_file: context.filePath
      ? `Verify that the file exists at "${context.filePath}" and is in an allowed directory.`
      : 'Ensure the file path is absolute and within allowed directories.',
    authenticate:
      'If pairing code fails, the server will automatically fall back to QR code authentication.',
    search_messages: 'Try different keywords or check spelling. Use quotes for exact phrases.'
  };

  return hints[errorType] + (toolHints[toolName] ? ' ' + toolHints[toolName] : '');
}

// Re-export from the canonical source so existing imports keep working.
export { ERROR_CODES } from '../constants.js';

export default { classifyError, createErrorResponse };
