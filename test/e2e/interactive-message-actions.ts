/**
 * Interactive E2E Test Script - Message Actions
 * 
 * This script validates the fixes for:
 * - BUG-003: send_reaction emoji not appearing on phone
 * - BUG-004: delete_message error 479 on revoke
 * 
 * Prerequisites:
 * 1. WhatsApp session authenticated in .test-data/
 * 2. Container running with MCP client connected (e.g., Cursor)
 * 
 * Instructions:
 * Run this script to get test commands, then execute them via your MCP client
 * and verify the results on your WhatsApp phone.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestServer } from '../integration/helpers/test-server.js';
import { MessageStore } from '../../src/whatsapp/store.js';
import { initEncryption } from '../../src/security/crypto.js';
import { WhatsAppClient } from '../../src/whatsapp/client.js';

const TEST_DATA_DIR = resolve(process.cwd(), '.test-data');
const SESSION_DB = resolve(TEST_DATA_DIR, 'session.db');

async function main() {
  console.log('='.repeat(70));
  console.log('INTERACTIVE E2E TEST: Message Actions (BUG-003 & BUG-004)');
  console.log('='.repeat(70));
  console.log('');

  // Check session
  if (!existsSync(SESSION_DB)) {
    console.error('❌ ERROR: No WhatsApp session found at .test-data/session.db');
    console.error('');
    console.error('Run authentication first:');
    console.error('  docker compose --profile test run --rm tester-container npx tsx test/e2e/setup-auth.ts');
    console.error('');
    process.exit(1);
  }

  console.log('✅ WhatsApp session found');
  console.log('');

  // Initialize components
  initEncryption(null);
  process.env.STORE_PATH = TEST_DATA_DIR;

  const store = new MessageStore(resolve(TEST_DATA_DIR, 'messages.db'));

  const waClient = new WhatsAppClient({
    storePath: TEST_DATA_DIR,
    messageStore: store,
    onConnected: () => {}
  });

  await waClient.initialize();

  const ctx = await createTestServer({
    waClient,
    store,
    storePath: TEST_DATA_DIR
  });

  console.log('✅ Connected to WhatsApp');
  console.log('');
  console.log('='.repeat(70));
  console.log('TEST INSTRUCTIONS');
  console.log('='.repeat(70));
  console.log('');
  console.log('Execute these commands via your MCP client (e.g., Cursor):');
  console.log('');
  console.log('Have your WhatsApp phone open and ready to verify results.');
  console.log('');
  
  // Test T16: send_reaction
  console.log('-'.repeat(70));
  console.log('TEST T16: send_reaction (BUG-003)');
  console.log('-'.repeat(70));
  console.log('');
  console.log('Step 1: Send a test message');
  console.log('Command:');
  console.log('```');
  console.log('send_message({');
  console.log('  message: "Testing reactions 🎯 - T16",');
  console.log('  to: "Benjamin"  // or any contact name');
  console.log('});');
  console.log('```');
  console.log('');
  console.log('→ Note the message_id from the response');
  console.log('');
  console.log('Step 2: Send a reaction to that message');
  console.log('Command:');
  console.log('```');
  console.log('send_reaction({');
  console.log('  chat: "Benjamin",  // same contact');
  console.log('  emoji: "👍",');
  console.log('  message_id: "<message_id_from_step_1>"');
  console.log('});');
  console.log('```');
  console.log('');
  console.log('✅ EXPECTED: 👍 thumbs-up appears below the message on your phone');
  console.log('❌ FAILED: No reaction appears, or wrong emoji appears');
  console.log('');
  console.log('Step 3: Try another emoji');
  console.log('Command:');
  console.log('```');
  console.log('send_reaction({');
  console.log('  chat: "Benjamin",');
  console.log('  emoji: "❤️",');
  console.log('  message_id: "<same_message_id>"');
  console.log('});');
  console.log('```');
  console.log('');
  console.log('✅ EXPECTED: ❤️ heart appears (replaces or adds to previous reaction)');
  console.log('');

  // Test T18: delete_message
  console.log('-'.repeat(70));
  console.log('TEST T18: delete_message (BUG-004)');
  console.log('-'.repeat(70));
  console.log('');
  console.log('Step 1: Send a message to delete');
  console.log('Command:');
  console.log('```');
  console.log('send_message({');
  console.log('  message: "This message will be deleted - T18",');
  console.log('  to: "Benjamin"  // or any contact name');
  console.log('});');
  console.log('```');
  console.log('');
  console.log('→ Note the message_id from the response');
  console.log('');
  console.log('Step 2: Delete the message for everyone');
  console.log('Command:');
  console.log('```');
  console.log('delete_message({');
  console.log('  chat: "Benjamin",  // same contact');
  console.log('  message_id: "<message_id_from_step_1>"');
  console.log('});');
  console.log('```');
  console.log('');
  console.log('✅ EXPECTED: Message disappears from chat (shows "This message was deleted")');
  console.log('❌ FAILED: Error 479, or message still visible');
  console.log('');

  // Additional validation
  console.log('-'.repeat(70));
  console.log('ADDITIONAL VALIDATION: Reaction in group chat');
  console.log('-'.repeat(70));
  console.log('');
  console.log('If you have a group chat, test reactions there too:');
  console.log('');
  console.log('Step 1: Send message in group');
  console.log('Command:');
  console.log('```');
  console.log('send_message({');
  console.log('  message: "Group reaction test",');
  console.log('  to: "WhatsAppMCP"  // or your group name');
  console.log('});');
  console.log('```');
  console.log('');
  console.log('Step 2: React to group message');
  console.log('Command:');
  console.log('```');
  console.log('send_reaction({');
  console.log('  chat: "WhatsAppMCP",');
  console.log('  emoji: "😂",');
  console.log('  message_id: "<group_message_id>"');
  console.log('});');
  console.log('```');
  console.log('');
  console.log('✅ EXPECTED: Reaction appears in group chat');
  console.log('');

  console.log('='.repeat(70));
  console.log('VERIFICATION CHECKLIST');
  console.log('='.repeat(70));
  console.log('');
  console.log('After running the tests above, verify:');
  console.log('');
  console.log('□ T16: Reaction 👍 appeared on message (BUG-003 fix)');
  console.log('□ T16b: Different emojis work (❤️, 😂, etc.)');
  console.log('□ T18: Message was successfully deleted (BUG-004 fix)');
  console.log('□ Group reactions work (if tested)');
  console.log('');
  console.log('Report results in the bug documentation files:');
  console.log('  - docs/bugs/BUG-003-send-reaction-emoji-encoding.md');
  console.log('  - docs/bugs/BUG-004-delete-message-error-479.md');
  console.log('');
  console.log('='.repeat(70));

  // Cleanup
  await waClient.disconnect();
  await ctx.cleanup();
  
  console.log('');
  console.log('Test script completed.');
  console.log('Now execute the commands above via your MCP client.');
  console.log('');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
