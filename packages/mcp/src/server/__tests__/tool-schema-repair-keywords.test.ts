import { describe, expect, it } from 'vitest';
import { parseMcpToolInputSchema } from '../adapters/protocol.js';
import { buildToolIndex, handleToolCall, toolsToList, type McpToolDef } from '../tool-protocol.js';

/** A property that declares the two repair keywords a registry or local tool may carry. */
const INPUT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 8000, clamp: true },
    themeId: { type: 'string', obtainFrom: 'theme_list' },
  },
};

function tool(): McpToolDef {
  return { name: 'keyworded', description: 'carries repair keywords', inputSchema: INPUT_SCHEMA, handler: ({ args }) => ({ got: args }) };
}

describe('schema repair keywords are safe for every consumer of a published input schema', () => {
  it('the MCP validator compiles them and a valid call reaches the handler', async () => {
    const result = await handleToolCall({ name: 'keyworded', tools: buildToolIndex({ tools: [tool()] }), ctx: { baseUrl: 'http://d', fetchImpl: fetch } }, { rawArgs: { limit: 5, themeId: 'dark' } });
    expect(result).toEqual({ content: [{ type: 'text', text: '{"got":{"limit":5,"themeId":"dark"}}' }] });
  });

  it('parseMcpToolInputSchema accepts them and keeps them', () => {
    expect(parseMcpToolInputSchema({ inputSchema: INPUT_SCHEMA, toolId: 'keyworded' })).toEqual(INPUT_SCHEMA);
  });

  it('toolsToList publishes them unchanged', () => {
    expect(toolsToList({ tools: [tool()] })[0]?.inputSchema).toEqual(INPUT_SCHEMA);
  });
});
