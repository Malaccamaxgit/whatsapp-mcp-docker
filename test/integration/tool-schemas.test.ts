import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers/test-server.js';
import { MessageStore } from '../../src/whatsapp/store.js';

/**
 * Guards the tool boundary at the serving path.
 *
 * The MCP SDK converts each tool's Zod raw shape into JSON Schema for
 * tools/list, then validates incoming arguments before the handler runs. The
 * Zod 4 upgrade changes both paths, so both are asserted here rather than
 * being left to the type checker.
 */
describe('Tool schema conversion (Zod 4)', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  before(async () => {
    const store = new MessageStore(':memory:');
    ctx = await createTestServer({ store });
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('converts a tool input shape to JSON Schema', async () => {
    const listed = await ctx.client.listTools();
    assert.ok(listed.tools.length > 30, `expected the full tool set, got ${listed.tools.length}`);

    const tool = listed.tools.find((t) => t.name === 'send_message');
    assert.ok(tool, 'send_message is missing from tools/list');

    const schema = tool.inputSchema as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };

    assert.equal(schema.type, 'object');
    assert.ok(schema.properties?.to, 'send_message schema has no "to" property');
    assert.ok(schema.properties?.message, 'send_message schema has no "message" property');
    assert.deepEqual([...(schema.required ?? [])].sort(), ['message', 'to']);
  });

  it('keeps array bounds and string limits in the generated schema', async () => {
    const listed = await ctx.client.listTools();
    const tool = listed.tools.find((t) => t.name === 'get_user_info');
    assert.ok(tool, 'get_user_info is missing from tools/list');

    const schema = tool.inputSchema as {
      properties?: Record<string, { maxItems?: number; items?: { maxLength?: number } }>;
    };

    assert.equal(schema.properties?.phones?.maxItems, 20);
    assert.equal(schema.properties?.phones?.items?.maxLength, 200);
  });

  it('rejects an oversized array before the handler runs', async () => {
    const phones = Array.from({ length: 21 }, (_, i) => `+151455500${String(i).padStart(2, '0')}`);

    const result = await ctx.client.callTool({
      name: 'get_user_info',
      arguments: { phones }
    });

    assert.ok(result.isError);
    assert.match(result.content[0]?.text ?? '', /expected array to have <=20 items/);
  });

  it('keeps the custom phone validation message', async () => {
    const result = await ctx.client.callTool({
      name: 'get_user_info',
      arguments: { phones: ['+123'] }
    });

    assert.ok(result.isError);

    const text = result.content[0]?.text ?? '';
    assert.match(text, /Phone number too short/);
    assert.match(text, /phones\[0\]/);
  });
});
