/**
 * Error Handling Wrapper for MCP Tools
 *
 * Provides consistent error handling across all tool implementations.
 * Automatically catches errors and formats them using createErrorResponse.
 *
 * Usage:
 *   import { withErrorHandling } from './utils/errors.js';
 *
 *   server.tool('send_message', 'Description', schema,
 *     withErrorHandling('send_message', async ({ to, message }) => {
 *       // Your tool logic here
 *       return { content: [{ type: 'text', text: 'Success!' }] };
 *     })
 *   );
 */

import { createErrorResponse, classifyError } from './errors.js';
import { debug } from './debug.js';

const log = debug('error-handler');

/**
 * Wrap a tool handler with automatic error handling.
 * @param {string} toolName - Name of the tool for error reporting
 * @param {Function} handler - Async tool handler function
 * @param {Object} [options] - Optional configuration
 * @param {boolean} [options.logDetails=true] - Whether to log error details
 * @param {Object} [options.context] - Static context to include in errors
 * @returns {Function} Wrapped handler function
 */
export function withErrorHandling(toolName, handler, options = {}) {
  const { logDetails = true, context = {} } = options;

  return async (params) => {
    try {
      return await handler(params);
    } catch (error) {
      log('Tool %s failed: %s', toolName, error.message);

      // Merge static context with dynamic params for better debugging
      const errorContext = {
        ...context,
        ...params
      };

      // Remove sensitive fields from context
      if (errorContext.message && errorContext.message.length > 100) {
        errorContext.message = errorContext.message.substring(0, 100) + '...';
      }

      const response = createErrorResponse(toolName, error, errorContext);

      if (logDetails) {
        const classification = classifyError(error);
        log(
          'Error type: %s, code: %d, retry: %s',
          classification.type,
          classification.code,
          classification.retry
        );
      }

      return response;
    }
  };
}

/**
 * Create a rate limit check wrapper.
 * @param {Object} permissions - PermissionManager instance
 * @param {string} rateLimitType - Type of rate limit ('message', 'download', 'auth')
 * @returns {Function} Wrapper that checks rate limits before calling handler
 */
export function withRateLimit(permissions, rateLimitType) {
  const checkFn = {
    message: () => permissions.checkRateLimit(),
    download: () => permissions.checkDownloadRateLimit(),
    auth: () => permissions.checkAuthRateLimit()
  }[rateLimitType];

  if (!checkFn) {
    throw new Error(`Unknown rate limit type: ${rateLimitType}`);
  }

  return (handler) => {
    return async (params) => {
      const rateCheck = checkFn();
      if (!rateCheck.allowed) {
        return {
          content: [{ type: 'text', text: rateCheck.error }],
          isError: true
        };
      }
      return handler(params);
    };
  };
}

/**
 * Create a connection check wrapper.
 * @param {Object} waClient - WhatsAppClient instance
 * @param {string} [customError] - Custom error message if not connected
 * @returns {Function} Wrapper that checks connection before calling handler
 */
export function withConnectionCheck(waClient, customError) {
  return (handler) => {
    return async (params) => {
      if (!waClient.isConnected()) {
        return {
          content: [
            {
              type: 'text',
              text: customError || 'WhatsApp not connected. Use the authenticate tool first.'
            }
          ],
          isError: true
        };
      }
      return handler(params);
    };
  };
}

/**
 * Create a tool enablement check wrapper.
 * @param {Object} permissions - PermissionManager instance
 * @param {string} toolName - Name of the tool to check
 * @returns {Function} Wrapper that checks if tool is enabled
 */
export function withToolCheck(permissions, toolName) {
  return (handler) => {
    return async (params) => {
      const toolCheck = permissions.isToolEnabled(toolName);
      if (!toolCheck.allowed) {
        return {
          content: [{ type: 'text', text: toolCheck.error }],
          isError: true
        };
      }
      return handler(params);
    };
  };
}

/**
 * Compose multiple wrappers into a single enhanced handler.
 * @param {Function} handler - Base handler function
 * @param  {...Function} wrappers - Wrapper functions to apply (in order)
 * @returns {Function} Enhanced handler
 *
 * Example:
 *   composeWrappers(
 *     async ({ to, message }) => { /* handler logic *\/ },
 *     withToolCheck(permissions, 'send_message'),
 *     withConnectionCheck(waClient),
 *     withRateLimit(permissions, 'message'),
 *     withErrorHandling('send_message')
 *   )
 */
export function composeWrappers(handler, ...wrappers) {
  return wrappers.reduce((wrapped, wrapper) => wrapper(wrapped), handler);
}

export default withErrorHandling;
