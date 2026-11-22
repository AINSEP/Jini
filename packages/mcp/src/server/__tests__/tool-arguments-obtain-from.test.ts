import { describe, expect, it } from 'vitest';
import { buildToolIndex, handleToolCall, type McpToolDef } from '../tool-protocol.js';

const SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['themeId'],
  properties: { themeId: { type: 'string', obtainFrom: 'theme_list' } },
};

/** The same tool without `obtainFrom`: what today's refusal looks like. */
const PLAIN_SCHEMA = { ...SCHEMA, properties: { themeId: { type: 'string' } } };

const CONTRACT = `Input schema: ${JSON.stringify(SCHEMA)}`;

const tool = (name: string, inputSchema: McpToolDef['inputSchema'] = SCHEMA): McpToolDef => ({ name, description: name, inputSchema, handler: () => 'ran' });

/** Calls `theme_open` with `rawArgs` on a server that publishes `published` and nothing else. */
async function callOpen(
  { rawArgs, published = [tool('theme_open'), tool('theme_list', { type: 'object', properties: {} })], diagnosticToolIds }:
  { rawArgs: Record<string, unknown>; published?: McpToolDef[]; diagnosticToolIds?: readonly string[] },
) {
  const result = await handleToolCall({
    name: 'theme_open', tools: buildToolIndex({ tools: published }),
    ctx: { baseUrl: 'http://d', fetchImpl: fetch, ...(diagnosticToolIds === undefined ? {} : { diagnosticToolIds }) },
  }, { rawArgs });
  return (result.content[0] as { text: string }).text;
}

describe('typed tool call: a missing required argument today (characterization)', () => {
  it('names the argument and carries the contract, with no pointer to a lister', async () => {
    expect(await callOpen({ rawArgs: {}, published: [tool('theme_open', PLAIN_SCHEMA), tool('theme_list', { type: 'object', properties: {} })] }))
      .toBe(`invalid arguments for theme_open: supply required argument \`themeId\`; Input schema: ${JSON.stringify(PLAIN_SCHEMA)}`);
  });
});

describe('typed tool call: a missing required argument that declares obtainFrom', () => {
  it('names the tool that lists valid values, between the instruction and the contract', async () => {
    expect(await callOpen({ rawArgs: {} })).toBe(`invalid arguments for theme_open: supply required argument \`themeId\`; list valid values with theme_list; ${CONTRACT}`);
  });

  it('names a lister the server does not publish when the host declares it visible to the run', async () => {
    const published = [tool('theme_open')];
    expect(await callOpen({ rawArgs: {}, published, diagnosticToolIds: ['theme_list'] })).toContain('; list valid values with theme_list; ');
  });

  it('never points at a tool the run cannot see', async () => {
    expect(await callOpen({ rawArgs: {}, published: [tool('theme_open')] })).toBe(`invalid arguments for theme_open: supply required argument \`themeId\`; ${CONTRACT}`);
  });

  it('adds nothing when the required argument is present and another argument is the problem', async () => {
    expect(await callOpen({ rawArgs: { themeId: 'dark', extra: 1 } })).toBe('invalid arguments for theme_open: remove unknown argument `extra`');
  });

  it('adds nothing for a wrong type of a present argument', async () => {
    expect(await callOpen({ rawArgs: { themeId: 7 } })).toBe('invalid arguments for theme_open: change `themeId`: Instance type "number" is invalid. Expected "string".');
  });
});
