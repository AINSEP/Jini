import { describe, expect, test } from 'vitest';
import type { SurfaceEmission, SurfaceExchangeStore } from '@jini-ai/core';
import { A2UI_DISPLAY_ONLY_PROPERTY, createLabCatalog, parseAgentToRendererMessage } from '@jini-ai/protocol/a2ui';
import { renderA2uiSurface } from '../render-surface.js';

// The host supplies the protocol collaborators; the helpers never import them.
const protocol = { parseAgentMessage: parseAgentToRendererMessage };
const renderProtocol = { ...protocol, catalog: createLabCatalog({}), displayOnlyProperty: A2UI_DISPLAY_ONLY_PROPERTY };

/** Minimal exchange double: records emissions, answers `receive` with a scripted message or never. */
function exchangesWith(answer?: unknown): { exchanges: SurfaceExchangeStore; closed: () => number } {
  let closed = 0;
  const exchange = {
    id: 'surface-1',
    receive: () => answer === undefined ? new Promise(() => undefined) : Promise.resolve(answer),
    close: () => { closed += 1; },
  };
  return { exchanges: { open: () => exchange } as unknown as SurfaceExchangeStore, closed: () => closed };
}

const tree = [{ id: 'root', component: 'Text', text: 'hi' }];

describe('renderA2uiSurface', () => {
  test('silence within the grace period means rendered; the surface is display-only and the exchange closes', async () => {
    const emitted: SurfaceEmission[] = [];
    const { exchanges, closed } = exchangesWith();
    const outcome = await renderA2uiSurface({ exchanges, emitSurface: async (emission) => { emitted.push(emission); }, toolId: 't', principalId: 'p', components: tree, ...renderProtocol }, { rejectionGraceMs: 5 });
    expect(outcome).toEqual({ rendered: true });
    expect(emitted).toHaveLength(2);
    expect(JSON.stringify(emitted[0])).toContain('createSurface');
    expect(closed()).toBe(1);
  });

  test('a relayed renderer error is reported with its message, or a generic detail', async () => {
    const withMessage = exchangesWith({ status: 'received', params: { message: { error: { message: 'missing prop' } } } });
    await expect(renderA2uiSurface({ exchanges: withMessage.exchanges, emitSurface: async () => undefined, toolId: 't', principalId: 'p', components: tree, ...renderProtocol }))
      .resolves.toEqual({ rendered: false, reason: 'rejected-by-renderer', detail: 'missing prop' });
    const bare = exchangesWith({ status: 'received', params: { message: { error: {} } } });
    await expect(renderA2uiSurface({ exchanges: bare.exchanges, emitSurface: async () => undefined, toolId: 't', principalId: 'p', components: tree, ...renderProtocol }))
      .resolves.toEqual({ rendered: false, reason: 'rejected-by-renderer', detail: 'The browser rejected this surface.' });
  });

  test('a non-error answer settles at once as rendered; a schema-invalid tree is schema-rejected and still closes', async () => {
    const action = exchangesWith({ status: 'received', params: { message: { action: {} } } });
    await expect(renderA2uiSurface({ exchanges: action.exchanges, emitSurface: async () => undefined, toolId: 't', principalId: 'p', components: tree, ...renderProtocol }))
      .resolves.toEqual({ rendered: true });
    const empty = exchangesWith();
    const outcome = await renderA2uiSurface({ exchanges: empty.exchanges, emitSurface: async () => undefined, toolId: 't', principalId: 'p', components: [], ...renderProtocol }, { rejectionGraceMs: 5 });
    expect(outcome).toMatchObject({ rendered: false, reason: 'schema-rejected' });
    expect(empty.closed()).toBe(1);
  });
});

describe('a2uiActionOf', () => {
  test('reads an action payload and refuses to guess at any other shape', async () => {
    const { a2uiActionOf } = await import('../render-surface.js');
    const action = { name: 'go', surfaceId: 's', sourceComponentId: 'b', timestamp: 't', context: { step: 1 } };
    expect(a2uiActionOf({ params: { message: { action } } })).toEqual(action);
    expect(a2uiActionOf({ params: { message: { error: { message: 'x' } } } })).toBeUndefined();
    expect(a2uiActionOf({ params: { message: null } })).toBeUndefined();
    expect(a2uiActionOf({ params: {} })).toBeUndefined();
  });
});

describe('validatedA2uiMessage', () => {
  test('returns a valid message as parsed and refuses an invalid one by label', async () => {
    const { validatedA2uiMessage } = await import('../render-surface.js');
    const valid = { version: 'v1.0', deleteSurface: { surfaceId: 's1' } };
    expect(validatedA2uiMessage({ message: valid, label: 'tool_x', ...protocol })).toEqual(valid);
    expect(() => validatedA2uiMessage({ message: { version: 'v1.0', deleteSurface: {} }, label: 'tool_x', ...protocol }))
      .toThrow(/^tool_x: refusing to emit a message that fails its own schema: /);
  });
});

describe('withA2uiExchange', () => {
  function recordingExchanges(answers: unknown[]) {
    const bindings: unknown[] = [];
    let closed = 0;
    const exchange = { id: 'surface-9', receive: () => Promise.resolve(answers.shift() ?? { status: 'abandoned' }), close: () => { closed += 1; } };
    const exchanges = { open: (args: { binding: unknown }) => { bindings.push(args.binding); return exchange; } } as unknown as SurfaceExchangeStore;
    return { exchanges, bindings, closed: () => closed };
  }

  test('binds the a2ui channel, emits validated messages, exposes surfaceId=exchange id and always closes', async () => {
    const { withA2uiExchange } = await import('../render-surface.js');
    const emitted: SurfaceEmission[] = [];
    const { exchanges, bindings, closed } = recordingExchanges([{ status: 'received', params: {} }]);
    const controller = new AbortController();
    const result = await withA2uiExchange({ exchanges, emitSurface: async (e) => { emitted.push(e); }, toolId: 't', principalId: 'p', signal: controller.signal, ...protocol,
      run: async ({ surfaceId, emit, receive }) => {
        await emit({ version: 'v1.0', deleteSurface: { surfaceId } });
        return { surfaceId, first: await receive() };
      } });
    expect(result).toEqual({ surfaceId: 'surface-9', first: { status: 'received', params: {} } });
    expect(bindings).toEqual([{ toolId: 't', principalId: 'p', channel: 'a2ui' }]);
    expect(emitted).toEqual([{ channel: 'a2ui', payload: { message: { version: 'v1.0', deleteSurface: { surfaceId: 'surface-9' } } } }]);
    expect(closed()).toBe(1);
  });

  test('an invalid outgoing message throws by tool id and still closes; an abort closes early', async () => {
    const { withA2uiExchange } = await import('../render-surface.js');
    const first = recordingExchanges([]);
    await expect(withA2uiExchange({ exchanges: first.exchanges, emitSurface: async () => undefined, toolId: 'tool_y', principalId: 'p', signal: new AbortController().signal, ...protocol,
      run: async ({ emit }) => emit({ version: 'v1.0', deleteSurface: {} } as never) })).rejects.toThrow(/^tool_y: refusing/);
    expect(first.closed()).toBe(1);

    const second = recordingExchanges([]);
    const controller = new AbortController();
    await withA2uiExchange({ exchanges: second.exchanges, emitSurface: async () => undefined, toolId: 't', principalId: 'p', signal: controller.signal, ...protocol,
      run: async () => { controller.abort(); return second.closed(); } }).then((closedDuringRun) => expect(closedDuringRun).toBe(1));
    expect(second.closed()).toBe(2);
  });
});
