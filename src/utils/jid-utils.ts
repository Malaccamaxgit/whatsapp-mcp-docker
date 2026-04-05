/**
 * JID (WhatsApp ID) Utilities
 *
 * Utilities for handling WhatsApp JID formats:
 * - @lid format (Local ID): e.g., "44612043436101@lid"
 * - @s.whatsapp.net format (phone-based): e.g., "33680940027@s.whatsapp.net"
 *
 * These utilities help unify duplicate contacts that appear with different JID formats.
 */

import type { ContactMapping } from '../whatsapp/store.js';

/**
 * Extract phone number from a JID.
 * @param jid - The JID to extract from (e.g., "33680940027@s.whatsapp.net" or "44612043436101@lid")
 * @returns The numeric part of the JID, or null if invalid
 */
export function extractPhoneNumber (jid: string): string | null {
  if (!jid || typeof jid !== 'string') {return null;}
  
  const match = jid.match(/^([0-9]+)@/);
  return match ? match[1] : null;
}

/**
 * Check if a JID is in LID (Local ID) format.
 * @param jid - The JID to check
 * @returns true if the JID ends with @lid
 */
export function isLidJid (jid: string): boolean {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

/**
 * Check if a JID is in phone-based format.
 * @param jid - The JID to check
 * @returns true if the JID ends with @s.whatsapp.net
 */
export function isPhoneJid (jid: string): boolean {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
}

/**
 * Check if a JID is a group JID.
 * @param jid - The JID to check
 * @returns true if the JID ends with @g.us
 */
export function isGroupJid (jid: string): boolean {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

/**
 * Normalize a JID to the preferred format using contact mappings.
 * Prefers @lid format for contacts with names, falls back to @s.whatsapp.net.
 * 
 * @param jid - The JID to normalize
 * @param mappings - Array of contact mappings to use for resolution
 * @returns The preferred/normalized JID
 */
export function normalizeJid (jid: string, mappings: ContactMapping[]): string {
  if (!jid || !mappings?.length) {return jid;}

  // Find mapping for this JID
  const mapping = mappings.find(
    (m) => m.lid_jid === jid || m.phone_jid === jid
  );

  if (!mapping) {return jid;}

  // Prefer LID format for contacts with names
  if (mapping.lid_jid) {return mapping.lid_jid;}
  if (mapping.phone_jid) {return mapping.phone_jid;}

  return jid;
}

/**
 * Resolve a recipient string to the correct JID using contact mappings.
 * Handles phone numbers, names, and either JID format.
 * 
 * @param recipient - The recipient string (phone number, name, or JID)
 * @param mappings - Array of contact mappings
 * @returns The resolved JID, or the original input if no mapping found
 */
export function resolveJid (recipient: string, mappings: ContactMapping[]): string {
  if (!recipient || !mappings?.length) {return recipient;}

  // If already a JID, normalize it
  if (recipient.includes('@')) {
    return normalizeJid(recipient, mappings);
  }

  // If it's a phone number (with or without +), look for mapping
  const digits = recipient.replace(/[^0-9]/g, '');
  const mapping = mappings.find(
    (m) => m.phone_number?.replace(/[^0-9]/g, '') === digits
  );

  if (mapping) {
    // Prefer LID, then phone JID
    return mapping.lid_jid || mapping.phone_jid || recipient;
  }

  // No mapping found, convert to phone JID format
  return `${digits}@s.whatsapp.net`;
}

/**
 * Find the unified chat JID by checking both LID and phone JID formats.
 * This helps merge duplicate chat entries.
 * 
 * @param jid - The JID to find unified version for
 * @param mappings - Array of contact mappings
 * @returns Object with unified JID and related JIDs
 */
export function getUnifiedChatJid (
  jid: string,
  mappings: ContactMapping[]
): { unifiedJid: string; lidJid?: string; phoneJid?: string } {
  if (!jid) {return { unifiedJid: jid };}

  const mapping = mappings.find(
    (m) => m.lid_jid === jid || m.phone_jid === jid
  );

  if (!mapping) {
    return { unifiedJid: jid };
  }

  // Prefer LID for unified view
  const unifiedJid = mapping.lid_jid || mapping.phone_jid || jid;
  
  return {
    unifiedJid,
    lidJid: mapping.lid_jid || undefined,
    phoneJid: mapping.phone_jid || undefined
  };
}

/**
 * Build a lookup map from contact mappings for efficient access.
 * @param mappings - Array of contact mappings
 * @returns Map with JID as key and mapping as value
 */
export function buildMappingLookup (mappings: ContactMapping[]): Map<string, ContactMapping> {
  const lookup = new Map<string, ContactMapping>();
  
  if (!mappings) {return lookup;}

  for (const mapping of mappings) {
    if (mapping.lid_jid) {lookup.set(mapping.lid_jid, mapping);}
    if (mapping.phone_jid) {lookup.set(mapping.phone_jid, mapping);}
    if (mapping.phone_number) {lookup.set(mapping.phone_number, mapping);}
  }

  return lookup;
}
