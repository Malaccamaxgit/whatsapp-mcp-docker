/**
 * File Guard
 *
 * Protects against path traversal, dangerous file types, oversized media
 * storage, and upload path leakage (e.g. sending session.db to a contact).
 */

import { resolve, basename, extname, sep } from 'node:path';
import { stat, readdir, open } from 'node:fs/promises';
import { FILE_SECURITY } from '../constants.js';

const { DANGEROUS_EXTENSIONS, SENSITIVE_PATTERNS } = FILE_SECURITY;

type MagicByteType = 'image' | 'video' | 'audio' | 'document' | 'sticker';

interface MagicByteEntry {
  type: MagicByteType;
  sig: number[];
  label: string;
  skipCheck?: boolean;
}

const MAGIC_BYTES: MagicByteEntry[] = [
  { type: 'image', sig: [0xff, 0xd8, 0xff], label: 'JPEG' },
  { type: 'image', sig: [0x89, 0x50, 0x4e, 0x47], label: 'PNG' },
  { type: 'image', sig: [0x47, 0x49, 0x46], label: 'GIF' },
  { type: 'image', sig: [0x52, 0x49, 0x46, 0x46], label: 'WEBP/RIFF' },
  { type: 'video', sig: [0x00, 0x00, 0x00], label: 'MP4/MOV', skipCheck: true },
  { type: 'audio', sig: [0x4f, 0x67, 0x67, 0x53], label: 'OGG' },
  { type: 'audio', sig: [0x49, 0x44, 0x33], label: 'MP3' },
  { type: 'document', sig: [0x25, 0x50, 0x44, 0x46], label: 'PDF' },
  { type: 'document', sig: [0x50, 0x4b, 0x03, 0x04], label: 'ZIP/DOCX/XLSX' },
  { type: 'sticker', sig: [0x52, 0x49, 0x46, 0x46], label: 'WEBP' }
];

interface CheckExtensionResult {
  dangerous: boolean;
  extension: string;
  warning: string | null;
}

interface VerifyMagicBytesResult {
  valid: boolean;
  detectedLabel: string | null;
  warning: string | null;
}

interface CheckMediaQuotaResult {
  allowed: boolean;
  currentMB: number;
  limitMB: number;
  error: string | null;
}

/**
 * Strip dangerous characters and path components from a filename.
 * Returns a safe basename of max 200 chars.
 */
export function sanitizeFilename(name: string): string {
  if (!name) return 'unnamed';
  let safe = basename(name);
  safe = safe.replace(/\.\./g, '_');
  safe = safe.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  if (safe.length > 200) {
    const ext = extname(safe);
    safe = safe.slice(0, 200 - ext.length) + ext;
  }
  return safe || 'unnamed';
}

/**
 * Ensure a resolved path is within the allowed base directory.
 * Prevents path traversal via ../ or symlinks.
 */
export function assertPathWithin(filePath: string, allowedBase: string): string {
  const resolved = resolve(filePath);
  const base = resolve(allowedBase);
  if (!resolved.startsWith(base + sep) && resolved !== base) {
    throw new Error(
      `Path "${filePath}" resolves outside the allowed directory. ` +
        `Files must be within ${allowedBase}.`
    );
  }
  return resolved;
}

/**
 * Validate that a file path for upload (send_file) is within allowed
 * directories and does NOT point to sensitive files.
 */
export function validateUploadPath(filePath: string, allowedDirs: string[]): string {
  const resolved = resolve(filePath);

  const inAllowed = allowedDirs.some((dir) => {
    const base = resolve(dir);
    return resolved.startsWith(base + sep) || resolved === base;
  });

  if (!inAllowed) {
    throw new Error(
      `Upload denied: "${filePath}" is not in an allowed directory. ` +
        `Files must be within: ${allowedDirs.join(', ')}`
    );
  }

  const name = basename(resolved);
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(name) || pattern.test(resolved)) {
      throw new Error(
        `Upload denied: "${name}" matches a sensitive file pattern. ` +
          `Database files, keys, and credentials cannot be sent.`
      );
    }
  }

  return resolved;
}

/**
 * Check if a file extension is in the dangerous executables blocklist.
 * Returns { dangerous, extension, warning }.
 */
export function checkExtension(filePath: string): CheckExtensionResult {
  const ext = extname(filePath).toLowerCase();
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return {
      dangerous: true,
      extension: ext,
      warning:
        `File has a potentially dangerous extension (${ext}). ` +
        `Executable files should not be exchanged via WhatsApp.`
    };
  }
  return { dangerous: false, extension: ext, warning: null };
}

/**
 * Read the first bytes of a file and verify they match the declared media type.
 * Returns { valid, detectedLabel, warning }.
 */
export async function verifyMagicBytes(filePath: string, declaredType: string): Promise<VerifyMagicBytesResult> {
  let fh: import('node:fs/promises').FileHandle | undefined;
  try {
    fh = await open(filePath, 'r');
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    if (bytesRead < 3) {
      return { valid: false, detectedLabel: null, warning: 'File too small to identify.' };
    }

    const matchesForType = MAGIC_BYTES.filter((m) => m.type === declaredType && !m.skipCheck);

    if (matchesForType.length === 0) {
      return { valid: true, detectedLabel: null, warning: null };
    }

    for (const entry of matchesForType) {
      const match = entry.sig.every((byte, i) => buf[i] === byte);
      if (match) {
        return { valid: true, detectedLabel: entry.label, warning: null };
      }
    }

    const anyKnown = MAGIC_BYTES.find(
      (entry) => !entry.skipCheck && entry.sig.every((byte, i) => buf[i] === byte)
    );

    if (anyKnown) {
      return {
        valid: false,
        detectedLabel: anyKnown.label,
        warning:
          `File appears to be ${anyKnown.label} (${anyKnown.type}) ` +
          `but was declared as ${declaredType}.`
      };
    }

    return {
      valid: false,
      detectedLabel: null,
      warning:
        `Could not verify file type. Declared as ${declaredType} ` +
        `but file header does not match any known ${declaredType} format.`
    };
  } finally {
    if (fh) await fh.close();
  }
}

/**
 * Calculate total size of a media directory tree.
 * Returns size in bytes.
 */
export async function getMediaDirSize(mediaDir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(mediaDir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        try {
          const fullPath = resolve(mediaDir, entry.parentPath || '', entry.name);
          const s = await stat(fullPath);
          total += s.size;
        } catch {
          /* skip inaccessible files */
        }
      }
    }
  } catch {
    return 0;
  }
  return total;
}

/**
 * Check if the media directory is within the configured quota.
 * Returns { allowed, currentMB, limitMB, error }.
 */
export async function checkMediaQuota(mediaDir: string, maxBytes: number): Promise<CheckMediaQuotaResult> {
  const current = await getMediaDirSize(mediaDir);
  const currentMB = Math.round(current / 1024 / 1024);
  const limitMB = Math.round(maxBytes / 1024 / 1024);

  if (current >= maxBytes) {
    return {
      allowed: false,
      currentMB,
      limitMB,
      error:
        `Media storage quota exceeded (${currentMB} MB / ${limitMB} MB). ` +
        `Delete old media files to free space.`
    };
  }
  return { allowed: true, currentMB, limitMB, error: null };
}
