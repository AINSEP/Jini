import { describe, expect, it } from 'vitest';
import { buildToolIndex, handleToolCall, type McpToolDef } from '../tool-protocol.js';

const SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['themeId'],
  properties: { themeId: { type: 'string', obtainFrom: 'theme_list' } },
};

const CONTRACT = `Input schema: ${JSON.stringify(SCHEMA)}`;

const tool = (name: string, inputSchema: McpToolDef['inputSchema'] = SCHEMA): McpToolDef => ({ name, description: name, inputSchema, handler: () => 'ran' });

/** Calls `theme_open` with `rawArgs` on a server that publishes `published` and nothing else. */
async function callOpen({ rawArgs, published = [tool('theme_open'), tool('theme_list', { type: 'object', properties: {} })] }: { rawArgs: Record<string, unknown>; published?: McpToolDef[] }) {
  const result = await handleToolCall({ name: 'theme_open', tools: buildToolIndex({ tools: published }), ctx: { baseUrl: 'http://d', fetchImpl: fetch } }, { rawArgs });
  return (result.content[0] as { text: string }).text;
}

describe('typed tool call: a missing required argument today (characterization)', () => {
  it('names the argument and carries the contract, with no pointer to a lister', async () => {
    expect(await callOpen({ rawArgs: {} })).toBe(`invalid arguments for theme_open: supply required argument \`themeId\`; ${CONTRACT}`);
  });
});
