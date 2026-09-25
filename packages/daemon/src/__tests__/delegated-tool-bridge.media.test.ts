import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createDelegatedToolBridge } from '../delegated-tool-bridge.js';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';
import { createToolExecutor } from '../tool-executor.js';

/**
 * The typed-media path, end to end through the bridge — the counterpart to
 * `delegated-tool-bridge.mcp-ui.test.ts`'s proof for the withheld-surface path. Proves the thing
 * `tool-result-media.test.ts` cannot: that the bridge actually attaches `media` to the real
 * `tool_result` wire event, that an ordinary (non-envelope) tool result is completely unaffected,
 * and that an image block does not ALSO leak out as a stray `mcp-ui` event.
 */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function collectEvents(lifecycle: ReturnType<typeof createRunLifecycle>, runId: string): Promise<RunProtocolEvent[]> {
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream(runId, (event) => events.push(event));
  return events;
}

async function runImageTool(output: unknown) {
  const registry = createToolRegistry();
  registry.register({
    descriptor: { id: 'demo_image' },
    handler: async () => output,
    policy: { authorize: () => 'allow' },
  });
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
  const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: createToolExecutor({ registry }) });
  const { run } = await lifecycle.start({ contextRef: 'media' });

  const result = await bridge.execute({
    runId: run.id,
    toolUseId: 'call-1',
    toolId: 'demo_image',
    principal: { id: 'user-1' },
    input: {},
  });

  return { result, events: await collectEvents(lifecycle, run.id) };
}

function toolResultPayload(events: RunProtocolEvent[]): { content: string; media?: unknown } {
  const payload = events
    .filter((e) => e.kind === 'agent')
    .map((e) => e.payload as { type: string })
    .find((p) => p.type === 'tool_result') as { content: string; media?: unknown } | undefined;
  if (!payload) throw new Error('expected a tool_result event');
  return payload;
}

describe('DelegatedToolBridge — typed media', () => {
  it('attaches an image block to the tool_result event as `media`', async () => {
    const { events } = await runImageTool({
      content: [
        { type: 'text', text: 'Generated a swatch.' },
        { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      ],
    });

    const toolResult = toolResultPayload(events);
    expect(toolResult.media).toEqual([{ type: 'image', mimeType: 'image/png', data: PNG_BASE64 }]);
    expect(toolResult.content).toContain('Generated a swatch.');
  });

  it('an image block does not ALSO leak out as a duplicate mcp-ui surface event', async () => {
    const { events } = await runImageTool({
      content: [{ type: 'text', text: 'ok' }, { type: 'image', mimeType: 'image/png', data: PNG_BASE64 }],
    });

    const agentPayloads = events.filter((e) => e.kind === 'agent').map((e) => e.payload as { type: string });
    expect(agentPayloads.filter((p) => p.type === 'mcp-ui')).toHaveLength(0);
  });

  it('keeps the image block in `result.output` too, not only the emitted event\'s `media` — this is the value `execute_delegated_tool` (`@jini-ai/mcp`) hands back as the MODEL\'s own tool result, with no access to the run event stream at all', async () => {
    const { result } = await runImageTool({
      content: [{ type: 'text', text: 'ok' }, { type: 'image', mimeType: 'image/png', data: PNG_BASE64 }],
    });
    expect(result.output).toEqual({
      content: [{ type: 'text', text: 'ok' }, { type: 'image', mimeType: 'image/png', data: PNG_BASE64 }],
    });
  });

  it('leaves an ordinary (non-envelope) tool result completely untouched — no `media` field at all', async () => {
    const plain = { posts: [{ id: 'p1', title: 'Hello' }], total: 1 };
    const { result, events } = await runImageTool(plain);

    expect(result.output).toEqual(plain);
    const toolResult = toolResultPayload(events);
    expect(toolResult).not.toHaveProperty('media');
  });

  it('leaves a text-only envelope result with no `media` field — nothing to extract', async () => {
    const { events } = await runImageTool({ content: [{ type: 'text', text: 'no image here' }] });
    const toolResult = toolResultPayload(events);
    expect(toolResult).not.toHaveProperty('media');
    expect(toolResult.content).toContain('no image here');
  });

  it('a genuinely unrecognized block type is still withheld via the existing mcp-ui fail-closed path, unaffected by media extraction', async () => {
    const futureBlock = { type: 'some-future-block', value: 'x' };
    const { events } = await runImageTool({ content: [{ type: 'text', text: 'ok' }, futureBlock] });

    const agentPayloads = events.filter((e) => e.kind === 'agent').map((e) => e.payload as { type: string; resource?: unknown });
    const surfaces = agentPayloads.filter((p) => p.type === 'mcp-ui');
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.resource).toEqual(futureBlock);
  });
});
