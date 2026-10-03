import { describe, expect, it, vi } from 'vitest';
import { bindings } from '../bindings.js';
import { createDaemon } from '../daemon.js';
import { definePack } from '../pack.js';
import { manyToken, token } from '../token.js';

// Bypass only the compile-time gate to exercise the runtime startup contract.
const composeUnsafe = createDaemon as (config: any) => ReturnType<typeof createDaemon>;

describe('daemon dependency preflight', () => {
  it('rejects an unused missing singleton before constructing any pack services', () => {
    const dependency = token({ id: 'engine.storage' });
    const firstServices = vi.fn(() => ({}));
    const secondServices = vi.fn(() => ({}));
    const packs = [
      definePack({ name: 'first', deps: [], services: firstServices }),
      definePack({ name: 'second', deps: [dependency], services: secondServices }),
    ];
    expect(() => composeUnsafe({ packs, bindings: bindings({}) })).toThrowError('missing binding: engine.storage');
    expect(firstServices).not.toHaveBeenCalled();
    expect(secondServices).not.toHaveBeenCalled();
  });

  it('rejects an unused incompatible singleton before constructing services', () => {
    const v1 = token({ id: 'engine.storage' }, { version: 1 });
    const v2 = token({ id: 'engine.storage' }, { version: 2 });
    const services = vi.fn(() => ({}));
    const pack = definePack({ name: 'storage', deps: [v2], services });
    expect(() => composeUnsafe({ packs: [pack], bindings: bindings({}).bind({ token: v1, impl: {} }) }))
      .toThrowError('version-incompatible binding: engine.storage expects v2, got v1');
    expect(services).not.toHaveBeenCalled();
  });

  it('preserves empty many bindings and constructs valid packs exactly once in order', () => {
    const singleton = token<string>({ id: 'engine.storage' });
    const extensions = manyToken<string>({ id: 'engine.extensions' });
    const order: string[] = [];
    const packs = [
      definePack({ name: 'first', deps: [singleton], services: (container) => {
        order.push('first');
        return container.get({ token: singleton });
      } }),
      definePack({ name: 'second', deps: [extensions], services: (container) => {
        order.push('second');
        return container.getMany({ token: extensions });
      } }),
    ];
    const daemon = composeUnsafe({ packs, bindings: bindings({}).bind({ token: singleton, impl: 'ready' }) });
    expect(daemon.services).toEqual({ first: 'ready', second: [] });
    expect(order).toEqual(['first', 'second']);
  });
});
