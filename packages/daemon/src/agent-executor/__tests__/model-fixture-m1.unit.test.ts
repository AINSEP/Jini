import { afterEach, expect, it, vi } from 'vitest';
import { fixtureLaunchModel, fixtureModelDiscovery } from './model-discovery-fixture.js';

afterEach(() => { vi.restoreAllMocks(); });
const context = { executable: '/fixture/cli', cwd: '/fixture', env: {} };
const def = { id: 'fixture', ...fixtureModelDiscovery };

it('keeps the deterministic launch catalog and default resolution in agreement', async () => {
  const result = await fixtureLaunchModel({ def, context });
  expect(result).toEqual({ model: 'fixture-model', catalog: {
    models: [{ id: 'fixture-model', label: 'fixture-model', identityKind: 'concrete' }],
    source: 'rpc', freshness: 'fresh', fetchedAt: '2026-10-06T00:00:00.000Z', expiresAt: '2026-10-06T00:15:00.000Z',
    coverage: 'observed', launchFingerprint: 'fixture', diagnostics: [], defaultSelectionId: 'fixture-model',
  }, resolution: { status: 'resolved', id: 'fixture-model', source: 'rpc', resolvedAt: '2026-10-06T00:00:00.000Z', launchFingerprint: 'fixture' } });
});

it('refuses a broken discovery fake rather than letting transport tests launch with an unresolved model', async () => {
  vi.spyOn(fixtureModelDiscovery, 'resolveDefaultModel').mockResolvedValueOnce({ status: 'unresolved', reason: 'broken fixture' });
  await expect(fixtureLaunchModel({ def, context })).rejects.toThrow('Fixture model must resolve');
});
