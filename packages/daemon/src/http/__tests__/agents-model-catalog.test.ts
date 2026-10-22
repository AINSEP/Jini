import { describe, expect, it } from 'vitest';
import { agentListRoute, agentRescanRoute, type AgentSummary } from '../agents.js';
const agents: readonly AgentSummary[] = [{ id: 'gemini', name: 'Retired' }, {
  id: 'antigravity', name: 'Antigravity', models: [{ id: 'google-new', label: 'Google New', identityKind: 'concrete' }],
  modelCatalog: { models: [{ id: 'google-new', label: 'Google New', identityKind: 'concrete' }], source: 'cli', freshness: 'fresh', fetchedAt: '2026-10-06T00:00:00.000Z', expiresAt: '2026-10-06T00:15:00.000Z', coverage: 'account', launchFingerprint: 'scope', diagnostics: [] },
  defaultModelResolution: { status: 'resolved', id: 'google-new', source: 'config-file', resolvedAt: '2026-10-06T00:00:00.000Z', launchFingerprint: 'scope' },
}];
describe('/api/agents model catalogs', () => {
  it('preserves catalog provenance/default resolution and filters retired entries on list and rescan', async () => {
    const deps = { listAgents: () => agents, rescanAgents: () => agents };
    for (const route of [agentListRoute, agentRescanRoute]) {
      const result = await route.handle({ input: undefined, deps });
      expect(result).toEqual({ ok: true, value: { agents: [agents[1]] } });
      expect(JSON.stringify(result)).not.toContain('gemini');
    }
  });
});
