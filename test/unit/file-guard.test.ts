import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import {
  sanitizeFilename,
  assertPathWithin,
  validateUploadPath,
  checkExtension,
  verifyMagicBytes,
  checkMediaQuota
} from '../../src/security/file-guard.js';

describe('sanitizeFilename', () => {
  it('returns "unnamed" for empty/null input', () => {
    assert.equal(sanitizeFilename(null as unknown as string), 'unnamed');
    assert.equal(sanitizeFilename(''), 'unnamed');
  });

  it('strips path traversal', () => {
    assert.ok(!sanitizeFilename('../../etc/passwd').includes('..'));
  });

  it('strips control characters', () => {
    assert.ok(!sanitizeFilename('file\x00name.txt').includes('\x00'));
  });

  it('strips path separators', () => {
    const result = sanitizeFilename('/some/path/file.txt');
    assert.equal(result, 'file.txt');
  });

  it('truncates to 200 chars preserving extension', () => {
    const long = 'a'.repeat(250) + '.jpg';
    const result = sanitizeFilename(long);
    assert.ok(result.length <= 200);
    assert.ok(result.endsWith('.jpg'));
  });
});

describe('assertPathWithin', () => {
  let tempDir: string;
  let subDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pathtest-'));
    subDir = join(tempDir, 'media');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, 'img.jpg'), 'fake');
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('allows paths within the base', () => {
    const filePath = join(subDir, 'img.jpg');
    const result = assertPathWithin(filePath, subDir);
    assert.ok(result.startsWith(resolve(subDir)));
  });

  it('allows the base path itself', () => {
    assert.doesNotThrow(() => assertPathWithin(subDir, subDir));
  });

  it('rejects paths outside the base', () => {
    const outsidePath = join(tmpdir(), 'outside.txt');
    assert.throws(() => assertPathWithin(outsidePath, subDir), /outside the allowed directory/);
  });

  it('rejects path traversal', () => {
    const traversal = join(subDir, '..', '..', 'etc', 'passwd');
    assert.throws(() => assertPathWithin(traversal, subDir), /outside the allowed directory/);
  });
});

describe('validateUploadPath', () => {
  let tempDir: string;
  let allowedDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'upload-'));
    allowedDir = join(tempDir, 'allowed');
    await mkdir(allowedDir, { recursive: true });
    await writeFile(join(allowedDir, 'photo.jpg'), 'fake');
    await writeFile(join(allowedDir, 'session.db'), 'fake');
    await writeFile(join(allowedDir, 'private.key'), 'fake');
    await writeFile(join(allowedDir, '.env'), 'fake');
    await writeFile(join(allowedDir, 'messages.db'), 'fake');
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('allows files in permitted directories', () => {
    const filePath = join(allowedDir, 'photo.jpg');
    const result = validateUploadPath(filePath, [allowedDir]);
    assert.ok(result.endsWith('photo.jpg'));
  });

  it('rejects files outside permitted directories', () => {
    const outsidePath = join(tmpdir(), 'rogue.txt');
    assert.throws(
      () => validateUploadPath(outsidePath, [allowedDir]),
      /not in an allowed directory/
    );
  });

  it('rejects session.db', () => {
    assert.throws(
      () => validateUploadPath(join(allowedDir, 'session.db'), [allowedDir]),
      /sensitive file/i
    );
  });

  it('rejects messages.db', () => {
    assert.throws(
      () => validateUploadPath(join(allowedDir, 'messages.db'), [allowedDir]),
      /sensitive file/i
    );
  });

  it('rejects .key files', () => {
    assert.throws(
      () => validateUploadPath(join(allowedDir, 'private.key'), [allowedDir]),
      /sensitive file/i
    );
  });

  it('rejects .env files', () => {
    assert.throws(
      () => validateUploadPath(join(allowedDir, '.env'), [allowedDir]),
      /sensitive file/i
    );
  });
});

describe('checkExtension', () => {
  it('flags .exe as dangerous', () => {
    const r = checkExtension('virus.exe');
    assert.equal(r.dangerous, true);
    assert.equal(r.extension, '.exe');
    assert.ok(r.warning);
  });

  it('flags .ps1 as dangerous', () => {
    assert.equal(checkExtension('script.ps1').dangerous, true);
  });

  it('flags .bat as dangerous', () => {
    assert.equal(checkExtension('run.bat').dangerous, true);
  });

  it('allows .jpg', () => {
    const r = checkExtension('photo.jpg');
    assert.equal(r.dangerous, false);
    assert.equal(r.extension, '.jpg');
    assert.equal(r.warning, null);
  });

  it('allows .pdf', () => {
    assert.equal(checkExtension('document.pdf').dangerous, false);
  });

  it('allows .mp4', () => {
    assert.equal(checkExtension('video.mp4').dangerous, false);
  });

  it('is case-insensitive', () => {
    assert.equal(checkExtension('virus.EXE').dangerous, true);
  });
});

describe('verifyMagicBytes', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fileguard-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('validates a real JPEG header', async () => {
    const jpegPath = join(tempDir, 'test.jpg');
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(100)]);
    await writeFile(jpegPath, jpegHeader);

    const r = await verifyMagicBytes(jpegPath, 'image');
    assert.equal(r.valid, true);
    assert.equal(r.detectedLabel, 'JPEG');
  });

  it('validates a real PNG header', async () => {
    const pngPath = join(tempDir, 'test.png');
    const pngHeader = Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...Buffer.alloc(100)
    ]);
    await writeFile(pngPath, pngHeader);

    const r = await verifyMagicBytes(pngPath, 'image');
    assert.equal(r.valid, true);
    assert.equal(r.detectedLabel, 'PNG');
  });

  it('detects type mismatch (JPEG header, declared as document)', async () => {
    const jpegPath = join(tempDir, 'fake-doc.pdf');
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(100)]);
    await writeFile(jpegPath, jpegHeader);

    const r = await verifyMagicBytes(jpegPath, 'document');
    assert.equal(r.valid, false);
    assert.ok(r.warning);
    assert.match(r.warning, /JPEG/);
  });

  it('returns invalid for too-small files', async () => {
    const tinyPath = join(tempDir, 'tiny.bin');
    await writeFile(tinyPath, Buffer.from([0x00, 0x01]));

    const r = await verifyMagicBytes(tinyPath, 'image');
    assert.equal(r.valid, false);
    assert.match(r.warning, /too small/i);
  });

  it('passes unknown types through (no signatures defined)', async () => {
    const path = join(tempDir, 'random.bin');
    await writeFile(path, Buffer.alloc(100));

    const r = await verifyMagicBytes(path, 'unknown_type');
    assert.equal(r.valid, true);
  });
});

describe('checkMediaQuota', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'quota-'));
    await writeFile(join(tempDir, 'file1.jpg'), Buffer.alloc(1024));
    await writeFile(join(tempDir, 'file2.jpg'), Buffer.alloc(2048));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('allows when under quota', async () => {
    const r = await checkMediaQuota(tempDir, 1024 * 1024);
    assert.equal(r.allowed, true);
    assert.equal(r.error, null);
  });

  it('rejects when over quota', async () => {
    const r = await checkMediaQuota(tempDir, 100);
    assert.equal(r.allowed, false);
    assert.ok(r.error);
    assert.match(r.error, /quota exceeded/i);
  });

  it('handles non-existent directory', async () => {
    const r = await checkMediaQuota(join(tempDir, 'nonexistent'), 1024 * 1024);
    assert.equal(r.allowed, true);
  });
});
