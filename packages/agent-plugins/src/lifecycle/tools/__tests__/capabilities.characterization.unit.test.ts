/**
 * @file Characterization pin written green on the unmodified `../capabilities.ts` before the
 * artifacts capability became optional: a host that gives an artifact store still gets it wrapped
 * (a frozen gate-guarded writer that passes the call through and is revoked with the session).
 */
import { expect, test } from 'vitest';
import { createIssuedTokenMemories, openCapabilitySession, REVOKED_MESSAGE } from '../capabilities.js';
import { fakeCapabilities } from './support.js';

test('a host artifact store is wrapped: frozen, passed through while live, revoked after', async () => {
  let live = true;
  const host = fakeCapabilities({ tokenRequests: [], requests: [] });
  const { capabilities } = openCapabilitySession({ capabilities: host, isLive: () => live, issued: createIssuedTokenMemories().forPlugin({ pluginId: 'acme-office' }), connections: [] });
  expect(capabilities.artifacts).not.toBe(host.artifacts);
  expect(Object.isFrozen(capabilities.artifacts)).toBe(true);
  expect(await capabilities.artifacts!.write({ name: 'a.csv', mediaType: 'text/csv', content: 'a' })).toEqual({ artifactRef: 'artifact:a.csv' });
  live = false;
  await expect(capabilities.artifacts!.write({ name: 'a.csv', mediaType: 'text/csv', content: 'a' })).rejects.toThrow(REVOKED_MESSAGE);
});
