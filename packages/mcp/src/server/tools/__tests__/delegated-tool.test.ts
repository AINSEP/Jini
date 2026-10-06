import { splitGatewayFixture } from '../../../__tests__/args-fixtures.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ postDaemonJson: vi.fn() }));
const { postDaemonJson } = hoisted;
vi.mock('../../daemon-client.js', () => hoisted);

import {
  createExecuteDelegatedToolTool,
  createExecuteReadonlyDelegatedToolTool,
  DEFAULT_DELEGATED_TOOL_TIMEOUT_MS,
} from '../delegated-tool.js';
import type { McpToolContext } from '../../tool-protocol.js';

const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: fetch };

beforeEach(() => {
  postDaemonJson.mockReset();
});

describe('createExecuteDelegatedToolTool', () => {
  it('declares the execute_delegated_tool name, schema, and write annotations', () => {
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    expect(tool.name).toBe('execute_delegated_tool');
    expect(tool.inputSchema).toMatchObject({ type: 'object', required: ['toolId'] });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, title: 'Execute a Jini-registered tool' });
  });

  it('types the input property as an object, so a client does not deliver the model\'s object as a JSON string', () => {
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    const properties = (tool.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(properties.input).toMatchObject({ type: 'object', additionalProperties: true });
  });

  it('requires toolId', async () => {
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    await expect(tool.handler({ args: {}, ctx: ctx })).rejects.toThrow('toolId is required (string).');
    expect(postDaemonJson).not.toHaveBeenCalled();
  });

  it('posts {runId, toolUseId, toolId, input} to /api/delegated-tool-calls, closing over the constructor-supplied runId', async () => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed', output: 'ok' } });
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1', generateToolUseId: () => 'tu-1' }));
    const result = await tool.handler({ args: { toolId: 'weather.get', input: { city: 'nyc' } }, ctx: ctx });
    expect(postDaemonJson).toHaveBeenCalledWith(
      { baseUrl: 'http://d.example', route: '/api/delegated-tool-calls', body: { runId: 'run-1', toolUseId: 'tu-1', toolId: 'weather.get', input: { city: 'nyc' } } }, { fetchImpl: ctx.fetchImpl, timeoutMs: 6 * 60 * 1000 },
    );
    expect(result).toEqual({ executionId: 'e1', status: 'completed', output: 'ok' });
  });

  it('overrides the daemon client 15s default so a handler parked on a human is not cut off', async () => {
    // A handler waiting for a human needs a deadline longer than the client's short default,
    // so a deliberate timeout cannot disappear during an argument-object refactor.
    // See docs/decisions/DR-004-parked-human-exchange-deadlines.md.
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    const options = (postDaemonJson.mock.calls[0] as unknown[])[1] as { timeoutMs?: number };
    expect(options.timeoutMs).toBe(6 * 60 * 1000);
    expect(options.timeoutMs).toBeGreaterThan(15_000);
  });

  it('forwards the MCP request cancel signal, so an abandoned call drops the daemon request and expires its dialog', async () => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    const signal = new AbortController().signal;
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    await tool.handler({ args: { toolId: 't1' }, ctx: { ...ctx, signal } });
    const options = (postDaemonJson.mock.calls[0] as unknown[])[1] as { signal?: AbortSignal };
    expect(options.signal).toBe(signal);
  });

  it('generates a fresh toolUseId per call via the default randomUUID generator when none is injected', async () => {
    postDaemonJson.mockResolvedValue({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    const bodyA = ((postDaemonJson.mock.calls[0] as unknown[])[0] as { body: unknown }).body as { toolUseId: string };
    const bodyB = ((postDaemonJson.mock.calls[1] as unknown[])[0] as { body: unknown }).body as { toolUseId: string };
    expect(bodyA.toolUseId).toEqual(expect.any(String));
    expect(bodyA.toolUseId.length).toBeGreaterThan(0);
    expect(bodyA.toolUseId).not.toBe(bodyB.toolUseId);
  });

  it('sends input: {} when the caller omits it, as the schema promises a no-input tool can be called that way', async () => {
    // Regression: the schema says "omit for a tool that takes no input", but most tool handlers
    // refuse an absent input ("input must be an object"), so an omitted input came back as a red
    // failed call the model then retried with `{}` (chat.db message e8c84205, 2026-10-05).
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1', generateToolUseId: () => 'tu-2' }));
    await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    const body = ((postDaemonJson.mock.calls[0] as unknown[])[0] as { body: Record<string, unknown> }).body;
    expect(body).toStrictEqual({ runId: 'run-1', toolUseId: 'tu-2', toolId: 't1', input: {} });
  });

  it('sends input: {} for an explicit null input too', async () => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteReadonlyDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1', generateToolUseId: () => 'tu-3' }));
    await tool.handler({ args: { toolId: 'content_stats', input: null }, ctx: ctx });
    const body = ((postDaemonJson.mock.calls[0] as unknown[])[0] as { body: Record<string, unknown> }).body;
    expect(body.input).toStrictEqual({});
  });

  it('two tool instances scoped to different runIds send different runId bodies', async () => {
    postDaemonJson.mockResolvedValue({ result: { executionId: 'e1', status: 'completed' } });
    const toolA = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-a', generateToolUseId: () => 'tu' }));
    const toolB = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-b', generateToolUseId: () => 'tu' }));
    await toolA.handler({ args: { toolId: 't1' }, ctx: ctx });
    await toolB.handler({ args: { toolId: 't1' }, ctx: ctx });
    expect(((postDaemonJson.mock.calls[0] as unknown[])[0] as { body: unknown }).body).toMatchObject({ runId: 'run-a' });
    expect(((postDaemonJson.mock.calls[1] as unknown[])[0] as { body: unknown }).body).toMatchObject({ runId: 'run-b' });
  });

  it('surfaces the result envelope unchanged, including a non-completed status (e.g. denied)', async () => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'denied' } });
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    const result = await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    expect(result).toEqual({ executionId: 'e1', status: 'denied' });
  });

  describe('unwrapping an MCP content envelope (typed-media bridge fix)', () => {
    // Regression: `@jini-ai/daemon`'s `delegated-tool-bridge.ts` keeps an `image` block in a
    // completed call's `output` (it is model-safe — see that package's `tool-result-surfaces.ts`).
    // Left wrapped inside `{executionId, status, output}`, `../tool-protocol.js`'s `okResult()` would
    // still JSON.stringify the whole thing into inert text, because the wrapper has no top-level
    // `content` field. This tool must unwrap down to `output` so `okResult()`'s own envelope
    // passthrough can find it.
    it('unwraps a completed result whose output is itself an MCP content envelope, down to just that envelope', async () => {
      postDaemonJson.mockResolvedValueOnce({
        result: {
          executionId: 'e1',
          status: 'completed',
          output: {
            content: [
              { type: 'text', text: 'Generated a swatch.' },
              { type: 'image', mimeType: 'image/png', data: 'AAAA' },
            ],
          },
        },
      });
      const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
      const result = await tool.handler({ args: { toolId: 'assistant_demo_image' }, ctx: ctx });
      expect(result).toEqual({
        content: [
          { type: 'text', text: 'Generated a swatch.' },
          { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        ],
      });
    });

    it('does NOT unwrap when output is plain JSON (not a content envelope) — preserves the existing envelope contract', async () => {
      postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed', output: { posts: [{ id: 'p1' }] } } });
      const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
      const result = await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
      expect(result).toEqual({ executionId: 'e1', status: 'completed', output: { posts: [{ id: 'p1' }] } });
    });

    it('does NOT unwrap a non-completed status even if it happens to carry an output-shaped content field', async () => {
      postDaemonJson.mockResolvedValueOnce({
        result: { executionId: 'e1', status: 'failed', output: { content: [{ type: 'text', text: 'partial' }] } },
      });
      const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
      const result = await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
      expect(result).toEqual({ executionId: 'e1', status: 'failed', output: { content: [{ type: 'text', text: 'partial' }] } });
    });
  });
});

describe('delegatedToolTimeoutMs (REF-002: the deadline is host policy, not engine policy)', () => {
  const timeoutOf = (): number | undefined =>
    ((postDaemonJson.mock.calls[0] as unknown[])[1] as { timeoutMs?: number }).timeoutMs;

  it('exports the default as the same six minutes the route shipped with, so hoisting it changed no behaviour', () => {
    expect(DEFAULT_DELEGATED_TOOL_TIMEOUT_MS).toBe(6 * 60 * 1000);
  });

  it('applies a host-supplied deadline instead of the default', async () => {
    // The point of the change: the engine cannot know a given host's exchange total-lifetime
    // ceiling, so the host supplies it. Before this option the six minutes was unreachable from
    // outside the module and one host's number sat hard-coded in generic engine source.
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1', delegatedToolTimeoutMs: 90_000 }));
    await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    expect(timeoutOf()).toBe(90_000);
  });

  it('accepts a deadline longer than the default, since raising the multi-turn ceiling starts here', async () => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1', delegatedToolTimeoutMs: 20 * 60 * 1000 }));
    await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    expect(timeoutOf()).toBe(20 * 60 * 1000);
  });

  it('falls back to the default when the option is omitted', async () => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    expect(timeoutOf()).toBe(DEFAULT_DELEGATED_TOOL_TIMEOUT_MS);
  });

  // Each of these would otherwise arm a nonsensical timer. `0` and negatives are the dangerous
  // pair: passed through, they make every human-in-the-loop call fail instantly — the exact
  // 15s-default failure this route's deadline exists to prevent, but worse.
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN (a malformed env var parsed with Number)', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('falls back to the default rather than arming a %s deadline', async (_label, value) => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1', delegatedToolTimeoutMs: value }));
    await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    expect(timeoutOf()).toBe(DEFAULT_DELEGATED_TOOL_TIMEOUT_MS);
  });
});

// REF-002's other half — the deadline's rationale used to name one host's file by product name in
// generic engine source — is deliberately NOT asserted here. `pnpm guard`'s R5-neutrality rule
// already scans every file under packages/**, and it flagged this exact file until the comment was
// rewritten. Restating it as a unit test would mean writing the forbidden strings into this file to
// match against, which trips that same repo-wide rule. The gate is `pnpm guard`.

describe('createExecuteReadonlyDelegatedToolTool', () => {
  it('declares the execute_readonly_delegated_tool name and a READ-ONLY annotation, which is the whole reason it exists', () => {
    const tool = createExecuteReadonlyDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    expect(tool.name).toBe('execute_readonly_delegated_tool');
    // A runtime that auto-denies any MCP tool lacking `readOnlyHint: true` (headless `codex exec`,
    // observed) killed every delegated call before it left the process — reads included. This
    // annotation is what makes the read half reachable at all.
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, destructiveHint: false });
  });

  it('posts the same body as execute_delegated_tool plus requireReadOnly:true, to the same route with the same options', async () => {
    postDaemonJson.mockResolvedValue({ result: { executionId: 'e1', status: 'completed', output: 'ok' } });
    const write = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1', generateToolUseId: () => 'tu-1' }));
    const read = createExecuteReadonlyDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1', generateToolUseId: () => 'tu-1' }));

    await write.handler({ args: { toolId: 'weather.get', input: { city: 'nyc' } }, ctx: ctx });
    await read.handler({ args: { toolId: 'weather.get', input: { city: 'nyc' } }, ctx: ctx });

    const [writeRequest, writeOptions] = postDaemonJson.mock.calls[0] as [{ baseUrl: string; route: string; body: Record<string, unknown> }, unknown];
    const { baseUrl: writeUrl, route: writePath, body: writeBody } = writeRequest;
    const [readRequest, readOptions] = postDaemonJson.mock.calls[1] as [{ baseUrl: string; route: string; body: Record<string, unknown> }, unknown];
    const { baseUrl: readUrl, route: readPath, body: readBody } = readRequest;
    expect(readUrl).toEqual(writeUrl);
    expect(readPath).toEqual(writePath);
    expect(readOptions).toEqual(writeOptions);
    expect(readBody).toEqual({ ...(writeBody as Record<string, unknown>), requireReadOnly: true });
  });

  it('never sends requireReadOnly from the write gateway, so the existing tool is unchanged on the wire', async () => {
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    const tool = createExecuteDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1', generateToolUseId: () => 'tu-1' }));
    await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    const body = ((postDaemonJson.mock.calls[0] as unknown[])[0] as { body: unknown }).body as Record<string, unknown>;
    expect(body).not.toHaveProperty('requireReadOnly');
  });

  it('requires toolId and honors the same timeout override as the write gateway', async () => {
    const tool = createExecuteReadonlyDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1', delegatedToolTimeoutMs: 1234 }));
    await expect(tool.handler({ args: {}, ctx: ctx })).rejects.toThrow('toolId is required (string).');
    postDaemonJson.mockResolvedValueOnce({ result: { executionId: 'e1', status: 'completed' } });
    await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    const options = (postDaemonJson.mock.calls[0] as unknown[])[1] as { timeoutMs?: number };
    expect(options.timeoutMs).toBe(1234);
  });

  it('unwraps a completed MCP content envelope exactly as the write gateway does', async () => {
    postDaemonJson.mockResolvedValueOnce({
      result: { executionId: 'e1', status: 'completed', output: { content: [{ type: 'text', text: 'hi' }] } },
    });
    const tool = createExecuteReadonlyDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    const result = await tool.handler({ args: { toolId: 't1' }, ctx: ctx });
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }] });
  });

  it('tells the model in its own description to fall back to execute_delegated_tool for a write', () => {
    const tool = createExecuteReadonlyDelegatedToolTool(...splitGatewayFixture({ runId: 'run-1' }));
    expect(tool.description).toContain('execute_delegated_tool');
  });
});
