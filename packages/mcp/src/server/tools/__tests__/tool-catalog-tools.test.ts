import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ getDaemonJson: vi.fn() }));
const { getDaemonJson } = hoisted;
vi.mock('../../daemon-client.js', () => hoisted);

import { TOOL_CATALOG_TOOLS, describeToolTool, searchToolsTool } from '../tool-catalog-tools.js';
import type { McpToolContext } from '../../tool-protocol.js';

const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: fetch };

describe('TOOL_CATALOG_TOOLS', () => {
  it('exports both tools with unique names', () => {
    expect(TOOL_CATALOG_TOOLS.map((t) => t.name)).toEqual(['search_tools', 'describe_tool']);
  });
});

describe('searchToolsTool', () => {
  it('requires query', async () => {
    await expect(searchToolsTool.handler({}, ctx)).rejects.toThrow('query is required (string).');
  });

  it('omits limit from the query string when not supplied', async () => {
    getDaemonJson.mockResolvedValueOnce({ hits: [] });
    await searchToolsTool.handler({ query: 'navigate page' }, ctx);
    expect(getDaemonJson).toHaveBeenCalledWith('http://d.example', '/api/tools/search?q=navigate+page', { fetchImpl: ctx.fetchImpl });
  });

  it('includes limit in the query string when supplied as a number', async () => {
    getDaemonJson.mockResolvedValueOnce({ hits: [] });
    await searchToolsTool.handler({ query: 'navigate page', limit: 5 }, ctx);
    expect(getDaemonJson).toHaveBeenCalledWith('http://d.example', '/api/tools/search?q=navigate+page&limit=5', { fetchImpl: ctx.fetchImpl });
  });

  it('returns the hits array from the daemon response', async () => {
    const hits = [{ id: 'page.fill', description: 'Fill a field', source: 'engine', score: 0.9 }];
    getDaemonJson.mockResolvedValueOnce({ hits });
    const result = await searchToolsTool.handler({ query: 'fill' }, ctx);
    expect(result).toBe(hits);
  });
});

describe('describeToolTool', () => {
  it('requires id', async () => {
    await expect(describeToolTool.handler({}, ctx)).rejects.toThrow('id is required (string).');
  });

  it('fetches the tool descriptor by id, URI-encoded', async () => {
    getDaemonJson.mockResolvedValueOnce({ id: 'page.fill', description: 'Fill a field' });
    const result = await describeToolTool.handler({ id: 'page.fill' }, ctx);
    expect(getDaemonJson).toHaveBeenCalledWith('http://d.example', '/api/tools/page.fill', { fetchImpl: ctx.fetchImpl });
    expect(result).toEqual({ id: 'page.fill', description: 'Fill a field' });
  });
});
