/**
 * Shared Zod schemas used across MCP tool definitions.
 *
 * PhoneSchema validates at the Zod layer (before handlers run) so bad phone
 * numbers produce a descriptive MCP validation error immediately, rather than
 * propagating into handler logic where they would throw from toJid().
 */

import { z } from 'zod';
import { validatePhoneNumber } from './phone.js';

/**
 * Accepts either a WhatsApp JID (contains '@') or a phone number in E.164
 * format. When a phone number is provided, validatePhoneNumber() is used for
 * the refinement so the error message is identical to what the handler would
 * produce — just surfaced one step earlier.
 */
export const PhoneSchema = z
  .string()
  .max(200)
  .refine(
    (v) => v.includes('@') || validatePhoneNumber(v).valid,
    (v) => ({ message: validatePhoneNumber(v).error ?? 'Invalid phone number' })
  )
  .describe('Phone number in E.164 format (e.g. "+14155552671") or WhatsApp JID');

/**
 * Array of phone numbers / JIDs. Bounds intentionally loose so callers can
 * tighten per-tool (e.g. .max(20) for get_user_info vs .max(256) for participants).
 */
export const PhoneArraySchema = (min = 1, max = 256) =>
  z
    .array(PhoneSchema)
    .min(min)
    .max(max);
