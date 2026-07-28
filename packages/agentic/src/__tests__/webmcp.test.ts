import { describe, expect, it, vi } from 'vitest';

import { PAGE_CAPABILITIES, toWebMcpTool, toWebMcpTools, WebMcpConfirmationRequiredError, type CapabilityDef } from '../index.js';

// PAGE_CAPABILITIES alone already has multiple entries, which is all "projects a whole manifest
// in order" below needs — this package ships no product-specific manifest of its own to combine
// it with (chat-core's CHAT_CAPABILITIES stays in chat-core; see source-map.md's "What moves").
const ALL = PAGE_CAPABILITIES;
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

describe('confirmation gate', () => {
  const confirming: CapabilityDef = {
    id: 'page.delete_everything',
    description: 'destructive',
    inputSchema: { type: 'object', properties: {} },
    risk: 'write',
    surface: 'session',
    requiresConfirmation: true,
  };

  it('refuses a confirmation-required capability when no handler is supplied', async () => {
    const execute = vi.fn();
    const [tool] = toWebMcpTools([confirming], execute);
    await expect(tool!.execute({})).rejects.toThrow(WebMcpConfirmationRequiredError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses when the handler declines, and does not run the capability', async () => {
    const execute = vi.fn();
    const tool = toWebMcpTool(confirming, execute, { requestUserInteraction: async () => false });
    await expect(tool.execute({})).rejects.toThrow(/declined/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs once the handler approves, and shows it the capability and args', async () => {
    const execute = vi.fn(async () => 'done');
    const seen: unknown[] = [];
    const tool = toWebMcpTool(confirming, execute, {
      requestUserInteraction: async (interaction) => {
        seen.push(interaction);
        return true;
      },
    });
    await expect(tool.execute({ force: true })).resolves.toBe('done');
    expect(seen).toEqual([{ capability: confirming, args: { force: true } }]);
    expect(execute).toHaveBeenCalledWith('page.delete_everything', { force: true });
  });

  it('leaves capabilities that do not require confirmation untouched', async () => {
    const { requiresConfirmation: _unused, ...withoutFlag } = confirming;
    const plain: CapabilityDef = { ...withoutFlag, id: 'page.read' };
    const execute = vi.fn(async () => 'ok');
    const tool = toWebMcpTool(plain, execute);
    await expect(tool.execute({})).resolves.toBe('ok');
  });
});
