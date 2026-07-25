import { describe, expect, it, vi } from 'vitest';

import { CHAT_CAPABILITIES, PAGE_CAPABILITIES, toWebMcpTool, toWebMcpTools } from '../../agentic/index.js';

const ALL = [...CHAT_CAPABILITIES, ...PAGE_CAPABILITIES];
const HIGHLIGHT = PAGE_CAPABILITIES.find((c) => c.id === 'page.highlight')!;

describe('webmcp projection', () => {
  it('maps a capability onto the registerTool shape and dispatches by id', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const tool = toWebMcpTool(HIGHLIGHT, execute);

    expect(tool.name).toBe('page.highlight');
    expect(tool.description).toBe(HIGHLIGHT.description);
    // WebMCP names the schema field `inputSchema` — see ag-ui.test for the contrast.
    expect(tool.inputSchema).toBe(HIGHLIGHT.inputSchema);

    await tool.execute({ element: 'task-water-plants' });
    expect(execute).toHaveBeenCalledWith('page.highlight', { element: 'task-water-plants' });
  });

  it('substitutes an empty object when a caller passes nothing', async () => {
    const execute = vi.fn(async () => null);
    await toWebMcpTool(HIGHLIGHT, execute).execute(undefined as unknown as Record<string, unknown>);
    expect(execute).toHaveBeenCalledWith('page.highlight', {});
  });

  it('projects a whole manifest in order', () => {
    const tools = toWebMcpTools(ALL, async () => null);
    expect(tools.map((t) => t.name)).toEqual(ALL.map((c) => c.id));
  });
});
