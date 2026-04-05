/**
 * JID (WhatsApp ID) Utilities
 *
 * Utilities for handling WhatsApp JID formats:
 * - @lid format (Local ID): e.g., "44612043436101@lid"
 * - @s.whatsapp.net format (phone-based): e.g., "33680940027@s.whatsapp.net"
 *
 * These utilities help unify duplicate contacts that appear with different JID formats.
 */

import type { ContactMapping, MessageStore } from '../whatsapp/store.js';

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

// ── Multi-Device JID Utilities (Phase 4) ───────────────────────────────────

/**
 * Check if two JIDs belong to the same contact using the multi-device schema.
 * @param jid1 - First JID to compare
 * @param jid2 - Second JID to compare
 * @param store - MessageStore instance for contact lookup
 * @returns true if both JIDs belong to the same contact
 */
export async function areJidsFromSameContact (
  jid1: string,
  jid2: string,
  store: MessageStore
): Promise<boolean> {
  if (!store || !jid1 || !jid2) {return false;}
  
  // Same JID = same contact
  if (jid1 === jid2) {return true;}

  // Get contacts for both JIDs
  const contact1 = store.getContactByJid(jid1);
  const contact2 = store.getContactByJid(jid2);

  // If both contacts exist, compare IDs
  if (contact1 && contact2) {
    return contact1.id === contact2.id;
  }

  // Fallback to legacy contact_mappings
  const mappings = store.getAllContactMappings();
  const normalized1 = normalizeJid(jid1, mappings);
  const normalized2 = normalizeJid(jid2, mappings);

  return normalized1 === normalized2;
}

/**
 * Get all JIDs associated with a contact (all devices + phone JIDs).
 * @param jid - Any JID format to look up
 * @param store - MessageStore instance for contact lookup
 * @returns Array of all related JIDs, or empty array if contact not found
 */
export async function getAllRelatedJids (
  jid: string,
  store: MessageStore
): Promise<string[]> {
  if (!store || !jid) {return [];}

  // Try to find contact by JID
  const contact = store.getContactByJid(jid);
  
  if (contact) {
    const jids: string[] = [];
    
    // Add all device LIDs
    for (const device of contact.devices) {
      jids.push(device.lidJid);
    }
    
    // Add all phone JIDs
    for (const phoneJid of contact.phoneJids) {
      jids.push(phoneJid);
    }
    
    return jids;
  }

  // Fallback: return just the input JID
  return [jid];
}

/**
 * Find the best JID for sending a message to a contact.
 * Prefers: primary device > most recently active device > phone JID
 * @param phoneNumber - Phone number in E.164 format
 * @param store - MessageStore instance for contact lookup
 * @returns The best JID for sending, or null if contact not found
 */
export async function getBestJidForSending (
  phoneNumber: string,
  store: MessageStore
): Promise<string | null> {
  if (!store || !phoneNumber) {return null;}

  const contact = store.getOrCreateContactByPhone(phoneNumber);
  
  if (!contact || !contact.devices || contact.devices.length === 0) {
    // No devices found, try to get phone JID
    const phoneJids = contact?.phoneJids || [];
    return phoneJids.length > 0 ? phoneJids[0] : null;
  }

  // Find primary device
  const primaryDevice = contact.devices.find((d) => d.isPrimary);
  if (primaryDevice) {
    return primaryDevice.lidJid;
  }

  // Fall back to most recently active device
  const sortedDevices = [...contact.devices].sort(
    (a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)
  );

  return sortedDevices[0]?.lidJid || null;
}

/**
 * Detect device type from LID JID patterns and message metadata.
 * Currently returns 'unknown' - can be enhanced with ML/pattern matching.
 * @param lidJid - The LID JID to analyze
 * @param metadata - Optional message metadata for heuristics
 * @returns Detected device type
 */
export function detectDeviceType (
  lidJid: string,
  metadata?: { messageFrequency?: number; lastActiveHour?: number }
): 'phone' | 'desktop' | 'web' | 'unknown' {
  // Currently returns 'unknown' - future enhancement can add:
  // - Pattern matching on LID numeric sequences
  // - Activity pattern analysis (phone vs desktop hours)
  // - Message frequency analysis
  // - Presence notification parsing
  
  return 'unknown';
}

/**
 * Get the canonical (primary) JID for a contact.
 * Returns primary device LID, or first LID, or phone JID.
 * @param jid - Any JID format to look up
 * @param store - MessageStore instance for contact lookup
 * @returns The canonical JID for the contact, or the original JID if not found
 */
export async function getCanonicalJid (
  jid: string,
  store: MessageStore
): Promise<string> {
  if (!store || !jid) {return jid;}

  const contact = store.getContactByJid(jid);
  
  if (!contact) {return jid;}

  // Prefer primary device
  const primaryDevice = contact.devices.find((d) => d.isPrimary);
  if (primaryDevice) {
    return primaryDevice.lidJid;
  }

  // Fall back to first device
  if (contact.devices.length > 0) {
    return contact.devices[0].lidJid;
  }

  // Fall back to first phone JID
  if (contact.phoneJids.length > 0) {
    return contact.phoneJids[0];
  }

  return jid;
}
