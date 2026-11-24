// J1+J2 (w3-rtfnd): a spec opts into request headers (Idempotency-Key), host-resolved request facts
// (client address / UA / host) and static response headers (Cache-Control: no-store). Specs that do
// not opt in see exactly the old three-key `RouteInputContext` and no extra response headers.
import express from 'express';
import { describe, expect, it } from 'vitest';
import { err, ok, validationError, type RouteInputContext, type RouteRequestFacts } from '@jini-ai/core/contracts/server';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import type { JsonRoutePorts } from '../types.js';
import { listen } from './route-test-host.js';

const FACTS: RouteRequestFacts = { clientAddress: '203.0.113.9', userAgent: 'probe/1', host: 'shop.example' };

async function hostFor(optional: NonNullable<Parameters<typeof defineJsonRoute<RouteInputContext, RouteInputContext, { n: number }>>[1]>, { workspace404 = false } = {}) {
  const seen: RouteInputContext[] = [];
  const ports: JsonRoutePorts<{ n: number }> = {
    ...optional.ports,
    ...(workspace404 ? { workspace: () => { throw new Error('no workspace'); }, onError: ({ res }) => { res.status(404).json({ error: 'gone' }); } } : {}),
  };
  const route = defineJsonRoute<RouteInputContext, RouteInputContext, { n: number }>({
    method: 'post', path: '/things',
    parse: (raw) => ok({ value: raw }),
    handle: ({ input }) => { seen.push(input); return ok({ value: input }); },
  }, { ...optional, ports });
  const app = express();
  app.use(express.json());
  mountJsonRoute({ app, spec: route, deps: { n: 1 } });
  const base = await listen({ app });
  const post = (headers: Record<string, string> = {}) => fetch(`${base}/things`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"a":1}' });
  return { seen, post };
}

describe('mountJsonRoute request context opt-ins', () => {
  it('without opt-ins hands parse the plain three-key input and sets no extra headers', async () => {
    const host = await hostFor({});
    const response = await host.post({ 'idempotency-key': 'k1' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(Object.keys(host.seen[0]!).sort()).toEqual(['body', 'params', 'query']);
  });

  it('hands only the opted-in headers, lower-cased, and leaves an absent header out', async () => {
    const host = await hostFor({ readHeaders: ['Idempotency-Key', 'DNT', 'x-absent'] });
    await host.post({ 'Idempotency-Key': 'abc', dnt: '1', 'x-other': 'no' });
    expect(host.seen[0]!.headers).toStrictEqual({ 'idempotency-key': 'abc', dnt: '1' });
    expect('facts' in host.seen[0]!).toBe(false);
  });

  it('hands the host-resolved facts only when the spec opts in, resolving them with req and deps', async () => {
    const calls: Array<{ deps: unknown; ua: unknown }> = [];
    const requestFacts: JsonRoutePorts<{ n: number }>['requestFacts'] = ({ req, deps }) => { calls.push({ deps, ua: req.headers['user-agent'] }); return FACTS; };
    const optedIn = await hostFor({ requestFacts: true, ports: { requestFacts } });
    await optedIn.post({ 'user-agent': 'probe/1' });
    expect(optedIn.seen[0]!.facts).toStrictEqual(FACTS);
    expect(calls).toEqual([{ deps: { n: 1 }, ua: 'probe/1' }]);
    expect('headers' in optedIn.seen[0]!).toBe(false);
    const notOpted = await hostFor({ ports: { requestFacts } });
    await notOpted.post();
    expect('facts' in notOpted.seen[0]!).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('throws at mount time when a spec opts into facts without the host resolver port', () => {
    const route = defineJsonRoute<void, object, object>({ method: 'get', path: '/f', parse: () => ok({ value: undefined }), handle: () => ok({ value: {} }) }, { requestFacts: true });
    expect(() => mountJsonRoute({ app: express(), spec: route, deps: {} })).toThrow(/requestFacts/);
  });

  it('sets static response headers on every answer, including a workspace refusal and a returned error', async () => {
    const refused = await hostFor({ responseHeaders: { 'Cache-Control': 'no-store' } }, { workspace404: true });
    const gone = await refused.post();
    expect([gone.status, gone.headers.get('cache-control')]).toEqual([404, 'no-store']);
    const okHost = await hostFor({ responseHeaders: { 'Cache-Control': 'no-store', 'x-robots-tag': 'none' } });
    const answered = await okHost.post();
    expect([answered.status, answered.headers.get('cache-control'), answered.headers.get('x-robots-tag')]).toEqual([200, 'no-store', 'none']);
    const failing = defineJsonRoute<void, object, object>({ method: 'get', path: '/missing', parse: () => ok({ value: undefined }), handle: () => err({ error: validationError({ message: 'none' }) }) }, { responseHeaders: { 'cache-control': 'no-store' } });
    const app = express();
    mountJsonRoute({ app, spec: failing, deps: {} });
    const missing = await fetch(`${await listen({ app })}/missing`);
    expect([missing.status, missing.headers.get('cache-control')]).toEqual([400, 'no-store']);
  });
});
