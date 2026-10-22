import type { AgentModelDiscoveryPort, resolveModelForLaunch } from '@jini-ai/agent-runtime';
/** A deterministic metadata port for executor fixture binaries; never reads the real host. */
export const fixtureModelDiscovery: AgentModelDiscoveryPort = {
  async discoverModels({ context }) {
    const id = context.model || 'fixture-model';
    return { models: [{ id, label: id, identityKind: 'concrete' }], source: 'rpc', freshness: 'fresh', fetchedAt: '2026-10-06T00:00:00.000Z', expiresAt: '2026-10-06T00:15:00.000Z', coverage: 'observed', launchFingerprint: 'fixture', diagnostics: [], defaultSelectionId: id };
  },
  async resolveDefaultModel({ context }) {
    return { status: 'resolved', id: context.model || 'fixture-model', source: 'rpc', resolvedAt: '2026-10-06T00:00:00.000Z', launchFingerprint: 'fixture' };
  },
};
/** Unrelated transport tests supply model metadata explicitly and never probe real CLI accounts. */
export const fixtureLaunchModel: typeof resolveModelForLaunch = async ({ context }) => {
  const catalog = await fixtureModelDiscovery.discoverModels({ context });
  const resolution = await fixtureModelDiscovery.resolveDefaultModel({ context, catalog });
  if (resolution.status !== 'resolved') throw new Error('Fixture model must resolve');
  return { model: resolution.id, catalog, resolution };
};
