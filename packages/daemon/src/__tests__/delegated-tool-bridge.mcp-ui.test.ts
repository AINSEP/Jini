import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import type { SurfaceEmitter } from '@jini-ai/core';
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
 * The regression being guarded is concrete: a host's `content_post_delete` tool returned a confirmation
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

/**
 * `ctx.emitSurface` — showing a surface the call then WAITS on.
 *
 * The fork tested above reads surfaces out of a COMPLETED result, which is exactly why a handler
 * that must block on a human cannot use it: parking first means the dialog never renders, so the
 * human can never answer, so the park never resolves. That is a deadlock by construction, not a
 * race. These prove the seam that breaks it behaves identically to the return-value route from the
 * renderer's side — same event type, same `toolUseId` — and that it closes when the call does.
 */
describe('emitSurface', () => {
  async function runWithEmitter(handler: (emit: SurfaceEmitter) => Promise<unknown>) {
    const registry = createToolRegistry();
    let captured: SurfaceEmitter | undefined;
    registry.register({
      descriptor: { id: 'assistant_demo_choices' },
      handler: async (ctx) => {
        captured = ctx.emitSurface;
        return handler(ctx.emitSurface!);
      },
      policy: { authorize: () => 'allow' },
    });
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: createToolExecutor({ registry }) });
    const { run } = await lifecycle.start({ contextRef: 'mcp-ui' });

    const result = await bridge.execute({
      runId: run.id,
      toolUseId: 'call-9',
      toolId: 'assistant_demo_choices',
      principal: { id: 'user-1' },
      input: {},
    });

    return { result, events: await collectEvents(lifecycle, run.id), emitAfterSettle: captured! };
  }

  it('emits a mid-call surface under the same event type and toolUseId as a returned one', async () => {
    const { events } = await runWithEmitter(async (emit) => {
      await emit({ channel: 'mcp-ui', payload: { resource: CONFIRMATION_RESOURCE } });
      return { submitted: true, plan: 'pro' };
    });

    const agentPayloads = events.filter((e) => e.kind === 'agent').map((e) => e.payload as { type: string });
    const surfaceEvents = agentPayloads.filter((p) => p.type === 'mcp-ui');
    expect(surfaceEvents).toHaveLength(1);
    // Correlation is the reason this seam lives on the bridge rather than on the executor: only the
    // bridge holds `toolUseId`, and the renderer keys the surface to its call by it.
    expect(surfaceEvents[0]).toMatchObject({ type: 'mcp-ui', toolUseId: 'call-9', resource: CONFIRMATION_RESOURCE });
  });

  /**
   * `payload` used to be spread LAST, over the bridge's own `type` and correlation. A handler could
   * therefore emit `{ channel: 'mcp-ui', payload: { type: 'tool_result', toolUseId: 'call-OTHER' } }`
   * and produce a well-formed event on a channel it was never given, correlated against a different
   * call — the closed `RunAgentPayload` union could not catch it because this seam casts through it.
   * `SurfaceEmission.payload` is documented as merging "beside `type`", so both keys are reserved.
   */
  it("refuses a payload that tries to forge the event type or steal another call's correlation", async () => {
    const { events } = await runWithEmitter(async (emit) => {
      await emit({
        channel: 'mcp-ui',
        payload: { type: 'tool_result', toolUseId: 'call-SOMEONE-ELSE', resource: CONFIRMATION_RESOURCE },
      });
      return { submitted: true };
    });

    const agentPayloads = events
      .filter((e) => e.kind === 'agent')
      .map((e) => e.payload as { type: string; toolUseId?: string });
    const surfaceEvents = agentPayloads.filter((p) => p.type === 'mcp-ui');
    expect(surfaceEvents).toHaveLength(1);
    expect(surfaceEvents[0]).toMatchObject({ type: 'mcp-ui', toolUseId: 'call-9' });
    // The real tool_result is the ONLY tool_result — the forged one must never have been minted.
    expect(agentPayloads.filter((p) => p.type === 'tool_result')).toHaveLength(1);
    expect(agentPayloads.every((p) => p.toolUseId === undefined || p.toolUseId === 'call-9')).toBe(true);
  });

  it('orders the surface before the tool_result, so the dialog is on screen while the call is open', async () => {
    const { events } = await runWithEmitter(async (emit) => {
      await emit({ channel: 'mcp-ui', payload: { resource: CONFIRMATION_RESOURCE } });
      return { submitted: true };
    });

    const types = events.filter((e) => e.kind === 'agent').map((e) => (e.payload as { type: string }).type);
    expect(types.indexOf('mcp-ui')).toBeLessThan(types.indexOf('tool_result'));
    expect(types.indexOf('tool_use')).toBeLessThan(types.indexOf('mcp-ui'));
  });

  it('keeps an emitted surface out of the model-visible result — emitting is not a channel to the model', async () => {
    const { result } = await runWithEmitter(async (emit) => {
      await emit({ channel: 'mcp-ui', payload: { resource: CONFIRMATION_RESOURCE } });
      return { submitted: true, plan: 'pro' };
    });

    // The handler's return value is what the model reads. A surface pushed through `emitSurface`
    // must not appear in it, or the seam becomes a way to put dialog HTML into model context.
    expect(JSON.stringify(result.output)).not.toContain(TOKEN);
    expect(result.output).toEqual({ submitted: true, plan: 'pro' });
  });

  it('refuses to emit once the call has settled', async () => {
    const { emitAfterSettle } = await runWithEmitter(async () => ({ submitted: true }));

    // A handler that stashed the emitter could otherwise paint a surface onto a run whose
    // `tool_result` is already on screen, leaving a dialog with no call left to answer it.
    await expect(emitAfterSettle({ channel: 'mcp-ui', payload: { resource: CONFIRMATION_RESOURCE } })).rejects.toThrow(/already completed/);
  });

  it('carries a non-mcp-ui channel through verbatim, with no toolUseId the schema never declared', async () => {
    const a2uiMessage = { createSurface: { surfaceId: 'exchange-1', root: 'r' } };
    const { events } = await runWithEmitter(async (emit) => {
      await emit({ channel: 'a2ui', payload: { message: a2uiMessage } });
      return 'done';
    });

    const payloads = events.filter((e) => e.kind === 'agent').map((e) => e.payload as Record<string, unknown>);
    const a2ui = payloads.find((p) => p['type'] === 'a2ui');
    expect(a2ui).toEqual({ type: 'a2ui', message: a2uiMessage });
    // Correlation is per-channel, not universal. A2UI correlates by its own `surfaceId`, so
    // injecting `toolUseId` would put a field on the wire the channel's schema does not declare.
    expect(a2ui).not.toHaveProperty('toolUseId');
  });

  it('supports many sends on ONE call — the multi-turn shape a one-shot ask cannot express', async () => {
    const { events } = await runWithEmitter(async (emit) => {
      await emit({ channel: 'a2ui', payload: { message: { createSurface: { surfaceId: 's' } } } });
      await emit({ channel: 'a2ui', payload: { message: { updateComponents: { surfaceId: 's' } } } });
      await emit({ channel: 'a2ui', payload: { message: { deleteSurface: { surfaceId: 's' } } } });
      return 'done';
    });

    // `createSurface` -> `updateComponents` -> `deleteSurface` on a single held-open tool call is
    // exactly what an emitter callable once could not do.
    const kinds = events
      .filter((e) => e.kind === 'agent')
      .map((e) => e.payload as { type: string; message?: Record<string, unknown> })
      .filter((p) => p.type === 'a2ui')
      .map((p) => Object.keys(p.message ?? {})[0]);
    expect(kinds).toEqual(['createSurface', 'updateComponents', 'deleteSurface']);
  });

  it('is absent when the executor is called without one, so a handler can tell it must not park', async () => {
    const registry = createToolRegistry();
    let seen: unknown = 'unset';
    registry.register({
      descriptor: { id: 't' },
      handler: async (ctx) => {
        seen = ctx.emitSurface;
        return 'ok';
      },
      policy: { authorize: () => 'allow' },
    });

    await createToolExecutor({ registry }).execute({ id: 'u' }, { id: 'r' }, 't', {});

    // An always-present no-op would read as "yes, someone will see this" and let a handler park
    // forever on a surface nobody was shown.
    expect(seen).toBeUndefined();
  });
});
