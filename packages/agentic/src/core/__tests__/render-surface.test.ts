import { describe, expect, test } from 'vitest';
import type { SurfaceEmission, SurfaceExchangeStore } from '@jini-ai/core';
import { renderA2uiSurface } from '../render-surface.js';

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
    const outcome = await renderA2uiSurface({ exchanges, emitSurface: async (emission) => { emitted.push(emission); }, toolId: 't', principalId: 'p', components: tree }, { rejectionGraceMs: 5 });
    expect(outcome).toEqual({ rendered: true });
    expect(emitted).toHaveLength(2);
    expect(JSON.stringify(emitted[0])).toContain('createSurface');
    expect(closed()).toBe(1);
  });

  test('a relayed renderer error is reported with its message, or a generic detail', async () => {
    const withMessage = exchangesWith({ status: 'received', params: { message: { error: { message: 'missing prop' } } } });
    await expect(renderA2uiSurface({ exchanges: withMessage.exchanges, emitSurface: async () => undefined, toolId: 't', principalId: 'p', components: tree }))
      .resolves.toEqual({ rendered: false, reason: 'rejected-by-renderer', detail: 'missing prop' });
    const bare = exchangesWith({ status: 'received', params: { message: { error: {} } } });
    await expect(renderA2uiSurface({ exchanges: bare.exchanges, emitSurface: async () => undefined, toolId: 't', principalId: 'p', components: tree }))
      .resolves.toEqual({ rendered: false, reason: 'rejected-by-renderer', detail: 'The browser rejected this surface.' });
  });

  test('a non-error answer settles at once as rendered; a schema-invalid tree is schema-rejected and still closes', async () => {
    const action = exchangesWith({ status: 'received', params: { message: { action: {} } } });
    await expect(renderA2uiSurface({ exchanges: action.exchanges, emitSurface: async () => undefined, toolId: 't', principalId: 'p', components: tree }))
      .resolves.toEqual({ rendered: true });
    const empty = exchangesWith();
    const outcome = await renderA2uiSurface({ exchanges: empty.exchanges, emitSurface: async () => undefined, toolId: 't', principalId: 'p', components: [] }, { rejectionGraceMs: 5 });
    expect(outcome).toMatchObject({ rendered: false, reason: 'schema-rejected' });
    expect(empty.closed()).toBe(1);
  });
});
