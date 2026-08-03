import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createDelegatedToolBridge } from '../delegated-tool-bridge.js';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';
import { createToolExecutor } from '../tool-executor.js';

/**
 * The model/human fork, end to end through the bridge.
 *
 * `tool-result-surfaces.test.ts` proves the partition function is correct in isolation; this proves
 * the bridge actually applies it — that a UI resource reaches the run's event stream AND is absent
 * from the value returned to the caller (which becomes the model's tool result via
 * `@jini-ai/mcp`'s `okResult()`).
 *
 * The regression being guarded is concrete: Tovu's `content_post_delete` returned a confirmation
 * dialog whose inline script held a single-use token, in the same result the model reads. The model
 * could lift the token from its own tool result and approve its own deletion, with the tool's
 * description still asserting the token "is never shown to you".
 */
const TOKEN = 'single-use-confirmation-token-do-not-leak';

const CONFIRMATION_RESOURCE = {
  type: 'resource',
  resource: {
    uri: 'ui://confirm/delete-post-1',
    mimeType: 'text/html;profile=mcp-app',
    text: `<button id="confirm">Delete</button><script>var TOKEN = ${JSON.stringify(TOKEN)};</script>`,
  },
};

async function collectEvents(lifecycle: ReturnType<typeof createRunLifecycle>, runId: string): Promise<RunProtocolEvent[]> {
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream(runId, (event) => events.push(event));
  return events;
}

async function runDeleteLikeTool(output: unknown) {
  const registry = createToolRegistry();
  registry.register({
    descriptor: { id: 'content_post_delete' },
    handler: async () => output,
    policy: { authorize: () => 'allow' },
  });
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
  const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: createToolExecutor({ registry }) });
  const { run } = await lifecycle.start({ contextRef: 'mcp-ui' });

  const result = await bridge.execute({
    runId: run.id,
    toolUseId: 'call-1',
    toolId: 'content_post_delete',
    principal: { id: 'user-1' },
    input: { id: 'post-1', kind: 'post' },
  });

  return { result, events: await collectEvents(lifecycle, run.id) };
}

describe('DelegatedToolBridge — MCP-UI surface split', () => {
  it('emits the UI resource to the human and withholds it from the model', async () => {
    const { result, events } = await runDeleteLikeTool({
      content: [{ type: 'text', text: 'A confirmation dialog has been shown. NOTHING HAS BEEN DELETED.' }, CONFIRMATION_RESOURCE],
    });

    const agentPayloads = events.filter((e) => e.kind === 'agent').map((e) => e.payload as { type: string });

    // 1. The surface reached the human channel, carrying the resource intact.
    const surfaceEvents = agentPayloads.filter((p) => p.type === 'mcp-ui') as unknown as Array<{ toolUseId: string; resource: unknown }>;
    expect(surfaceEvents).toHaveLength(1);
    expect(surfaceEvents[0]?.resource).toEqual(CONFIRMATION_RESOURCE);
    expect(surfaceEvents[0]?.toolUseId).toBe('call-1');

    // 2. The token is absent from what the model receives — both the returned output and the
    //    `tool_result` event the transcript renders.
    expect(JSON.stringify(result.output)).not.toContain(TOKEN);
    const toolResult = agentPayloads.find((p) => p.type === 'tool_result') as { content: string } | undefined;
    expect(toolResult?.content).toBeDefined();
    expect(toolResult?.content).not.toContain(TOKEN);

    // 3. The model still gets the explanatory text — it must know a dialog is open and to wait.
    expect(toolResult?.content).toContain('NOTHING HAS BEEN DELETED');
  });

  it('emits the surface BEFORE the tool_result so the dialog is on screen when the call completes', async () => {
    const { events } = await runDeleteLikeTool({
      content: [{ type: 'text', text: 'dialog open' }, CONFIRMATION_RESOURCE],
    });
    const types = events.filter((e) => e.kind === 'agent').map((e) => (e.payload as { type: string }).type);
    expect(types.indexOf('mcp-ui')).toBeGreaterThan(types.indexOf('tool_use'));
    expect(types.indexOf('mcp-ui')).toBeLessThan(types.indexOf('tool_result'));
  });

  it('leaves an ordinary tool result completely untouched — no surface events, same output', async () => {
    const plain = { posts: [{ id: 'p1', title: 'Hello' }], total: 1 };
    const { result, events } = await runDeleteLikeTool(plain);

    expect(result.output).toEqual(plain);
    const types = events.filter((e) => e.kind === 'agent').map((e) => (e.payload as { type: string }).type);
    expect(types).not.toContain('mcp-ui');
  });

  it('withholds an UNRECOGNISED block type from the model — fail closed', async () => {
    const futureBlock = { type: 'some-future-ui-block', secret: TOKEN };
    const { result, events } = await runDeleteLikeTool({ content: [{ type: 'text', text: 'ok' }, futureBlock] });

    expect(JSON.stringify(result.output)).not.toContain(TOKEN);
    const surfaces = events
      .filter((e) => e.kind === 'agent')
      .map((e) => e.payload as { type: string })
      .filter((p) => p.type === 'mcp-ui');
    expect(surfaces).toHaveLength(1);
  });
});
