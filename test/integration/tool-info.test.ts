import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers/test-server.js';
import { MessageStore } from '../../src/whatsapp/store.js';

describe('get_tool_info (integration)', () => {
  let ctx: Awaited<ReturnType<typeof createTestServer>>;

  before(async () => {
    const store = new MessageStore(':memory:');
    ctx = await createTestServer({ store });
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('returns structured documentation for known tools', async () => {
    const result = await ctx.client.callTool({
      name: 'get_tool_info',
      arguments: { tool_name: 'download_media' }
    });

    assert.equal(result.isError, undefined);
    const text = result.content[0]?.text ?? '';
    assert.match(text, /TOOL:\s+download_media/);
    assert.match(text, /USAGE:/);
    assert.match(text, /EXAMPLES:/);
    assert.match(text, /RESPONSE:/);
    assert.match(text, /ERRORS:/);
    assert.match(text, /RELATED TOOLS:/);
    assert.match(text, /PITFALLS:/);
  });

  it('returns a clear error for unknown tools', async () => {
    const result = await ctx.client.callTool({
      name: 'get_tool_info',
      arguments: { tool_name: 'not_a_real_tool' }
    });

    assert.ok(result.isError);
    assert.match(result.content[0]?.text ?? '', /Unknown tool:/);
  });

  it('appends tool-specific hint to every non-meta tool description', async () => {
    const listed = await ctx.client.listTools();

    for (const tool of listed.tools) {
      if (tool.name === 'get_tool_info') {continue;}
      assert.ok(
        (tool.description ?? '').includes('get_tool_info'),
        `Tool ${tool.name} missing get_tool_info hint`
      );
      assert.ok(
        (tool.description ?? '').includes(`tool_name: '${tool.name}'`),
        `Tool ${tool.name} hint does not include its own tool name`
      );
    }
  });
});
