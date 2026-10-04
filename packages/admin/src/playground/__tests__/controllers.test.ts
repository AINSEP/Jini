import { expect, it } from 'vitest';
import { createMemoryPlaygroundTargets } from '../adapters/memory.js';
import { createPlaygroundController } from '../controllers/playground.controller.js';
import { runPlaygroundApiConformance } from '../conformance/playground-api.conformance.js';
it('holds the canvas until detach and disposal without rerender notification storms', () => {
  const targets = createMemoryPlaygroundTargets({}); const seen: unknown[] = [];
  targets.subscribe({ listener: () => seen.push(targets.getSnapshot().target) });
  const controller = createPlaygroundController({ targets, permissions: ['playground.read'] });
  const node = {}; controller.attach({ target: node }); controller.attach({ target: node });
  expect(seen).toEqual([node]); controller.attach({ target: null });
  expect(seen).toEqual([node, null]); controller.attach({ target: node }); controller.dispose({});
  expect(targets.getSnapshot().target).toBeNull(); controller.attach({ target: {} });
  expect(targets.getSnapshot().target).toBeNull();
});
it('fails closed without grants', () => {
  const targets = createMemoryPlaygroundTargets({}); const controller = createPlaygroundController({ targets });
  controller.attach({ target: {} }); expect(targets.getSnapshot().target).toBeNull(); controller.dispose({});
});
it('a retiring controller cannot clear another page target', () => {
  const targets = createMemoryPlaygroundTargets({}), permissions = ['playground.read'];
  const a = createPlaygroundController({ targets, permissions }), b = createPlaygroundController({ targets, permissions });
  a.attach({ target: {} }); const next = {}; b.attach({ target: next }); a.dispose({});
  expect(targets.getSnapshot().target).toBe(next); b.dispose({}); expect(targets.getSnapshot().target).toBeNull();
});
it('runs memory conformance and keeps admin scopes independent', () => {
  expect(runPlaygroundApiConformance({ targets: createMemoryPlaygroundTargets({}) })).toHaveLength(8);
  const a = createMemoryPlaygroundTargets({}), b = createMemoryPlaygroundTargets({});
  a.register({ target: {} }); expect(b.getSnapshot().target).toBeNull(); a.dispose({});
  expect(a.getSnapshot().target).toBeNull(); expect(() => a.register({ target: {} })).toThrow('disposed');
});
