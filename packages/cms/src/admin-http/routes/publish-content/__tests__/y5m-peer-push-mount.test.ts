import { expect, it, vi } from 'vitest';
import { registerPublishContentPeerPushRoutes, respondWithPeerActionError } from '../peer-transport.js';
import { createMappedErrorResponse } from '../route-helpers.js';
import { PublishContentPeerNotFoundError } from '../../../../publish/content/peers.js';

it('preserves absent mapper facts and returns a reporter-bound redacted failure', () => {
  const incident = vi.fn(() => ({ status: 500, body: { error: 'Private failure (error bound-id)', requestId: 'bound-id' } }));
  const mapped = createMappedErrorResponse({ incident, operation: 'routes/publish-content/route-helpers' });
  const error = new Error('private credential');
  expect(mapped({ err: error, table: [] })).toEqual({ status: 500, body: { error: 'Private failure (error bound-id)', requestId: 'bound-id' } });
  expect(incident).toHaveBeenCalledWith(error, { operation: 'routes/publish-content/route-helpers', message: undefined, method: undefined, route: undefined, discloseDetails: undefined });
  const json = vi.fn(); incident.mockClear();
  respondWithPeerActionError({ err: new PublishContentPeerNotFoundError({ message: 'missing' }), incident, operation: 'routes/publish-content/route-helpers', json });
  expect(incident).not.toHaveBeenCalled(); expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PEER_NOT_FOUND' }), 404);
});

it('mounts once, preflights before authorization, and isolates overwrite admission per request', async () => {
  const order: string[] = [];
  const routes: { path: string; run(id: string): Promise<unknown> }[] = [];
  let live = false;
  const mount: Parameters<typeof registerPublishContentPeerPushRoutes>[0]['mount'] = input => {
    routes.push({ path: input.spec.path, run: async id => {
      order.push('preflight'); const refusal = input.preflight.check(); if (refusal) return refusal;
      const facts = input.spec.path.endsWith('/confirm') ? {} : { requireOverwriteSession: () => { order.push('overwrite:' + id); } };
      const deps = input.requestDeps(facts as Parameters<typeof input.requestDeps>[0]);
      const parsed = input.spec.parse({ params: { peerId: id }, query: {}, body: { overwriteEntityKeys: ['post:p'], planId: 'plan', planHash: 'hash', bundleId: 'bundle', confirmationToken: 'token' } });
      if (!parsed.ok) throw new Error('parse');
      return input.spec.handle({ input: parsed.value, deps, context: { id: 'owner' }, authorize: async () => { order.push('authorize'); } });
    } });
  };
  registerPublishContentPeerPushRoutes({ mount, canPublishToLive: () => live, liveSiteRefusal: { status: 403, body: { error: 'live' } }, operation: 'routes/publish-content/route-helpers',
    openPeer: async ({ peerId }) => { order.push('open:' + peerId); return {} as Awaited<ReturnType<Parameters<typeof registerPublishContentPeerPushRoutes>[0]['openPeer']>>; },
    plan: async () => ({}), confirm: async () => ({}), execute: async () => ({}),
  });
  expect(routes.map(route => route.path.split('/').at(-1))).toEqual(['plan', 'confirm', 'execute']);
  await routes[0]!.run('denied'); expect(order).toEqual(['preflight']);
  order.length = 0; live = true;
  await routes[0]!.run('one'); await routes[0]!.run('two'); await routes[1]!.run('confirm');
  expect(order).toEqual(['preflight', 'authorize', 'overwrite:one', 'open:one', 'preflight', 'authorize', 'overwrite:two', 'open:two', 'preflight', 'authorize', 'open:confirm']);
});
