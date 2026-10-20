/**
 * @file Phase-A proof: one plugin connection end to end against a local fake provider —
 * start, consent, callback, status, access token, refresh, disconnect with revocation.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startAcmeProvider, type AcmeProvider } from './fixtures/acme-provider.js';
import { buildHarness, CALLBACK, type Harness } from './fixtures/harness.js';

let provider: AcmeProvider;
let h: Harness;
beforeEach(async () => { provider = await startAcmeProvider(); h = buildHarness(provider); });
afterEach(async () => { await provider.close(); });

it('connects, serves and refreshes an access token, then disconnects with confirmed revocation', async () => {
  const started = await h.service.start({ workspaceId: 'ws-1', actorId: 'actor-1', intent: 'connect', scopeSetIds: ['files'],
    redirectUri: CALLBACK }, { startParams: { pick_mode: 'one' } });
  const url = new URL(started.authorizationUrl);
  expect([url.searchParams.get('scope'), url.searchParams.get('prompt'), url.searchParams.get('pick_mode'),
    url.searchParams.get('code_challenge_method')]).toEqual(['acme.files', 'consent', 'one', 'S256']);

  const callback = provider.approve({ authorizationUrl: started.authorizationUrl, account: 'alice' });
  const completed = await h.service.complete({ workspaceId: 'ws-1', actorId: 'actor-1', redirectUri: CALLBACK,
    callbackParams: { ...callback, picked: 'file-7', undeclared: 'dropped' } });
  expect(completed).toEqual({ connectionRef: started.connectionRef, attemptId: started.attemptId, outcome: 'connected',
    account: { accountId: 'alice', displayName: 'alice at acme' }, grantedScopes: ['acme.files'], callbackFields: { picked: 'file-7' } });
  expect(await h.service.getStatus({ connectionRef: started.connectionRef, workspaceId: 'ws-1' })).toEqual({ connectionRef: started.connectionRef,
    status: 'connected', account: completed.account, grantedScopes: ['acme.files'], pendingSwitch: null });

  expect(await h.service.getAccessToken({ connectionRef: started.connectionRef, workspaceId: 'ws-1' })).toBe('acme-at-1');
  h.clock.now += 3600_000;
  expect(await h.service.getAccessToken({ connectionRef: started.connectionRef, workspaceId: 'ws-1' })).toBe('acme-at-2');

  const disconnected = await h.service.disconnect({ connectionRef: started.connectionRef, workspaceId: 'ws-1' });
  expect([disconnected.status, disconnected.remoteRevocation, provider.revoked]).toEqual(['disconnected', 'confirmed', ['acme-rt-1']]);
  expect(h.tokens.entries.size).toBe(0);
  await expect(h.service.getAccessToken({ connectionRef: started.connectionRef, workspaceId: 'ws-1' })).rejects.toMatchObject({ code: 'not-connected' });
});
