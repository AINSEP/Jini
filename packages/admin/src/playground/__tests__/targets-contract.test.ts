import { expect, it, vi } from 'vitest';
import { createMemoryPlaygroundTargets } from '../adapters/memory.js';
import { runPlaygroundApiConformance } from '../conformance/playground-api.conformance.js';
import * as barrel from '../index.js';
import type { PlaygroundRenderTargetPort } from '../../contracts/playground-render-target.js';

it('reports a throwing listener to the host and still notifies the remaining listeners', () => {
  const onListenerError = vi.fn();
  const targets = createMemoryPlaygroundTargets({}, { onListenerError });
  const failure = new Error('listener broke');
  const after = vi.fn();
  targets.subscribe({ listener: () => { throw failure; } });
  targets.subscribe({ listener: after });
  targets.register({ target: {} });
  expect(onListenerError).toHaveBeenCalledWith({ error: failure });
  expect(after).toHaveBeenCalledTimes(1);
});

it('swallows a throwing listener when the host supplied no error sink', () => {
  const targets = createMemoryPlaygroundTargets({});
  const after = vi.fn();
  targets.subscribe({ listener: () => { throw new Error('ignored'); } });
  targets.subscribe({ listener: after });
  const node = {};
  expect(() => targets.register({ target: node })).not.toThrow();
  expect(targets.getSnapshot().target).toBe(node);
  expect(after).toHaveBeenCalledTimes(1);
});

it('names the first broken contract of a non-conforming target bus', () => {
  const inner = createMemoryPlaygroundTargets({});
  // A bus that lets any stale publisher clear the current target.
  const careless: PlaygroundRenderTargetPort = { ...inner, register: (input) => { inner.register(input); return { release: () => { inner.register({ target: null }); } }; } };
  expect(() => runPlaygroundApiConformance({ targets: careless })).toThrow('Playground conformance: stale publisher cannot clear current target');
});

it('exposes the playground rules from the universal entry', () => {
  expect(barrel.canMountPlayground({ permissions: ['playground.read'] })).toBe(true);
  expect(barrel.canMountPlayground({ permissions: [] })).toBe(false);
});
