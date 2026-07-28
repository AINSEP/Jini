import { describe, expect, it, vi } from 'vitest';

import {
  InvalidWebMcpToolNameError,
  PAGE_CAPABILITIES,
  isValidWebMcpToolName,
  toWebMcpTool,
  toWebMcpTools,
  WebMcpConfirmationRequiredError,
  type CapabilityDef,
} from '../index.js';

// PAGE_CAPABILITIES alone already has multiple entries, which is all "projects a whole manifest
// in order" below needs — this package ships no product-specific manifest of its own to combine
// it with (chat-core's CHAT_CAPABILITIES stays in chat-core; see source-map.md's "What moves").
const ALL = PAGE_CAPABILITIES;
const HIGHLIGHT = PAGE_CAPABILITIES.find((c) => c.id === 'page.highlight')!;
const FIND_ELEMENTS = PAGE_CAPABILITIES.find((c) => c.id === 'page.find_elements')!;

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

  // Uses page.find_elements rather than page.highlight (used above): every field on that
  // capability is optional, so `{}` is a genuinely *valid* call under the schema-on-error check
  // added below. page.highlight requires `element` — substituting `{}` for "nothing passed" would
  // now correctly be refused as a missing-required-field error, which is a different behavior
  // (covered in "schema-on-error discipline" below) and would make this test assert the wrong
  // thing if it kept using HIGHLIGHT.
  it('substitutes an empty object when a caller passes nothing', async () => {
    const execute = vi.fn(async () => null);
    await toWebMcpTool(FIND_ELEMENTS, execute).execute(undefined as unknown as Record<string, unknown>);
    expect(execute).toHaveBeenCalledWith('page.find_elements', {});
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

describe('tool name validation (spec §4.2: 1-128 chars, ASCII alnum + "_-.")', () => {
  it.each([
    ['a', true],
    ['page.highlight', true],
    ['a'.repeat(128), true],
    ['under_score-hyphen.dot9', true],
    ['', false],
    ['a'.repeat(129), false],
    ['has a space', false],
    ['has:colon', false],
    ['has/slash', false],
    ['emoji-🙂', false],
    ['has"quote', false],
  ])('isValidWebMcpToolName(%j) === %p', (name, expected) => {
    expect(isValidWebMcpToolName(name)).toBe(expected);
  });

  function capabilityWithId(id: string): CapabilityDef {
    return {
      id,
      description: 'test',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
      surface: 'session',
    };
  }

  it('throws InvalidWebMcpToolNameError synchronously for an empty capability id', () => {
    expect(() => toWebMcpTool(capabilityWithId(''), async () => null)).toThrow(InvalidWebMcpToolNameError);
  });

  it('throws for a capability id over 128 characters', () => {
    expect(() => toWebMcpTool(capabilityWithId('x'.repeat(200)), async () => null)).toThrow(
      InvalidWebMcpToolNameError,
    );
  });

  it('throws for a capability id containing a character outside the allowed set', () => {
    let error: unknown;
    try {
      toWebMcpTool(capabilityWithId('page:highlight'), async () => null);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidWebMcpToolNameError);
    expect((error as InvalidWebMcpToolNameError).capabilityId).toBe('page:highlight');
    expect((error as Error).message).toMatch(/1-128/);
  });

  it('throws synchronously — not as a rejected promise — so a caller cannot miss it with .catch() alone', () => {
    // No `await`, no try/catch around an async boundary: if this ever became an async rejection
    // instead of a sync throw, this expectation itself would throw an unhandled-rejection warning
    // rather than failing cleanly, which is exactly the divergence observed in the reference
    // `@mcp-b/webmcp-polyfill` for its OWN validation errors (see this session's report).
    let threw = false;
    try {
      toWebMcpTool(capabilityWithId('bad name'), async () => null);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('toWebMcpTools throws on the first invalid id in a batch, before returning anything', () => {
    const capabilities = [capabilityWithId('fine'), capabilityWithId('also fine? no')];
    expect(() => toWebMcpTools(capabilities, async () => null)).toThrow(InvalidWebMcpToolNameError);
  });
});

describe('title and annotations', () => {
  it('defaults annotations.readOnlyHint from a read-risk capability', () => {
    const tool = toWebMcpTool(FIND_ELEMENTS, async () => null);
    expect(FIND_ELEMENTS.risk).toBe('read');
    expect(tool.annotations).toEqual({ readOnlyHint: true });
  });

  it('defaults annotations.readOnlyHint to false for a write-risk capability', () => {
    const CLICK = PAGE_CAPABILITIES.find((c) => c.id === 'page.click')!;
    const tool = toWebMcpTool(CLICK, async () => null);
    expect(CLICK.risk).toBe('write');
    expect(tool.annotations).toEqual({ readOnlyHint: false });
  });

  it('lets the caller override readOnlyHint and add untrustedContentHint', () => {
    const tool = toWebMcpTool(FIND_ELEMENTS, async () => null, {
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    });
    expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
  });

  it('omits title when none is supplied', () => {
    const tool = toWebMcpTool(FIND_ELEMENTS, async () => null);
    expect(tool.title).toBeUndefined();
    expect('title' in tool).toBe(false);
  });

  it('attaches title when supplied via options', () => {
    const tool = toWebMcpTool(FIND_ELEMENTS, async () => null, { title: 'Find elements' });
    expect(tool.title).toBe('Find elements');
  });
});

describe('registerOptions (signal/exposedTo — the SECOND argument to the real registerTool)', () => {
  it('omits registerOptions when neither signal nor exposedTo is supplied', () => {
    const tool = toWebMcpTool(FIND_ELEMENTS, async () => null);
    expect(tool.registerOptions).toBeUndefined();
    expect('registerOptions' in tool).toBe(false);
  });

  it('bundles a supplied signal into registerOptions', () => {
    const controller = new AbortController();
    const tool = toWebMcpTool(FIND_ELEMENTS, async () => null, { signal: controller.signal });
    expect(tool.registerOptions).toEqual({ signal: controller.signal });
  });

  it('bundles a supplied exposedTo into registerOptions', () => {
    const tool = toWebMcpTool(FIND_ELEMENTS, async () => null, { exposedTo: ['https://example.com'] });
    expect(tool.registerOptions).toEqual({ exposedTo: ['https://example.com'] });
  });

  it('bundles both when both are supplied, and shares one registerOptions across a whole toWebMcpTools batch', () => {
    const controller = new AbortController();
    const tools = toWebMcpTools([FIND_ELEMENTS, HIGHLIGHT], async () => null, {
      signal: controller.signal,
      exposedTo: ['https://example.com'],
    });
    for (const tool of tools) {
      expect(tool.registerOptions).toEqual({ signal: controller.signal, exposedTo: ['https://example.com'] });
    }
  });
});

describe('schema-on-error discipline (matches page-executor.ts for page.*)', () => {
  it('refuses a call missing a required field, embedding the schema so the caller can self-correct', async () => {
    const execute = vi.fn();
    const tool = toWebMcpTool(HIGHLIGHT, execute);
    await expect(tool.execute({})).rejects.toThrow(
      `page.highlight: "element" is required. Expected input: ${JSON.stringify(HIGHLIGHT.inputSchema)}`,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a call whose field has the wrong type', async () => {
    const execute = vi.fn();
    const tool = toWebMcpTool(HIGHLIGHT, execute);
    await expect(tool.execute({ element: 42 })).rejects.toThrow(/"element" must be a string/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses an unknown argument when the schema declares additionalProperties: false', async () => {
    const execute = vi.fn();
    const tool = toWebMcpTool(HIGHLIGHT, execute);
    await expect(tool.execute({ element: 'x', bogus: true })).rejects.toThrow(/unknown argument: bogus/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs schema validation BEFORE the confirmation gate: a malformed call to a confirm-required tool fails with the schema error, never reaching (or needing) the confirmation handler', async () => {
    const requiresConfirmation: CapabilityDef = {
      id: 'page.fill',
      description: 'fill a field',
      inputSchema: {
        type: 'object',
        properties: { element: { type: 'string' }, text: { type: 'string' } },
        required: ['element', 'text'],
        additionalProperties: false,
      },
      risk: 'write',
      surface: 'session',
      requiresConfirmation: true,
    };
    const requestUserInteraction = vi.fn(async () => true);
    const execute = vi.fn();
    const tool = toWebMcpTool(requiresConfirmation, execute, { requestUserInteraction });
    // Missing `text` — a schema failure, not a confirmation decision.
    await expect(tool.execute({ element: 'x' })).rejects.toThrow(/"text" is required/);
    expect(requestUserInteraction).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('a schema-valid call to a confirm-required tool still goes through the confirmation gate normally', async () => {
    const requiresConfirmation: CapabilityDef = {
      id: 'page.fill',
      description: 'fill a field',
      inputSchema: {
        type: 'object',
        properties: { element: { type: 'string' }, text: { type: 'string' } },
        required: ['element', 'text'],
        additionalProperties: false,
      },
      risk: 'write',
      surface: 'session',
      requiresConfirmation: true,
    };
    const requestUserInteraction = vi.fn(async () => true);
    const execute = vi.fn(async () => ({ filled: true }));
    const tool = toWebMcpTool(requiresConfirmation, execute, { requestUserInteraction });
    await expect(tool.execute({ element: 'x', text: 'hello' })).resolves.toEqual({ filled: true });
    expect(requestUserInteraction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('page.fill', { element: 'x', text: 'hello' });
  });
});
