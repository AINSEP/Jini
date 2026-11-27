import type { VaultSummary } from '@jini-ai/core/contracts/vault';
import { expect, it, vi } from 'vitest';
import { createAgentPluginStateStore, PLUGIN_STATE_MAX_KEYS } from '../plugin-state.js';
import type { AdminSurfacePluginStatePersistence } from '../plugin-state-persistence.js';

const alpha = { workspaceId: 'studio', pluginId: 'sheets-tools' };
const beta = { workspaceId: 'studio', pluginId: 'sheets-tools-v2' };
const scope = { workspaceId: 'studio', kind: 'api-connection', ownerKey: 'installation', principalId: null, binding: null } as const;

function fixture() {
  type Vault = AdminSurfacePluginStatePersistence['vault'];
  type Row = NonNullable<Awaited<ReturnType<Vault['get']>>>;
  const rows = new Map<string, Row>();
  const conflict = new Error('revision conflict');
  const vault = {
    list: vi.fn<Vault['list']>(async actual => {
      expect(actual).toEqual(scope);
      return [...rows.values()].map(row => row.summary);
    }),
    get: vi.fn<Vault['get']>(async ({ id, ...actual }) => {
      expect(actual).toEqual(scope);
      return rows.get(id) ?? null;
    }),
    put: vi.fn<Vault['put']>(async ({ id, expectedRevision, provider, label, meta, payload, ...actual }) => {
      expect(actual).toEqual(scope);
      const prior = rows.get(id)?.summary.revision ?? null;
      if (prior !== expectedRevision) throw conflict;
      const summary: VaultSummary = { ...scope, id, provider, label, meta, revision: (prior ?? 0) + 1, configured: true,
        isDefault: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', last4: null, tokenLength: null };
      rows.set(id, { summary, payload });
      return summary;
    }),
    delete: vi.fn<Vault['delete']>(async ({ id, expectedRevision, ...actual }) => {
      expect(actual).toEqual(scope);
      if (rows.get(id)?.summary.revision !== expectedRevision) throw conflict;
      return rows.delete(id);
    }),
  } satisfies Vault;
  const store = createAgentPluginStateStore({
    persistence: { scope, format: 'setting-v1', vault, isConflict: ({ error }) => error === conflict },
    workspaceId: 'studio', messages: { unavailable: 'Plugin settings are unavailable here.' },
  });
  return { store, vault, conflict };
}

it('scopes settings per plugin, reads updates and exposes sorted revisions without opening values', async () => {
  const { store, vault } = fixture();
  const settings = store.forPlugin(alpha);
  const reader = store.readerFor(alpha);
  expect(await reader.get({ key: 'zeta' })).toBeNull();
  const original = { color: 'jade' };
  await settings.set({ key: 'zeta', value: original });
  original.color = 'amber';
  expect(await reader.get({ key: 'zeta' })).toEqual({ color: 'jade' });
  await settings.set({ key: 'alpha', value: false });
  await settings.set({ key: 'zeta', value: { color: 'violet' } });
  await store.forPlugin(beta).set({ key: 'zeta', value: 'other plugin' });
  expect(await reader.get({ key: 'zeta' })).toEqual({ color: 'violet' });
  expect(await reader.get({ key: 'alpha' })).toBe(false);
  expect(await store.readerFor(beta).get({ key: 'zeta' })).toBe('other plugin');
  vault.get.mockClear();
  expect(await store.describe(alpha)).toEqual({ keys: [{ key: 'alpha', revision: 1 }, { key: 'zeta', revision: 2 }] });
  expect(vault.get.mock.calls).toEqual([]);
  await settings.delete({ key: 'zeta' });
  await settings.delete({ key: 'zeta' });
  expect(await reader.get({ key: 'zeta' })).toBeNull();
  expect(await store.readerFor(beta).get({ key: 'zeta' })).toBe('other plugin');
  expect(vault.delete.mock.calls).toEqual([[{ ...scope, id: 'plugin-state:sheets-tools:zeta', expectedRevision: 2 }]]);
});

it.each([
  { ...alpha, workspaceId: 'other' },
  { ...alpha, pluginId: 'sheets-tools:forged' },
])('refuses scope $workspaceId/$pluginId before reading the vault', async input => {
  const { store, vault } = fixture();
  await expect(store.describe(input)).rejects.toThrow('Plugin settings are unavailable here.');
  await expect(store.readerFor(input).get({ key: 'theme' })).rejects.toThrow('Plugin settings are unavailable here.');
  expect([...vault.list.mock.calls, ...vault.get.mock.calls]).toEqual([]);
});

it('rejects malformed keys and oversized UTF-8 JSON before writing', async () => {
  const { store, vault } = fixture();
  const settings = store.forPlugin(alpha);
  await expect(settings.set({ key: '/theme', value: 'blue' })).rejects.toThrow('A plugin setting key must be 1-128');
  await expect(settings.set({ key: 'theme', value: '🌿'.repeat(4096) })).rejects.toThrow(/A plugin setting may be at most \d+ bytes of JSON/);
  expect(vault.put.mock.calls).toEqual([]);
  expect(await settings.get({ key: 'theme' })).toBeNull();
  const atLimit = '🌿'.repeat(4095) + 'xy';
  await settings.set({ key: 'theme', value: atLimit });
  expect(await settings.get({ key: 'theme' })).toBe(atLimit);
});

it('at the per-plugin key limit replaces an existing key but refuses a new one', async () => {
  const { store } = fixture();
  const settings = store.forPlugin(alpha);
  expect(PLUGIN_STATE_MAX_KEYS).toBe(128);
  for (let index = 0; index < 128; index++) await settings.set({ key: `key-${index}`, value: index });
  await settings.set({ key: 'key-127', value: 'replaced' });
  await expect(settings.set({ key: 'overflow', value: 129 })).rejects.toThrow('A plugin may keep at most 128 settings here.');
  expect(await store.readerFor(alpha).get({ key: 'key-127' })).toBe('replaced');
  expect(await store.readerFor(alpha).get({ key: 'overflow' })).toBeNull();
  await store.forPlugin(beta).set({ key: 'overflow', value: 'different quota' });
  expect(await store.readerFor(beta).get({ key: 'overflow' })).toBe('different quota');
});

it('reports a concurrent save conflict and tolerates a conflicting delete without dropping the value', async () => {
  const { store, vault, conflict } = fixture();
  const settings = store.forPlugin(alpha);
  await settings.set({ key: 'theme', value: 'winner' });
  vault.put.mockRejectedValueOnce(conflict);
  await expect(settings.set({ key: 'theme', value: 'loser' })).rejects.toThrow('This setting changed while it was being saved.');
  vault.delete.mockRejectedValueOnce(conflict);
  await settings.delete({ key: 'theme' });
  expect(await store.readerFor(alpha).get({ key: 'theme' })).toBe('winner');
});

it('does not translate non-conflict persistence failures to successful edits', async () => {
  const { store, vault } = fixture();
  const settings = store.forPlugin(alpha);
  await settings.set({ key: 'theme', value: 'saved' });
  const error = new Error('vault read-only');
  vault.put.mockRejectedValueOnce(error);
  await expect(settings.set({ key: 'theme', value: 'replacement' })).rejects.toBe(error);
  vault.delete.mockRejectedValueOnce(error);
  await expect(settings.delete({ key: 'theme' })).rejects.toBe(error);
  expect(await store.readerFor(alpha).get({ key: 'theme' })).toBe('saved');
});
