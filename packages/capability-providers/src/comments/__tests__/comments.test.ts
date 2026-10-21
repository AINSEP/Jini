import { describe, expect, it } from 'vitest';
import { bindings } from '@jini-ai/core';
import { createCommentsProviderRegistry, freezeCommentsDefinition, CommentsProviderRegistryToken, CommentThreadRendererToken,
  CommentModerationToken, CommentSubmissionToken, CommentsSelectionStoreToken, type CommentsProviderDefinition,
  type CommentsProviderAdapter, type CommentsSelection, type CommentsSelectionStorePort } from '../index.js';

const definition: CommentsProviderDefinition = { id: 'local', label: 'Local', kind: 'stored', consentCategory: 'functional',
  implementation: 'adapter', csp: { scriptSrc: [], styleSrc: [], frameSrc: [], connectSrc: [] },
  settingsSchema: [{ key: 'key', label: 'Key', kind: 'secret', required: true }] };
const adapter: CommentsProviderAdapter = { kind: 'stored', renderer: { renderThread: async () => ({ html: 'approved' }) },
  submission: { submit: async () => ({ ok: true, id: 'c', status: 'pending' }) }, moderation: {
    listQueue: async () => ({ items: [], nextCursor: null }), get: async () => null,
    apply: async () => ({ ok: true }), purge: async () => ({ ok: true }),
  } };
function harness() {
  const rows = new Map<string, CommentsSelection>();
  const selections: CommentsSelectionStorePort = {
    read: async ({ siteId }) => rows.get(siteId) ?? { providerId: null, revision: 0 },
    compareAndSet: async ({ siteId, expectedRevision, providerId }) => {
      const current = rows.get(siteId) ?? { providerId: null, revision: 0 };
      if (current.revision !== expectedRevision) return false;
      rows.set(siteId, { providerId, revision: current.revision + 1 }); return true;
    },
  };
  return { registry: createCommentsProviderRegistry({ selections }), selections };
}
describe('comments provider contract', () => {
  it('copies and freezes nested metadata, refusing invalid identities and metadata', () => {
    const copy = freezeCommentsDefinition({ definition }, {});
    expect(copy).toEqual(definition);
    expect(copy).not.toBe(definition);
    for (const nested of [copy, copy.csp, copy.csp.scriptSrc, copy.csp.styleSrc, copy.csp.frameSrc, copy.csp.connectSrc, copy.settingsSchema, copy.settingsSchema[0]]) expect(Object.isFrozen(nested)).toBe(true);
    for (const patch of [{ id: '../x' }, { label: ' ' }, { kind: 'unknown' }, { consentCategory: 'unknown' }, { implementation: 'unknown' }]) {
      expect(() => freezeCommentsDefinition({ definition: { ...definition, ...patch } as CommentsProviderDefinition })).toThrow(/Invalid comments/);
    }
  });
  it('resolves executable adapters per site; metadata-only registrations cannot execute', async () => {
    const { registry } = harness();
    registry.register({ definition, resolve: async ({ siteId }) => siteId === 'a' ? adapter : undefined });
    registry.register({ definition: { ...definition, id: 'planned', implementation: 'metadata-only' }, resolve: async () => { throw new Error('must never execute'); } });
    expect(registry.has({ providerId: 'local' })).toBe(true);
    expect(registry.has({ providerId: 'missing' }, {})).toBe(false);
    expect(registry.get({ providerId: 'local' }, {})).toEqual(definition);
    expect(registry.get({ providerId: 'missing' })).toBeUndefined();
    expect(Object.isFrozen(registry.list({}))).toBe(true);
    expect(registry.list({}, {})).toHaveLength(2);
    expect(() => registry.register({ definition, resolve: async () => adapter }, {})).toThrow(/Duplicate/);
    expect(await registry.resolve({ siteId: 'a', providerId: 'local' })).toBe(adapter);
    expect(await registry.resolve({ siteId: 'b', providerId: 'local' })).toBeUndefined();
    expect(await registry.resolve({ siteId: 'a', providerId: 'missing' }, {})).toBeUndefined();
    expect(await registry.resolve({ siteId: 'a', providerId: 'planned' })).toBeUndefined();
  });
  it('refuses kind mismatch, missing readiness and stale concurrent selections', async () => {
    const { registry } = harness();
    registry.register({ definition, resolve: async ({ siteId }) => siteId === 'a' ? adapter : undefined });
    registry.register({ definition: { ...definition, id: 'wrong', kind: 'embedded' }, resolve: async () => adapter });
    expect(await registry.active({ siteId: 'a' })).toEqual({ providerId: null, revision: 0, adapter: undefined });
    await expect(registry.resolve({ siteId: 'a', providerId: 'wrong' })).rejects.toThrow(/kind mismatch/);
    await expect(registry.select({ siteId: 'b', providerId: 'local', expectedRevision: 0, actorPrincipalId: 'owner' })).rejects.toThrow(/not ready/);
    const outcomes = await Promise.allSettled([1, 2].map(() => registry.select({ siteId: 'a', providerId: 'local', expectedRevision: 0, actorPrincipalId: 'owner' })));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect(await registry.active({ siteId: 'a' })).toEqual({ providerId: 'local', revision: 1, adapter });
    expect(await registry.active({ siteId: 'b' }, {})).toEqual({ providerId: null, revision: 0, adapter: undefined });
    await registry.select({ siteId: 'a', providerId: null, expectedRevision: 1, actorPrincipalId: 'owner' }, {});
    expect((await registry.active({ siteId: 'a' })).adapter).toBeUndefined();
    const empty = createCommentsProviderRegistry({ selections: harness().selections }, {});
    expect(empty.list({})).toEqual([]);
  });
  it('exports independent typed DI tokens that bind through core', () => {
    const { registry, selections } = harness();
    const tokens = [CommentsProviderRegistryToken, CommentThreadRendererToken, CommentModerationToken, CommentSubmissionToken, CommentsSelectionStoreToken];
    expect(new Set(tokens.map(token => token.id)).size).toBe(5);
    const bound = bindings({}).bind({ token: CommentsProviderRegistryToken, impl: registry })
      .bind({ token: CommentsSelectionStoreToken, impl: selections }).bind({ token: CommentThreadRendererToken, impl: adapter.renderer });
    expect(bound.resolveOne({ token: CommentsProviderRegistryToken })).toBe(registry);
    expect(bound.resolveOne({ token: CommentThreadRendererToken })).toBe(adapter.renderer);
  });
});
