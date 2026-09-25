import { describe, expect, it } from 'vitest';
import {
  buildToolIndex,
  errorResult,
  handleToolCall,
  okResult,
  requireString,
  toolsToList,
  type McpToolContext,
  type McpToolDef,
} from '../tool-protocol.js';

const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: fetch };

function makeTool(overrides: Partial<McpToolDef> = {}): McpToolDef {
  return {
    name: 'noop',
    description: 'does nothing',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => ({ ok: true }),
    ...overrides,
  };
}

describe('okResult', () => {
  it('wraps a string payload as-is (no JSON-stringify quoting)', () => {
    expect(okResult('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('JSON-stringifies a non-string payload', () => {
    expect(okResult({ a: 1 })).toEqual({ content: [{ type: 'text', text: JSON.stringify({ a: 1 }, null, 2) }] });
  });

  it('passes a well-formed MCP content envelope through verbatim, preserving a typed image block', () => {
    // The regression this guards: a tool result carrying a real image block (e.g. from
    // `execute_delegated_tool` after `delegated-tool.ts`'s `unwrapMcpContentEnvelope`) must reach the
    // client as an actual `image` content block, not JSON-stringified base64 text.
    const payload = {
      content: [
        { type: 'text', text: 'Generated a swatch.' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      ],
    };
    expect(okResult(payload)).toEqual({ content: payload.content });
  });

  it('still JSON-stringifies a `content` array holding one malformed block — fails closed, does not forward it as protocol output', () => {
    const payload = { content: [{ type: 'image', mimeType: 'image/png' /* missing data */ }] };
    expect(okResult(payload)).toEqual({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
  });

  it('still JSON-stringifies a `content` array holding a malformed resource block (missing required text/blob)', () => {
    // `resource` IS a recognized ContentBlock type (see the passthrough tests below) — this block is
    // rejected for being malformed, not for its `type` being unrecognized. A resource block missing
    // both `text` and `blob` cannot be carrying withheld payload data in the first place, so falling
    // back to stringify here is safe: there is nothing sensitive in this shape to leak.
    const payload = { content: [{ type: 'resource', resource: { uri: 'ui://x' } }] };
    expect(okResult(payload)).toEqual({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
  });

  it('passes a well-formed `resource` content block through verbatim (ADR-053 Decision 5 regression)', () => {
    // This is the exact shape that leaked in the traced incident: a confirmation token embedded in a
    // resource block's `text`, alongside an ordinary text acknowledgment. Before this fix, `resource`
    // was not in okResult()'s hand-rolled allowlist (only `text`/`image`), so the whole envelope fell
    // to JSON.stringify and the token reached the model as plain text. It must now reach the client as
    // a real `resource` block instead of being flattened.
    const payload = {
      content: [
        { type: 'text', text: 'Delete queued — confirm in the UI.' },
        {
          type: 'resource',
          resource: { uri: 'ui://confirm-delete', mimeType: 'text/html', text: '<confirm-token>SECRET</confirm-token>' },
        },
      ],
    };
    expect(okResult(payload)).toEqual({ content: payload.content });
  });

  it('passes a well-formed `resource_link` content block through verbatim', () => {
    // Proves the fix recognizes content blocks via the pinned MCP SDK's own `ContentBlockSchema`
    // rather than a hand-maintained per-type list — `resource_link` was never named in the incident,
    // but a schema-driven check picks it up for free the same way `resource` is.
    const payload = { content: [{ type: 'resource_link', uri: 'ui://x', name: 'widget' }] };
    expect(okResult(payload)).toEqual({ content: payload.content });
  });

  it('passes a well-formed `audio` content block through verbatim', () => {
    const payload = { content: [{ type: 'audio', data: 'AAAA', mimeType: 'audio/wav' }] };
    expect(okResult(payload)).toEqual({ content: payload.content });
  });

  it('JSON-stringifies a plain object whose `content` field is not an array', () => {
    const payload = { content: 'just a string field named content' };
    expect(okResult(payload)).toEqual({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
  });

  it('passes through an empty content array as a valid, empty result', () => {
    expect(okResult({ content: [] })).toEqual({ content: [] });
  });
});

describe('errorResult', () => {
  it('marks isError and wraps the message as text content', () => {
    expect(errorResult('boom')).toEqual({ isError: true, content: [{ type: 'text', text: 'boom' }] });
  });
});

describe('requireString', () => {
  it('does not throw for a non-empty string', () => {
    expect(() => requireString('x', 'field')).not.toThrow();
  });

  it('throws for undefined', () => {
    expect(() => requireString(undefined, 'field')).toThrow('field is required (string).');
  });

  it('throws for an empty string', () => {
    expect(() => requireString('', 'field')).toThrow('field is required (string).');
  });

  it('throws for a non-string value', () => {
    expect(() => requireString(42, 'field')).toThrow('field is required (string).');
  });
});

describe('toolsToList', () => {
  it('projects name/description/inputSchema and omits annotations when unset', () => {
    const tool = makeTool();
    expect(toolsToList([tool])).toEqual([
      { name: 'noop', description: 'does nothing', inputSchema: tool.inputSchema },
    ]);
  });

  it('includes annotations when set', () => {
    const tool = makeTool({ annotations: { readOnlyHint: true } });
    expect(toolsToList([tool])[0]).toEqual({
      name: 'noop',
      description: 'does nothing',
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: true },
    });
  });
});

describe('buildToolIndex', () => {
  it('indexes tools by name', () => {
    const a = makeTool({ name: 'a' });
    const b = makeTool({ name: 'b' });
    const index = buildToolIndex([a, b]);
    expect(index.get('a')).toBe(a);
    expect(index.get('b')).toBe(b);
    expect(index.size).toBe(2);
  });

  it('throws on a duplicate tool name', () => {
    expect(() => buildToolIndex([makeTool({ name: 'dup' }), makeTool({ name: 'dup' })])).toThrow(
      'createMcpToolServer: duplicate tool name "dup"',
    );
  });
});

describe('handleToolCall', () => {
  it('returns an error result for an unknown tool name', async () => {
    const result = await handleToolCall('missing', {}, buildToolIndex([]), ctx);
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'unknown tool: missing' }] });
  });

  it('invokes the matched handler with args defaulted to {} and wraps a successful result', async () => {
    const handler = (args: Record<string, unknown>) => ({ received: args });
    const tools = buildToolIndex([makeTool({ name: 't', handler })]);
    const result = await handleToolCall('t', undefined, tools, ctx);
    expect(result).toEqual(okResult({ received: {} }));
  });

  it('passes through the raw arguments and context to the handler', async () => {
    let seenArgs: unknown;
    let seenCtx: unknown;
    const tools = buildToolIndex([
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, additionalProperties: false },
        handler: (args, toolCtx) => { seenArgs = args; seenCtx = toolCtx; return 'ok'; },
      }),
    ]);
    await handleToolCall('t', { runId: 'r1' }, tools, ctx);
    expect(seenArgs).toEqual({ runId: 'r1' });
    expect(seenCtx).toBe(ctx);
  });

  it('rejects arguments missing a required field before the handler ever runs, as an isError result', async () => {
    const handler = () => { throw new Error('handler must not run'); };
    const tools = buildToolIndex([
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'], additionalProperties: false },
        handler,
      }),
    ]);
    const result = await handleToolCall('t', {}, tools, ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid arguments for t');
  });

  it('rejects an undeclared property under additionalProperties:false before the handler ever runs', async () => {
    const handler = () => { throw new Error('handler must not run'); };
    const tools = buildToolIndex([
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, additionalProperties: false },
        handler,
      }),
    ]);
    const result = await handleToolCall('t', { runId: 'r1', extra: 'nope' }, tools, ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid arguments for t');
  });

  it('rejects a wrong-typed argument before the handler ever runs', async () => {
    const handler = () => { throw new Error('handler must not run'); };
    const tools = buildToolIndex([
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false },
        handler,
      }),
    ]);
    const result = await handleToolCall('t', { limit: 'not-a-number' }, tools, ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid arguments for t');
  });

  it('returns an isError result rather than throwing when the schema validator itself throws', async () => {
    // `@cfworker/json-schema` throws for JavaScript values JSON cannot encode
    // ("Instances of \"undefined\" type are not supported.") instead of reporting
    // `{valid:false}`. Validation runs before the try block, so that throw escapes
    // `handleToolCall` entirely — contradicting the documented guarantee that a
    // schema violation is an MCP `{isError:true}` result, never a rejection.
    // `handleToolCall` is exported and typed `Record<string, unknown>`, so a host
    // calling it directly (or through an injected server implementation) can reach
    // this with an optional property explicitly set to `undefined`.
    const handler = () => { throw new Error('handler must not run'); };
    const tools = buildToolIndex([
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false },
        handler,
      }),
    ]);

    const result = await handleToolCall('t', { note: undefined }, tools, ctx);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid arguments for t');
  });

  it('does not run the handler when the schema validator throws', async () => {
    let ran = false;
    const tools = buildToolIndex([
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false },
        handler: () => {
          ran = true;
          return { ok: true };
        },
      }),
    ]);

    await handleToolCall('t', { note: undefined }, tools, ctx);

    expect(ran).toBe(false);
  });

  it('reuses the compiled schema validator across repeated calls to the same tool', async () => {
    const handler = (args: Record<string, unknown>) => ({ received: args });
    const tools = buildToolIndex([
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, additionalProperties: false },
        handler,
      }),
    ]);
    const first = await handleToolCall('t', { runId: 'r1' }, tools, ctx);
    const second = await handleToolCall('t', { runId: 'r2' }, tools, ctx);
    expect(first).toEqual(okResult({ received: { runId: 'r1' } }));
    expect(second).toEqual(okResult({ received: { runId: 'r2' } }));
  });

  it('converts a thrown Error into an isError result with the (sanitized) message', async () => {
    const tools = buildToolIndex([makeTool({ name: 't', handler: () => { throw new Error('runId is required (string).'); } })]);
    const result = await handleToolCall('t', {}, tools, ctx);
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'runId is required (string).' }] });
  });

  it('converts a thrown non-Error value into an isError result via String()', async () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    const tools = buildToolIndex([makeTool({ name: 't', handler: () => { throw 'oops'; } })]);
    const result = await handleToolCall('t', {}, tools, ctx);
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'oops' }] });
  });

  it('sanitizes a secret-looking thrown message before it reaches the result', async () => {
    const tools = buildToolIndex([
      makeTool({ name: 't', handler: () => { throw new Error('daemon 400: apikey=abcdefghijklmnopqrstuvwxyz123456'); } }),
    ]);
    const result = await handleToolCall('t', {}, tools, ctx);
    expect((result.content[0] as { text: string }).text).toContain('[redacted]');
  });

  it('awaits an async handler', async () => {
    const tools = buildToolIndex([makeTool({ name: 't', handler: async () => Promise.resolve('async-ok') })]);
    const result = await handleToolCall('t', {}, tools, ctx);
    expect(result).toEqual(okResult('async-ok'));
  });
});
