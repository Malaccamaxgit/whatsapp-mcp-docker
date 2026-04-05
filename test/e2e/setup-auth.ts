/**
 * E2E Test Setup — One-time WhatsApp Authentication
 *
 * Run this once to authenticate and persist the session to .test-data/.
 * The session survives code changes and container rebuilds.
 *
 * Usage:
 *   npm run test:auth -- --interactive
 *
 * Then enter your phone number when prompted. The 8-digit pairing code
 * will be printed — enter it in WhatsApp > Settings > Linked Devices.
 *
 * Non-interactive usage:
 *   docker compose --profile test run --rm -e E2E_PHONE_NUMBER=+15551234567 tester-container npx tsx test/e2e/setup-auth.ts
 *
 * Session expires after ~20 days of inactivity. Re-run this script then.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const TEST_DATA_DIR = resolve(process.cwd(), '.test-data');
const STORE_PATH = TEST_DATA_DIR;
const PHONE_ENV_VAR = 'E2E_PHONE_NUMBER';
const INTERACTIVE_ENV_VAR = 'E2E_SETUP_INTERACTIVE';

if (!existsSync(TEST_DATA_DIR)) {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  console.log(`Created ${TEST_DATA_DIR}`);
}

process.env.STORE_PATH = STORE_PATH;
process.env.AUDIT_DB_PATH = resolve(TEST_DATA_DIR, 'audit.db');

const { WhatsAppClient } = await import('../../src/whatsapp/client.js');
const { MessageStore } = await import('../../src/whatsapp/store.js');
const { initEncryption } = await import('../../src/security/crypto.js');
const { validatePhoneNumber } = await import('../../src/utils/phone.js');

initEncryption(null);

const store = new MessageStore(resolve(TEST_DATA_DIR, 'messages.db'));

const waClient = new WhatsAppClient({
  storePath: STORE_PATH,
  messageStore: store,
  onConnected: () => {
    console.log('\n✓ Connected successfully! Session saved to .test-data/');
    console.log('  You can now run: npm run test:e2e');
    store.close();
    process.exit(0);
  }
});

console.log('WhatsApp MCP — Test Authentication Setup');
console.log('========================================');
console.log(`Session will be stored in: ${TEST_DATA_DIR}`);
console.log('');

const interactiveRequested = process.argv.includes('--interactive')
  || String(process.env[INTERACTIVE_ENV_VAR] || '').toLowerCase() === 'true';
const interactiveTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const canPrompt = interactiveRequested && interactiveTty;
const rl = canPrompt ? createInterface({ input: process.stdin, output: process.stdout }) : null;

function ask (question: string): Promise<string> {
  if (!rl) {
    throw new Error(
      'Interactive prompt unavailable. Set E2E_PHONE_NUMBER or run setup-auth in an interactive terminal.'
    );
  }
  return new Promise((resolve) => rl.question(question, resolve));
}

function printNonInteractiveInstructions (): void {
  console.error('✗ Authentication setup needs input but no interactive TTY is available.');
  console.error('');
  console.error(`Either:`);
  console.error(`  1) Run in an interactive terminal and pass --interactive`);
  console.error(`  2) Provide phone number via env var ${PHONE_ENV_VAR}:`);
  console.error(
    `     docker compose --profile test run --rm -e ${PHONE_ENV_VAR}=+15145551234 tester-container npx tsx test/e2e/setup-auth.ts`
  );
  console.error(`  3) Optional env flag equivalent to --interactive: ${INTERACTIVE_ENV_VAR}=true`);
  console.error('');
  console.error('After authentication, run:');
  console.error('  docker compose --profile test run --rm tester-container npx tsx --test test/e2e/live.test.ts');
}

try {
  await waClient.initialize();

  if (waClient.isConnected()) {
    console.log('✓ Already authenticated as', waClient.jid);
    console.log('  Session is still valid. Run: npm run test:e2e');
    store.close();
    process.exit(0);
  }

  const envPhone = (process.env[PHONE_ENV_VAR] || '').trim();
  if (!canPrompt && !envPhone) {
    console.error('No phone number provided for auth setup.');
    printNonInteractiveInstructions();
    store.close();
    process.exit(1);
  }

  const phone = envPhone || await ask('Enter your phone number (E.164 format, e.g. +15145551234): ');
  const validation = validatePhoneNumber(phone);

  if (!validation.valid) {
    console.error('✗ Invalid phone number:', validation.error);
    store.close();
    process.exit(1);
  }

  console.log(`\nRequesting pairing code for +${validation.number}...`);
  const result = await waClient.requestPairingCode(validation.number);

  if (result.alreadyConnected) {
    console.log('✓ Already connected as', result.jid);
    store.close();
    process.exit(0);
  }

  if ('code' in result && result.code) {
    console.log('\n╔════════════════════════════════════════╗');
    console.log(`║  Pairing Code:  ${result.code}              ║`);
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log('Enter this code in WhatsApp:');
    console.log('  Settings > Linked Devices > Link a Device > Link with phone number');
    console.log('');
    console.log('Waiting for connection (timeout: 2 minutes)...');

    await result.waitForConnection;
  } else if ('qrCode' in result && result.qrCode) {
    console.log('');
    console.log('Pairing code unavailable. Switched to QR code mode.');
    console.log('Scan the QR with WhatsApp > Linked Devices > Link a Device.');
    if (result.qrImageBase64) {
      const filePath = await waClient.saveQrCodeToFile(result.qrImageBase64);
      console.log(`QR image saved to: ${filePath}`);
      console.log('If your terminal cannot render QR art, open the PNG file instead.');
    }
    console.log('Waiting for connection (timeout: 2 minutes)...');
    await waClient.waitForReady(120000);
  } else {
    throw new Error('Authentication returned an unexpected response shape');
  }
} catch (error) {
  console.error('✗ Authentication failed:', error instanceof Error ? error.message : String(error));
  store.close();
  process.exit(1);
} finally {
  rl?.close();
}
