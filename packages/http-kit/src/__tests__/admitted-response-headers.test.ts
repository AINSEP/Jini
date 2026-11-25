// `admittedResponseHeaders`: request-dependent response headers, set right after the workspace port
// admitted the request — so the workspace refusal never carries them, and every later answer does
// (a returned refusal, a thrown authorization/handler failure, the success). A spec without it writes
// nothing extra, exactly as before the opt-in existed.
import express from 'express';
import { describe, expect, it } from 'vitest';
import { err, ok, validationError, type RouteInputContext } from '@jini-ai/core/contracts/server';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import { defineRawRoute, mountRawRoute } from '../raw-route.js';
import type { JsonRoutePorts } from '../types.js';
import { listen } from './route-test-host.js';

type Deps = { n: number };
const documentsOnly = (raw: RouteInputContext) => (raw.query.kind === 'document' ? { 'Cache-Control': 'private, no-store' } : undefined);

/** Ports whose workspace refuses `?ws=other` (404) and whose authenticate throws on `?auth=fail` (500). */
function portsFor(seen: RouteInputContext[] = []): JsonRoutePorts<Deps> {
  return {
    workspace: ({ raw }) => { if (raw.query.ws === 'other') throw Object.assign(new Error('no workspace'), { status: 404 }); },
    authenticate: ({ raw }) => { seen.push(raw); if (raw.query.auth === 'fail') throw Object.assign(new Error('auth'), { status: 500 }); return undefined; },
    onError: ({ res, error }) => { res.status((error as { status?: number }).status ?? 500).json({ error: 'refused' }); },
  };
}

async function jsonHost(optional: { admittedResponseHeaders?: typeof documentsOnly } = {}) {
  const route = defineJsonRoute<string, object, Deps>({
    method: 'get', path: '/media',
    parse: (raw) => ok({ value: String(raw.query.kind ?? 'media') }),
    handle: ({ input }) => (input === 'bad' ? err({ error: validationError({ message: 'bad' }) }) : ok({ value: { kind: input } })),
  }, { ...optional, ports: portsFor() });
  const app = express();
  mountJsonRoute({ app, spec: route, deps: { n: 1 } });
  const base = await listen({ app });
  return async (query: string) => {
    const response = await fetch(`${base}/media?${query}`);
    return [response.status, response.headers.get('cache-control')];
  };
}

describe('admittedResponseHeaders', () => {
  it('JSON mount: absent on the workspace refusal, present on every later answer, only when the function names headers', async () => {
    const get = await jsonHost({ admittedResponseHeaders: documentsOnly });
    expect(await get('kind=document&ws=other')).toEqual([404, null]);
    expect(await get('kind=document')).toEqual([200, 'private, no-store']);
    expect(await get('kind=document&auth=fail')).toEqual([500, 'private, no-store']);
    expect(await get('kind=media')).toEqual([200, null]);
    expect(await get('kind=bad')).toEqual([400, null]);
  });

  it('JSON mount without the opt-in writes no extra header on any answer', async () => {
    const get = await jsonHost();
    expect(await get('kind=document')).toEqual([200, null]);
    expect(await get('kind=document&auth=fail')).toEqual([500, null]);
  });

  it('raw mount: the same placement — after the workspace port, before authenticate and handle', async () => {
    const seen: RouteInputContext[] = [];
    const route = defineRawRoute<Deps>({ method: 'get', path: '/doc', handle: async () => new Response('x') }, { ports: portsFor(seen), admittedResponseHeaders: documentsOnly });
    const app = express();
    mountRawRoute({ app, spec: route, deps: { n: 1 } });
    const base = await listen({ app });
    const get = async (query: string) => { const response = await fetch(`${base}/doc?${query}`); return [response.status, response.headers.get('cache-control')]; };
    expect(await get('kind=document&ws=other')).toEqual([404, null]);
    expect(await get('kind=document&auth=fail')).toEqual([500, 'private, no-store']);
    expect(await get('kind=document')).toEqual([200, 'private, no-store']);
    expect(await get('kind=media')).toEqual([200, null]);
    expect(seen.map((raw) => raw.query.kind)).toEqual(['document', 'document', 'media']);
  });
});
