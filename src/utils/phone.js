/**
 * E.164 Phone Number Validation and Normalization
 */

const E164_MIN_DIGITS = 7;
const E164_MAX_DIGITS = 15;

/**
 * Strip all non-digit characters from a phone number string.
 */
export function stripNonDigits(input) {
  return input.replace(/[^0-9]/g, '');
}

/**
 * Validate and normalize a phone number to E.164 format (digits only, no +).
 * Catches common format mistakes with specific guidance.
 * Returns { valid, number, error }.
 */
export function validatePhoneNumber(input) {
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
      error: `Use "+" instead of "00" prefix. Try: +${withoutPrefix}`
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
        `Example: 0612345678 → +33612345678 (France) or +353..., +1..., etc.`
    };
  }

  if (digits.length < E164_MIN_DIGITS) {
    return {
      valid: false,
      number: null,
      error:
        `Phone number too short (${digits.length} digits, minimum ${E164_MIN_DIGITS}). ` +
        `Include country code, e.g. +15145551234`
    };
  }

  if (digits.length > E164_MAX_DIGITS) {
    return {
      valid: false,
      number: null,
      error:
        `Phone number too long (${digits.length} digits, maximum ${E164_MAX_DIGITS}). ` +
        `Check for duplicated digits or extra characters.`
    };
  }

  return { valid: true, number: digits, error: null };
}

/**
 * Convert a phone number to a WhatsApp JID (user@s.whatsapp.net).
 * If the input is already a JID, returns it unchanged.
 */
export function toJid(input) {
  if (!input) return null;

  if (input.includes('@')) return input;

  const { valid, number, error } = validatePhoneNumber(input);
  if (!valid) throw new Error(error);

  return `${number}@s.whatsapp.net`;
}

/**
 * Check if a string looks like a WhatsApp JID.
 */
export function isJid(input) {
  return (
    typeof input === 'string' && (input.endsWith('@s.whatsapp.net') || input.endsWith('@g.us'))
  );
}

/**
 * Check if a JID is a group JID.
 */
export function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}
