/**
 * E.164 Phone Number Validation and Normalization
 */

const E164_MIN_DIGITS = 7;
const E164_MAX_DIGITS = 15;

/**
 * Strip all non-digit characters from a phone number string.
 * @param input - The phone number string to clean
 * @returns The phone number with only digits
 */
export function stripNonDigits(input: string): string {
  return input.replace(/[^0-9]/g, '');
}

interface ValidationResult {
  valid: boolean;
  number: string | null;
  error: string | null;
}

/**
 * Validate and normalize a phone number to E.164 format (digits only, no +).
 * Catches common format mistakes with specific guidance.
 * Returns { valid, number, error }.
 * @param input - The phone number to validate
 * @returns A validation result object
 */
export function validatePhoneNumber(input: string): ValidationResult {
  if (!input || typeof input !== 'string') {
    return { valid: false, number: null, error: 'Phone number is required' };
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { valid: false, number: null, error: 'Phone number is empty' };
  }

  const digits = stripNonDigits(trimmed);

  if (digits.length === 0) {
    return { valid: false, number: null, error: 'Phone number contains no digits' };
  }

  if (digits.startsWith('00')) {
    const withoutPrefix = digits.slice(2);
    return {
      valid: false,
      number: null,
      error: `Use "+" instead of "00" prefix. Try: +${withoutPrefix}`,
    };
  }

  if (!trimmed.startsWith('+') && digits.startsWith('0')) {
    return {
      valid: false,
      number: null,
      error:
        `Looks like a local number (starts with 0). ` +
        `You must include the country code. ` +
        `Remove the leading 0 and add "+" plus your country code. ` +
        `Example: 0612345678 → +33612345678 (France) or +353..., +1..., etc.`,
    };
  }

  if (digits.length < E164_MIN_DIGITS) {
    return {
      valid: false,
      number: null,
      error:
        `Phone number too short (${digits.length} digits, minimum ${E164_MIN_DIGITS}). ` +
        `Include country code, e.g. +15145551234`,
    };
  }

  if (digits.length > E164_MAX_DIGITS) {
    return {
      valid: false,
      number: null,
      error:
        `Phone number too long (${digits.length} digits, maximum ${E164_MAX_DIGITS}). ` +
        `Check for duplicated digits or extra characters.`,
    };
  }

  return { valid: true, number: digits, error: null };
}

/**
 * Convert a phone number to a WhatsApp JID (user@s.whatsapp.net).
 * If the input is already a JID, returns it unchanged.
 * @param input - The phone number or JID to convert
 * @returns The WhatsApp JID or null if input is invalid
 */
export function toJid(input: string): string | null {
  if (!input) return null;

  if (input.includes('@')) return input;

  const { valid, number, error } = validatePhoneNumber(input);
  if (!valid) throw new Error(error ?? undefined);

  return `${number}@s.whatsapp.net`;
}

/**
 * Check if a string looks like a WhatsApp JID.
 * @param input - The string to check
 * @returns true if the string ends with @s.whatsapp.net or @g.us
 */
export function isJid(input: string): boolean {
  return (
    typeof input === 'string' && (input.endsWith('@s.whatsapp.net') || input.endsWith('@g.us'))
  );
}

/**
 * Check if a JID is a group JID.
 * @param jid - The JID to check
 * @returns true if the JID ends with @g.us
 */
export function isGroupJid(jid: string): boolean {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}
