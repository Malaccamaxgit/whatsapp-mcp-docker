/**
 * E2E Test Setup — One-time WhatsApp Authentication
 *
 * Run this once to authenticate and persist the session to .test-data/.
 * The session survives code changes and container rebuilds.
 *
 * Usage:
 *   npm run test:auth
 *
 * Then enter your phone number when prompted. The 8-digit pairing code
 * will be printed — enter it in WhatsApp > Settings > Linked Devices.
 *
 * Session expires after ~20 days of inactivity. Re-run this script then.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const TEST_DATA_DIR = resolve(process.cwd(), '.test-data');
const STORE_PATH = TEST_DATA_DIR;

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

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

try {
  await waClient.initialize();

  if (waClient.isConnected()) {
    console.log('✓ Already authenticated as', waClient.jid);
    console.log('  Session is still valid. Run: npm run test:e2e');
    store.close();
    process.exit(0);
  }

  const phone = await ask('Enter your phone number (E.164 format, e.g. +15145551234): ');
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

  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  Pairing Code:  ${result.code}              ║`);
  console.log(`╚════════════════════════════════════════╝`);
  console.log('');
  console.log('Enter this code in WhatsApp:');
  console.log('  Settings > Linked Devices > Link a Device > Link with phone number');
  console.log('');
  console.log('Waiting for connection (timeout: 2 minutes)...');

  await result.waitForConnection;
} catch (error) {
  console.error('✗ Authentication failed:', error instanceof Error ? error.message : String(error));
  store.close();
  process.exit(1);
}
