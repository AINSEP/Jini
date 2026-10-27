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

// MOVE: Daemon HTTP errors omit endpoint URLs while retaining trusted recovery hints and redaction.
const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: fetch };

it('threads trusted registry IDs through daemon diagnostics and the final MCP error sanitizer', async () => {
  const { postDaemonJson } = await import('../daemon-client.js');
  const { daemonCallOptions } = await import('../tool-protocol.js');
  const diagnosticToolIds = ['forms_create_definition', 'source_control_get_capabilities'];
  const diagnostic = `Schema for 'forms_create_definition': {"additionalProperties":false}; Call source_control_get_capabilities`;
  const tools = buildToolIndex({ tools: [{ name: 'gateway', description: 'test', inputSchema: { type: 'object' },
    handler: ({ ctx }) => postDaemonJson({ baseUrl: ctx.baseUrl, route: '/api/x', body: {} }, daemonCallOptions({ ctx })),
  }] });
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: { message: diagnostic } }), { status: 400 });
  const result = await handleToolCall({ name: 'gateway', tools, ctx: { ...ctx, fetchImpl, diagnosticToolIds } });
  expect(result).toEqual({ isError: true, content: [{ type: 'text', text: `HTTP 400: ${diagnostic}` }] });
});

it('preserves a dotted recovery hint through both error sanitizers, masking glued and token secrets', async () => {
  const { postDaemonJson } = await import('../daemon-client.js');
  const { daemonCallOptions } = await import('../tool-protocol.js');
  const id = 'content_read.backup_restore_point';
  const opaque = 'x7Qm2Pz9Vb4Nc8Ld1Rf6Yt3Wk5';
  const hint = `backup_restore_point 'missing' was not found — call ${id} without id to list valid ids`;
  const message = `${hint}; ${id}_${opaque} api_key=${id} sk-proj-${opaque} ${opaque}`;
  const tools = buildToolIndex({ tools: [{ name: 'gateway', description: 'test', inputSchema: { type: 'object' },
    handler: ({ ctx }) => postDaemonJson({ baseUrl: ctx.baseUrl, route: '/api/x', body: {} }, daemonCallOptions({ ctx })),
  }] });
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: { message } }), { status: 400 });
  const result = await handleToolCall({ name: 'gateway', tools, ctx: { ...ctx, fetchImpl, diagnosticToolIds: [id] } });
  expect(result).toEqual({ isError: true, content: [{ type: 'text', text: `HTTP 400: ${hint}; content_read.[redacted] api_key=[redacted] [redacted] [redacted]` }] });
});

it.each([
  "slug 'a-long-existing-content-slug' already exists",
  'ToolExecutor: unknown tool "agent_plugin_cloudflare"',
])('keeps identifiers through the complete daemon-to-MCP error path: %s', async diagnostic => {
  const { postDaemonJson } = await import('../daemon-client.js');
  const { daemonCallOptions } = await import('../tool-protocol.js');
  const esc = String.fromCharCode(27);
  const token = 'run-scoped-opaque-credential';
  const vendorToken = `sk-proj-${'v'.repeat(25)}`;
  const signedUrl = 'https://user:pw@files.example/download?signature=short-signature#private';
  const uuid = '123e4567-e89b-12d3-a456-426614174000';
  const message = `${esc}[31m${diagnostic}${esc}[0m ${token} ${uuid} api_key=short-key ${vendorToken} ${signedUrl}`;
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: { message } }), { status: 400 });
  const tools = buildToolIndex({ tools: [makeTool({ name: 'gateway',
    handler: ({ ctx }) => postDaemonJson({ baseUrl: ctx.baseUrl, route: '/api/delegated-tool-calls', body: {} }, daemonCallOptions({ ctx })),
  })] });
  const result = await handleToolCall({ name: 'gateway', tools, ctx: { ...ctx, fetchImpl, authHeaders: { Authorization: `Bearer ${token}` } } });
  expect(result).toEqual({ isError: true, content: [{ type: 'text', text: `HTTP 400: ${diagnostic} [redacted] [redacted] api_key=[redacted] [redacted] https://files.example/download` }] });
});

it('protects raw handler errors at the final catch, retaining identifiers and the output cap', async () => {
  const token = 'bare-run-credential';
  const diagnostic = 'ToolExecutor: unknown tool "agent_plugin_cloudflare"';
  const tools = buildToolIndex({ tools: [makeTool({ name: 'gateway', handler: () => {
    throw new Error(`${diagnostic} ${token} api_key=short https://files.example/x?signature=secret ${'word '.repeat(150)}`);
  } })] });
  const result = await handleToolCall({ name: 'gateway', tools, ctx: { ...ctx, authHeaders: { Authorization: `Bearer ${token}` } } });
  expect(result.isError).toBe(true);
  const text = (result.content[0] as { text: string }).text;
  const expected = `${diagnostic} [redacted] api_key=[redacted] https://files.example/x ${'word '.repeat(150)}`;
  expect(text).toBe(`${expected.slice(0, 487)}… [truncated]`);
  expect(text.length).toBe(500);
});

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
    expect(okResult({ payload: 'hello' })).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('JSON-stringifies a non-string payload compactly — no indentation on the wire (a person-facing view pretty-prints at render time)', () => {
    expect(okResult({ payload: { a: 1, b: { c: [1, 2] } } })).toEqual({ content: [{ type: 'text', text: '{"a":1,"b":{"c":[1,2]}}' }] });
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
    expect(okResult({ payload })).toEqual({ content: payload.content });
  });

  it('still JSON-stringifies a `content` array holding one malformed block — fails closed, does not forward it as protocol output', () => {
    const payload = { content: [{ type: 'image', mimeType: 'image/png' /* missing data */  }] };
    expect(okResult({ payload })).toEqual({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
  });

  it('still JSON-stringifies a `content` array holding a malformed resource block (missing required text/blob)', () => {
    // `resource` IS a recognized ContentBlock type (see the passthrough tests below) — this block is
    // rejected for being malformed, not for its `type` being unrecognized. A resource block missing
    // both `text` and `blob` cannot be carrying withheld payload data in the first place, so falling
    // back to stringify here is safe: there is nothing sensitive in this shape to leak.
    const payload = { content: [{ type: 'resource', resource: { uri: 'ui://x' } }] };
    expect(okResult({ payload })).toEqual({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
  });

  it('passes a well-formed `resource` content block through verbatim (ADR-053 Decision 5 regression)', () => {
    // This is the exact shape that leaked in the traced incident: a confirmation token embedded in a
    // resource block's `text`, alongside an ordinary text acknowledgment. Before this fix, `resource`
    // was not in okResult's hand-rolled allowlist (only `text`/`image`), so the whole envelope fell
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
    expect(okResult({ payload })).toEqual({ content: payload.content });
  });

  it('passes a well-formed `resource_link` content block through verbatim', () => {
    // Proves the fix recognizes content blocks via the pinned MCP SDK's own `ContentBlockSchema`
    // rather than a hand-maintained per-type list — `resource_link` was never named in the incident,
    // but a schema-driven check picks it up for free the same way `resource` is.
    const payload = { content: [{ type: 'resource_link', uri: 'ui://x', name: 'widget' }] };
    expect(okResult({ payload })).toEqual({ content: payload.content });
  });

  it('passes a well-formed `audio` content block through verbatim', () => {
    const payload = { content: [{ type: 'audio', data: 'AAAA', mimeType: 'audio/wav' }] };
    expect(okResult({ payload })).toEqual({ content: payload.content });
  });

  it('JSON-stringifies a plain object whose `content` field is not an array', () => {
    const payload = { content: 'just a string field named content' };
    expect(okResult({ payload })).toEqual({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
  });

  it('passes through an empty content array as a valid, empty result', () => {
    expect(okResult({ payload: { content: [] } })).toEqual({ content: [] });
  });
});

describe('errorResult', () => {
  it('marks isError and wraps the message as text content', () => {
    expect(errorResult({ message: 'boom' })).toEqual({ isError: true, content: [{ type: 'text', text: 'boom' }] });
  });
});

describe('requireString', () => {
  it('does not throw for a non-empty string', () => {
    expect(() => requireString({ value: 'x', name: 'field' })).not.toThrow();
  });

  it('throws for undefined', () => {
    expect(() => requireString({ value: undefined, name: 'field' })).toThrow('field is required (string).');
  });

  it('throws for an empty string', () => {
    expect(() => requireString({ value: '', name: 'field' })).toThrow('field is required (string).');
  });

  it('throws for a non-string value', () => {
    expect(() => requireString({ value: 42, name: 'field' })).toThrow('field is required (string).');
  });
});

describe('toolsToList', () => {
  it('projects name/description/inputSchema and omits annotations when unset', () => {
    const tool = makeTool();
    expect(toolsToList({ tools: [tool] })).toEqual([
      { name: 'noop', description: 'does nothing', inputSchema: tool.inputSchema },
    ]);
  });

  it('includes annotations when set', () => {
    const tool = makeTool({ annotations: { readOnlyHint: true } });
    expect(toolsToList({ tools: [tool] })[0]).toEqual({
      name: 'noop',
      description: 'does nothing',
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: true },
    });
  });

  // An embedded schema (a TipTap body under one property) keeps its own $defs; `#` is the tool root.
  const embedded = {
    type: 'object',
    $defs: { rootOnly: { type: 'string' }, node: { type: 'number' } },
    properties: {
      tag: { $ref: '#/$defs/rootOnly' },
      'body/doc': {
        $defs: { node: { type: 'object', properties: { kids: { type: 'array', items: { $ref: '#/$defs/node' } } } } },
        type: 'object',
        properties: { root: { $ref: '#/$defs/node' }, label: { $ref: '#/$defs/rootOnly' } },
      },
    },
  };

  it('publishes embedded $defs refs scoped to their own $defs, leaving root-scoped refs and the source schema as they were', () => {
    const tool = makeTool({ inputSchema: embedded as McpToolDef['inputSchema'] });
    const before = structuredClone(embedded);
    const listed = toolsToList({ tools: [tool] })[0]!.inputSchema as typeof embedded;
    const body = listed.properties['body/doc'];
    expect(body.properties.root.$ref).toBe('#/properties/body~1doc/$defs/node');
    expect(body.$defs.node.properties.kids.items.$ref).toBe('#/properties/body~1doc/$defs/node');
    expect(body.properties.label.$ref).toBe('#/$defs/rootOnly');
    expect(listed.properties.tag.$ref).toBe('#/$defs/rootOnly');
    expect(embedded).toEqual(before);
  });

  it('validates a call against the embedded $defs instead of refusing an unresolved ref', async () => {
    const tool = makeTool({ inputSchema: embedded as McpToolDef['inputSchema'], handler: async () => 'ok' });
    const call = (args: Record<string, unknown>) => handleToolCall({ name: 'noop', tools: buildToolIndex({ tools: [tool] }), ctx }, { rawArgs: args });
    expect((await call({ 'body/doc': { root: { kids: [{ kids: [] }] }, label: 'x' } })).isError).toBeUndefined();
    const bad = await call({ 'body/doc': { root: { kids: [7] } } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).not.toContain('Unresolved');
  });
});

describe('buildToolIndex', () => {
  it('indexes tools by name', () => {
    const a = makeTool({ name: 'a' });
    const b = makeTool({ name: 'b' });
    const index = buildToolIndex({ tools: [a, b] });
    expect(index.get('a')).toBe(a);
    expect(index.get('b')).toBe(b);
    expect(index.size).toBe(2);
  });

  it('throws on a duplicate tool name', () => {
    expect(() => buildToolIndex({ tools: [makeTool({ name: 'dup' }), makeTool({ name: 'dup' })] })).toThrow(
      'createMcpToolServer: duplicate tool name "dup"',
    );
  });
});

describe('handleToolCall', () => {
  it('returns an error result for an unknown tool name', async () => {
    const result = await handleToolCall({ name: 'missing', tools: buildToolIndex({ tools: [] }), ctx }, { rawArgs: {} });
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'unknown tool: missing' }] });
  });

  it('invokes the matched handler with args defaulted to {} and wraps a successful result', async () => {
    const handler = ({ args }: { args: Record<string, unknown> }) => ({ received: args });
    const tools = buildToolIndex({ tools: [makeTool({ name: 't', handler })] });
    const result = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: undefined });
    expect(result).toEqual(okResult({ payload: { received: {} } }));
  });

  it('passes through the raw arguments and context to the handler', async () => {
    let seenArgs: unknown;
    let seenCtx: unknown;
    const tools = buildToolIndex({ tools: [
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, additionalProperties: false },
        handler: ({ args: args, ctx: toolCtx }) => { seenArgs = args; seenCtx = toolCtx; return 'ok'; },
      }),
    ] });
    await handleToolCall({ name: 't', tools, ctx }, { rawArgs: { runId: 'r1' } });
    expect(seenArgs).toEqual({ runId: 'r1' });
    // handleToolCall adds the index's own tool names as trusted diagnostic IDs.
    expect(seenCtx).toEqual({ ...ctx, diagnosticToolIds: ['t'] });
  });

  it('rejects arguments missing a required field before the handler ever runs, as an isError result', async () => {
    const handler = () => { throw new Error('handler must not run'); };
    const tools = buildToolIndex({ tools: [
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'], additionalProperties: false },
        handler,
      }),
    ] });
    const result = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: {} });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid arguments for t');
  });

  it('rejects an undeclared property under additionalProperties:false before the handler ever runs', async () => {
    const handler = () => { throw new Error('handler must not run'); };
    const tools = buildToolIndex({ tools: [
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, additionalProperties: false },
        handler,
      }),
    ] });
    const result = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: { runId: 'r1', extra: 'nope' } });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid arguments for t');
  });

  it('rejects a wrong-typed argument before the handler ever runs', async () => {
    const handler = () => { throw new Error('handler must not run'); };
    const tools = buildToolIndex({ tools: [
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false },
        handler,
      }),
    ] });
    const result = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: { limit: 'not-a-number' } });
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
    const tools = buildToolIndex({ tools: [
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false },
        handler,
      }),
    ] });

    const result = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: { note: undefined } });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid arguments for t');
  });

  it('does not run the handler when the schema validator throws', async () => {
    let ran = false;
    const tools = buildToolIndex({ tools: [
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false },
        handler: () => {
          ran = true;
          return { ok: true };
        },
      }),
    ] });

    await handleToolCall({ name: 't', tools, ctx }, { rawArgs: { note: undefined } });

    expect(ran).toBe(false);
  });

  it('reuses the compiled schema validator across repeated calls to the same tool', async () => {
    const handler = ({ args }: { args: Record<string, unknown> }) => ({ received: args });
    const tools = buildToolIndex({ tools: [
      makeTool({
        name: 't',
        inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, additionalProperties: false },
        handler,
      }),
    ] });
    const first = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: { runId: 'r1' } });
    const second = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: { runId: 'r2' } });
    expect(first).toEqual(okResult({ payload: { received: { runId: 'r1' } } }));
    expect(second).toEqual(okResult({ payload: { received: { runId: 'r2' } } }));
  });

  it('converts a thrown Error into an isError result with the (sanitized) message', async () => {
    const tools = buildToolIndex({ tools: [makeTool({ name: 't', handler: () => { throw new Error('runId is required (string).'); } })] });
    const result = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: {} });
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'runId is required (string).' }] });
  });

  it('converts a thrown non-Error value into an isError result via String()', async () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    const tools = buildToolIndex({ tools: [makeTool({ name: 't', handler: () => { throw 'oops'; } })] });
    const result = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: {} });
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'oops' }] });
  });

  it('sanitizes a secret-looking thrown message before it reaches the result', async () => {
    const tools = buildToolIndex({ tools: [
      makeTool({ name: 't', handler: () => { throw new Error('daemon 400: apikey=abcdefghijklmnopqrstuvwxyz123456'); } }),
    ] });
    const result = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: {} });
    expect((result.content[0] as { text: string }).text).toContain('[redacted]');
  });

  it('awaits an async handler', async () => {
    const tools = buildToolIndex({ tools: [makeTool({ name: 't', handler: async () => Promise.resolve('async-ok') })] });
    const result = await handleToolCall({ name: 't', tools, ctx }, { rawArgs: {} });
    expect(result).toEqual(okResult({ payload: 'async-ok' }));
  });
});

describe('argument normalization and diagnostics (characterization)', () => {
  /** Registers one echo tool and calls it, so the result shows either the canonical args or the refusal. */
  async function callEcho(def: Partial<McpToolDef>, rawArgs: Record<string, unknown> | undefined): Promise<{ text: string; isError: boolean }> {
    const tool: McpToolDef = { name: 'echo', description: 'echo', inputSchema: { type: 'object' }, handler: ({ args }) => args, ...def };
    const result = await handleToolCall({ name: 'echo', tools: buildToolIndex({ tools: [tool] }), ctx }, { rawArgs });
    return { text: (result.content[0] as { text: string }).text, isError: result.isError === true };
  }
  const flat = { type: 'object', properties: { id: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false } as const;
  const wrapper = { type: 'object', properties: { id: { type: 'string' }, input: { type: 'object' } }, additionalProperties: false } as const;

  it('refuses non-object arguments with a replace instruction', async () => {
    // Malformed-input fixture: the wire type promises a record, an array arrives anyway.
    const rawArgs = [] as unknown as Record<string, unknown>;
    expect(await callEcho({}, rawArgs)).toEqual({ isError: true, text: 'invalid arguments for echo: replace `arguments` with a JSON object' });
  });

  it('accepts a schema without properties and passes extra keys through', async () => {
    expect(await callEcho({}, { a: 1 })).toEqual({ isError: false, text: '{"a":1}' });
  });

  it('renames an alias to its canonical key', async () => {
    expect(await callEcho({ inputSchema: flat, argumentNormalization: { aliases: { name: 'id' } } }, { name: 'x' })).toEqual({ isError: false, text: '{"id":"x"}' });
  });

  it('collapses an alias that repeats the canonical value', async () => {
    expect(await callEcho({ inputSchema: flat, argumentNormalization: { aliases: { name: 'id' } } }, { id: 'x', name: 'x' })).toEqual({ isError: false, text: '{"id":"x"}' });
  });

  it('refuses an alias that contradicts the canonical value', async () => {
    expect(await callEcho({ inputSchema: flat, argumentNormalization: { aliases: { name: 'id' } } }, { id: 'x', name: 'y' })).toEqual({
      isError: true, text: 'invalid arguments for echo: rename `name` to `id` and supply only one value for `id`',
    });
  });

  it('leaves arguments alone when the alias is absent', async () => {
    expect(await callEcho({ inputSchema: flat, argumentNormalization: { aliases: { name: 'id' } } }, { id: 'x' })).toEqual({ isError: false, text: '{"id":"x"}' });
  });

  it('folds stray keys into a missing input object', async () => {
    expect(await callEcho({ inputSchema: wrapper, argumentNormalization: { foldIntoInput: true } }, { id: 'x', q: 1 })).toEqual({ isError: false, text: '{"id":"x","input":{"q":1}}' });
  });

  it('folds stray keys into an existing input object', async () => {
    expect(await callEcho({ inputSchema: wrapper, argumentNormalization: { foldIntoInput: true } }, { input: { a: 1 }, q: 2 })).toEqual({ isError: false, text: '{"input":{"a":1,"q":2}}' });
  });

  it('refuses folding into a non-object input', async () => {
    expect(await callEcho({ inputSchema: wrapper, argumentNormalization: { foldIntoInput: true } }, { input: 'x', q: 1 })).toEqual({
      isError: true, text: "invalid arguments for echo: put the tool's own arguments inside `input`; replace `input` with a JSON object",
    });
  });

  it('refuses folding a key that input already holds', async () => {
    expect(await callEcho({ inputSchema: wrapper, argumentNormalization: { foldIntoInput: true } }, { input: { q: 1 }, q: 2 })).toEqual({
      isError: true, text: "invalid arguments for echo: put the tool's own arguments inside `input`",
    });
  });

  it('does not fold when there are no stray keys, then validates normally', async () => {
    expect(await callEcho({ inputSchema: wrapper, argumentNormalization: { foldIntoInput: true } }, { input: { id: 'x' } })).toEqual({ isError: false, text: '{"input":{"id":"x"}}' });
  });

  it('tells a flat strict tool to move a nested known key to the top level', async () => {
    expect(await callEcho({ inputSchema: flat }, { input: { id: 'x' } })).toEqual({ isError: true, text: 'invalid arguments for echo: move `input.id` to top-level `id`' });
  });

  it('reports the unknown input key when the nested object holds no known key', async () => {
    expect(await callEcho({ inputSchema: flat }, { input: { other: 1 } })).toEqual({ isError: true, text: 'invalid arguments for echo: remove unknown argument `input`' });
  });

  it('reports the unknown input key when input is not an object', async () => {
    expect(await callEcho({ inputSchema: flat }, { input: 'id' })).toEqual({ isError: true, text: 'invalid arguments for echo: remove unknown argument `input`' });
  });

  it('skips the move hint when the schema declares patternProperties', async () => {
    const schema = { ...flat, patternProperties: { '^x-': {} } };
    expect(await callEcho({ inputSchema: schema }, { input: { id: 'x' } })).toEqual({ isError: true, text: 'invalid arguments for echo: remove unknown argument `input`' });
  });

  it('skips the move hint when the schema allows additional properties', async () => {
    const schema = { type: 'object', properties: { id: { type: 'string' } } } as const;
    expect(await callEcho({ inputSchema: schema }, { input: { id: 'x' } })).toEqual({ isError: false, text: '{"input":{"id":"x"}}' });
  });

  it('refuses an explicitly undefined argument value', async () => {
    expect(await callEcho({}, { a: undefined })).toEqual({ isError: true, text: 'invalid arguments for echo: remove `a` or supply a JSON value instead of undefined' });
  });

  it('names a missing required argument at the top level', async () => {
    expect(await callEcho({ inputSchema: { ...flat, required: ['id'] } }, {})).toEqual({ isError: true, text: 'invalid arguments for echo: supply required argument `id`' });
  });

  it('names a missing required argument inside a nested object by its dotted path', async () => {
    const schema = { type: 'object', properties: { opts: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } } as const;
    expect(await callEcho({ inputSchema: schema }, { opts: {} })).toEqual({ isError: true, text: 'invalid arguments for echo: supply required argument `opts.id`' });
  });

  it('names an unknown nested argument by its dotted path', async () => {
    const schema = { type: 'object', properties: { opts: { type: 'object', properties: {}, additionalProperties: false } } } as const;
    expect(await callEcho({ inputSchema: schema }, { opts: { z: 1 } })).toEqual({ isError: true, text: 'invalid arguments for echo: remove unknown argument `opts.z`' });
  });

  it('decodes JSON-pointer escapes in a mistyped field path', async () => {
    const schema = { type: 'object', properties: { 'a/b~c': { type: 'number' } } } as const;
    expect(await callEcho({ inputSchema: schema }, { 'a/b~c': 'x' })).toEqual({ isError: true, text: 'invalid arguments for echo: change `a/b~c`: Instance type "string" is invalid. Expected "number".' });
  });

  it('stringifies a non-Error thrown while reading the arguments', async () => {
    // Malformed-input fixture: a getter that throws a bare string, which JSON-RPC input never carries.
    const rawArgs = Object.defineProperty({}, 'a', { enumerable: true, get: () => { throw 'getter blew up'; } }) as Record<string, unknown>;
    expect(await callEcho({}, rawArgs)).toEqual({ isError: true, text: 'invalid arguments for echo: getter blew up' });
  });

  it('describes a root-level violation as `arguments`', async () => {
    const schema = { type: 'object', minProperties: 1 } as const;
    expect(await callEcho({ inputSchema: schema }, {})).toEqual({ isError: true, text: 'invalid arguments for echo: change `arguments`: Instance does not have at least 1 properties.' });
  });
});

describe('daemonCallOptions (characterization)', () => {
  it('maps a bare context to only the injected fetch', async () => {
    const { daemonCallOptions } = await import('../tool-protocol.js');
    expect(daemonCallOptions({ ctx })).toEqual({ fetchImpl: fetch });
  });

  it('copies auth headers, diagnostic IDs and the cancellation signal when present', async () => {
    const { daemonCallOptions } = await import('../tool-protocol.js');
    const signal = new AbortController().signal;
    const authHeaders = { Authorization: 'Bearer ' + 'x'.repeat(8) };
    const options = daemonCallOptions({ ctx: { ...ctx, authHeaders, diagnosticToolIds: ['t'], signal } });
    expect(options).toEqual({ fetchImpl: fetch, diagnosticToolIds: ['t'], headers: authHeaders, signal });
    expect(options.headers).not.toBe(authHeaders);
  });
});

it('MCP marks partial and total batch failures as errors while retaining every item', () => {
  for (const results of [
    [{ ok: true, result: 'edited' }, { ok: false, error: 'missing' }],
    [{ ok: false, error: 'missing' }],
  ]) {
    const payload = { batch: true, results };
    expect(okResult({ payload })).toEqual({ isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] });
  }
  const payload = { isError: true, content: [{ type: 'text', text: 'refused' }] };
  expect(okResult({ payload })).toEqual(payload);
});
