import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import { checkReadOnlyTool } from '../../read-only-tools.js';
import { validationError } from '@jini-ai/http-kit';
import { cancelRunsOwnedBy } from '../cancel-owned-runs.js';
import { connectorsPaymentsChargeRoute } from '../connectors.js';
import { mediaGenerateRoute, type MediaHttpDeps } from '../media.js';

describe('merged package contracts', () => {
  it('publishes every subpath with matching Node runtime metadata and source entry', () => {
    const root = new URL('../../../', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
    for (const subpath of ['.', './http', './read-only-tools', './run-credentials']) {
      expect(manifest.jini.entries[subpath]).toBe('node');
      const entry = manifest.exports[subpath];
      expect(entry.default).toBe(entry.import);
      expect(entry.types).toBe(entry.import.replace(/\.js$/, '.d.ts'));
      expect(existsSync(fileURLToPath(new URL(entry.import.replace('./dist/', './src/').replace(/\.js$/, '.ts'), root)))).toBe(true);
    }
    expect(manifest.exports['./settings']).toBeUndefined();
  });

  it('preserves validation details through the reshaped protocol error helper', () => {
    expect(validationError({ message: 'invalid' }, { issues: [{ path: 'id', message: 'required' }] })).toEqual({
      code: 'BAD_REQUEST', message: 'invalid', details: { kind: 'validation', issues: [{ path: 'id', message: 'required' }] },
    });
  });

  it('checks current registry descriptors and fails closed for unknown tools', () => {
    const registry = createToolRegistry({});
    registry.register({ descriptor: { id: 'read', description: 'Read', readOnly: true }, handler: async () => 'value', policy: { authorize: () => 'allow' } });
    const messages = { unverifiableMessage: 'missing registry', toolRefusalMessage: ({ toolId }: { toolId: string }) => `denied ${toolId}` };
    expect(checkReadOnlyTool({ registry, toolId: 'read', messages })).toBeNull();
    expect(checkReadOnlyTool({ registry, toolId: 'missing', messages })).toBe('denied missing');
    expect(checkReadOnlyTool({ registry: undefined, toolId: 'read', messages })).toBe('missing registry');
  });

  it('passes payment descriptions separately from required charge fields', async () => {
    const charge = vi.fn(async () => ({ id: 'charge', status: 'succeeded' as const, amountCents: 100, currency: 'usd', customerRef: 'customer', createdAt: 1 }));
    await connectorsPaymentsChargeRoute.handle({ input: { amountCents: 100, currency: 'usd', customerRef: 'customer', description: 'memo' }, deps: { payments: { charge, getCharge: async () => null, refund: async () => { throw new Error('unused'); } } } });
    expect(charge).toHaveBeenCalledWith({ amountCents: 100, currency: 'usd', customerRef: 'customer' }, { description: 'memo' });
  });

  it('keeps cancellation scoped and excludes terminal runs even across partial failures', async () => {
    const list = vi.fn(async () => [{ id: 'active', state: 'running' as const }, { id: 'done', state: 'succeeded' as const }, { id: 'other-active', state: 'running' as const }]);
    const cancel = vi.fn(async ({ runId }: { runId: string }) => { if (runId === 'active') throw new Error('already gone'); });
    await cancelRunsOwnedBy({ runs: { list, cancel }, contextRef: 'context' });
    expect(list).toHaveBeenCalledWith({}, { contextRef: 'context' });
    expect(cancel.mock.calls).toEqual([[{ runId: 'active' }], [{ runId: 'other-active' }]]);
  });

  it('passes media identity and generation options in separate objects', async () => {
    const generate = vi.fn(async () => ({ bytes: Buffer.from('image'), providerId: 'provider', providerNote: 'done', usedStubFallback: false, warnings: [] }));
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const task = { id: 'task', ownerRef: 'owner', status: 'queued' as const, progress: [], file: null, error: null, startedAt: 1, endedAt: null, createdAt: 1, updatedAt: 1 };
    const deps: MediaHttpDeps = { engine: { generate }, taskStore: { create: async () => task, get: async () => task, delete: async () => {}, listByOwner: async () => [], update: async ({ patch }) => { if (patch.status === 'done') resolveDone(); return task; } } };
    await mediaGenerateRoute.handle({ input: { ownerRef: 'owner', request: { surface: 'image', model: 'model', prompt: 'hello', aspect: 'square' } }, deps });
    await done;
    expect(generate).toHaveBeenCalledWith({ surface: 'image', model: 'model' }, { prompt: 'hello', aspect: 'square' });
  });
});
