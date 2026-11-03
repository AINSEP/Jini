import { expect, it } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createToolResultPages } from '../tool-result-pages.js';
import { handleToolCall } from '../tool-protocol.js';

function text(result: CallToolResult): string {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('Expected model-visible text');
  return block.text;
}

it('a saved oversized result is readable in full through a tool without opening a shell file', async () => {
  const pages = createToolResultPages({}, { generateId: () => 'saved-a' });
  const original = 'first line\n' + 'abcdef'.repeat(6000) + '\nlast line';
  const projected = pages.project({ result: { content: [{ type: 'text', text: original }] } });
  expect(text(projected)).toContain('read_tool_result');
  expect(text(projected)).toContain('"resultId":"saved-a"');
  expect(text(projected)).toContain('Never use Bash');
  expect(text(projected).length).toBeLessThan(12000);
  let recovered = '';
  for (let offset = 0; offset < original.length; offset += 4000) {
    const result = await handleToolCall({ name: pages.tool.name, tools: new Map([[pages.tool.name, pages.tool]]),
      ctx: { baseUrl: 'http://unused', fetchImpl: fetch } }, { rawArgs: { resultId: 'saved-a', offset } });
    expect(result.isError).not.toBe(true);
    const page = text(result);
    recovered += page.slice(page.indexOf('\n') + 1);
  }
  expect(recovered).toBe(original);
});

it('paging preserves images, resource blocks, error flags and small results', () => {
  const pages = createToolResultPages({}, { generateId: () => 'saved-a' });
  const image = { type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' };
  const resource = { type: 'resource_link' as const, uri: 'https://example.com/result', name: 'result' };
  const small = { content: [{ type: 'text' as const, text: 'short' }, image, resource], isError: true };
  expect(pages.project({ result: small })).toEqual(small);
  const result = pages.project({ result: { ...small, content: [{ type: 'text', text: 'x'.repeat(15000) }, image, resource] } });
  expect(result.content.slice(1)).toEqual([image, resource]);
  expect(result.isError).toBe(true);
});

it('saved results stay isolated to one run and become unavailable after cleanup', async () => {
  const first = createToolResultPages({}, { generateId: () => 'saved-a' });
  const second = createToolResultPages({});
  first.project({ result: { content: [{ type: 'text', text: 'x'.repeat(15000) }] } });
  const read = (pages: typeof first) => handleToolCall({ name: pages.tool.name,
    tools: new Map([[pages.tool.name, pages.tool]]), ctx: { baseUrl: 'http://unused', fetchImpl: fetch } },
  { rawArgs: { resultId: 'saved-a' } });
  expect((await read(first)).isError).not.toBe(true);
  expect((await read(second)).isError).toBe(true);
  first.clear({});
  expect((await read(first)).isError).toBe(true);
});

it('many saved results evict the oldest with an explicit reread instruction', async () => {
  let id = 0;
  const pages = createToolResultPages({}, { generateId: () => `saved-${++id}` });
  for (let n = 0; n < 33; n++) pages.project({ result: { content: [{ type: 'text', text: 'x'.repeat(15000) }] } });
  const read = async (resultId: string) => handleToolCall({ name: pages.tool.name, tools: new Map([[pages.tool.name, pages.tool]]),
    ctx: { baseUrl: 'http://unused', fetchImpl: fetch } }, { rawArgs: { resultId } });
  expect((await read('saved-1')).isError).toBe(true);
  expect(text(await read('saved-1'))).toContain('Repeat the original tool call with a narrower query');
  expect((await read('saved-33')).isError).not.toBe(true);
});

it('a result larger than the cache budget fails explicitly without publishing unreadable IDs', () => {
  const pages = createToolResultPages({});
  const result = pages.project({ result: { content: Array.from({ length: 33 }, () => ({ type: 'text' as const, text: 'x'.repeat(15000) })) } });
  expect(result.isError).toBe(true);
  expect(text(result)).toContain('Repeat the original tool call with a narrower query');
  expect(text(result)).not.toContain('resultId');
});

it.each([{ offset: -1 }, { offset: 15001 }, { limit: 0 }, { limit: 8001 }])('saved-result reads reject invalid ranges %j', async range => {
  const pages = createToolResultPages({}, { generateId: () => 'saved-a' });
  pages.project({ result: { content: [{ type: 'text', text: 'x'.repeat(15000) }] } });
  const result = await handleToolCall({ name: pages.tool.name, tools: new Map([[pages.tool.name, pages.tool]]),
    ctx: { baseUrl: 'http://unused', fetchImpl: fetch } }, { rawArgs: { resultId: 'saved-a', ...range } });
  expect(result.isError).toBe(true);
});

it('several medium text blocks are paged before their combined result spills, while protocol metadata stays inline', () => {
  let id = 0;
  const pages = createToolResultPages({}, { generateId: () => `saved-${++id}` });
  const marker = { type: 'text' as const, text: '{"jiniDelegatedResult":{"version":1,"toolUseId":"bridge-a"}}' };
  const result = pages.project({ result: { content: [marker,
    { type: 'text', text: 'a'.repeat(8000) }, { type: 'text', text: 'b'.repeat(8000) }] } });
  expect(result.content[0]).toEqual(marker);
  expect(JSON.stringify(result)).toContain('saved-1');
  expect(JSON.stringify(result)).toContain('saved-2');
  expect(JSON.stringify(result).length).toBeLessThan(12000);
});

it('a single response beyond the retained character budget is an explicit error', () => {
  const pages = createToolResultPages({});
  const result = pages.project({ result: { content: [
    { type: 'text', text: 'a'.repeat(4_000_001) }, { type: 'text', text: 'b'.repeat(4_000_001) }] } });
  expect(result.isError).toBe(true);
  expect(text(result)).toContain('saved-result limit');
  expect(text(result)).not.toContain('resultId');
});
