/**
 * @file The generic entity routes through core's in-memory server and a fake `AdminErasedEntityPort`:
 * list/get/create/patch/delete, the error mapping, the body bound, and hostile bodies (400, never 500).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminEntityRowData, AdminErasedEntityPort } from '@jini-ai/admin/core';
import { createInMemoryServer, type InMemoryServer } from '@jini-ai/core/contracts/server/testing';
import { registerEntityRoutes } from './entity-routes.ts';

class CodedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

const descriptor = { name: 'things', labelSingular: 'Thing', labelPlural: 'Things', titleField: 'title', fields: [{ name: 'title', kind: 'text', required: true }] } as const;
const BASE = '/api/entities/things';

function fakePort({ withRemove }: { withRemove: boolean }): { port: AdminErasedEntityPort; calls: string[] } {
  const calls: string[] = [];
  const rows: AdminEntityRowData[] = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }, { id: 'c', title: 'Gamma' }];
  const port: AdminErasedEntityPort = {
    descriptor,
    list: async (query) => { calls.push(`list ${JSON.stringify(query ?? {})}`); return { items: rows.filter((r) => !query?.search || String(r.title).includes(query.search)), nextCursor: null }; },
    get: async (id) => rows.find((r) => r.id === id) ?? null,
    create: async (input) => {
      if (typeof input.title !== 'string' || input.title === '') throw new CodedError('VALIDATION', 'title is required');
      return { id: 'new', title: input.title };
    },
    update: async (id, patch) => {
      if (id === 'gone') throw new CodedError('NOT_FOUND', 'no such thing');
      if (patch.version === 0) throw new CodedError('CONFLICT', 'stale');
      return { id, title: String(patch.title ?? 'kept') };
    },
    ...(withRemove ? { remove: async (id: string) => { calls.push(`remove ${id}`); } } : {}),
  };
  return { port, calls };
}

function serverWith({ withRemove = false, maxBodyBytes }: { withRemove?: boolean; maxBodyBytes?: number } = {}): { memory: InMemoryServer; calls: string[] } {
  const { port, calls } = fakePort({ withRemove });
  const memory = createInMemoryServer();
  registerEntityRoutes({ app: memory.server, port, basePath: BASE }, maxBodyBytes === undefined ? {} : { maxBodyBytes });
  return { memory, calls };
}

const send = (memory: InMemoryServer, method: string, path: string, body?: string) =>
  memory.fetch(new Request(`http://127.0.0.1:1${path}`, { method, ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }) }));
const errorOf = async (response: Response) => ((await response.json()) as { error: { code: string; message: string } }).error;

describe('entity routes: reads', () => {
  it('lists the page as json, passing limit, cursor and search to the port', async () => {
    const { memory, calls } = serverWith();
    const all = await send(memory, 'GET', BASE);
    assert.equal(all.status, 200);
    assert.equal(((await all.json()) as { items: unknown[] }).items.length, 3);
    const found = await send(memory, 'GET', `${BASE}?search=Beta&limit=5&cursor=abc`);
    assert.deepEqual(((await found.json()) as { items: { id: string }[] }).items.map((r) => r.id), ['b']);
    assert.equal(calls[1], 'list {"limit":5,"cursor":"abc","search":"Beta"}');
  });

  it('refuses a limit that is not a positive whole number', async () => {
    const { memory } = serverWith();
    for (const limit of ['0', '-1', '1.5', 'many', '']) {
      const response = await send(memory, 'GET', `${BASE}?limit=${limit}`);
      assert.equal(response.status, 400, limit);
      assert.equal((await errorOf(response)).code, 'BAD_REQUEST');
    }
  });

  it('gets one row, and answers 404 with the standard error for an unknown id', async () => {
    const { memory } = serverWith();
    assert.deepEqual(await (await send(memory, 'GET', `${BASE}/a`)).json(), { id: 'a', title: 'Alpha' });
    const missing = await send(memory, 'GET', `${BASE}/zzz`);
    assert.equal(missing.status, 404);
    assert.equal((await errorOf(missing)).code, 'NOT_FOUND');
  });
});

describe('entity routes: writes and error mapping', () => {
  it('creates with 201 and the row; maps VALIDATION to 400', async () => {
    const { memory } = serverWith();
    const created = await send(memory, 'POST', BASE, JSON.stringify({ title: 'Fresh' }));
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { id: 'new', title: 'Fresh' });
    const invalid = await send(memory, 'POST', BASE, JSON.stringify({}));
    assert.equal(invalid.status, 400);
    assert.equal((await errorOf(invalid)).code, 'VALIDATION');
  });

  it('patches with 200; maps CONFLICT to 409 and NOT_FOUND to 404', async () => {
    const { memory } = serverWith();
    assert.equal((await send(memory, 'PATCH', `${BASE}/a`, JSON.stringify({ title: 'Renamed', version: 1 }))).status, 200);
    const stale = await send(memory, 'PATCH', `${BASE}/a`, JSON.stringify({ title: 'x', version: 0 }));
    assert.equal(stale.status, 409);
    assert.equal((await errorOf(stale)).code, 'CONFLICT');
    assert.equal((await send(memory, 'PATCH', `${BASE}/gone`, JSON.stringify({ title: 'x' }))).status, 404);
  });

  it('answers 400 BAD_REQUEST for invalid JSON', async () => {
    const { memory } = serverWith();
    const response = await send(memory, 'PATCH', `${BASE}/a`, '{"title": ');
    assert.equal(response.status, 400);
    assert.equal((await errorOf(response)).code, 'BAD_REQUEST');
  });

  it('answers 413 for a body over the limit, before the port is called', async () => {
    const { memory, calls } = serverWith({ maxBodyBytes: 64 });
    const response = await send(memory, 'POST', BASE, JSON.stringify({ title: 'x'.repeat(200) }));
    assert.equal(response.status, 413);
    assert.equal((await errorOf(response)).code, 'PAYLOAD_TOO_LARGE');
    assert.deepEqual(calls, []);
  });

  it('lets an error the port did not code escape to the adapter instead of hiding it', async () => {
    const { port } = fakePort({ withRemove: false });
    port.create = async () => { throw new Error('disk exploded'); };
    const memory = createInMemoryServer();
    registerEntityRoutes({ app: memory.server, port, basePath: BASE });
    await assert.rejects(send(memory, 'POST', BASE, JSON.stringify({ title: 'x' })), /disk exploded/);
  });
});

describe('entity routes: delete exists only when the port can remove', () => {
  it('has no DELETE for a port without remove (405: the path exists for other methods)', async () => {
    const { memory } = serverWith({ withRemove: false });
    assert.ok([404, 405].includes((await send(memory, 'DELETE', `${BASE}/a`)).status));
  });

  it('answers 204 for a port with remove', async () => {
    const { memory, calls } = serverWith({ withRemove: true });
    assert.equal((await send(memory, 'DELETE', `${BASE}/a`)).status, 204);
    assert.deepEqual(calls, ['remove a']);
  });
});

describe('entity routes: hostile bodies', () => {
  const hostile: [string, string | undefined][] = [
    ['no body', undefined], ['null', 'null'], ['empty array', '[]'], ['empty object', '{}'], ['zero', '0'],
    ['empty string', '""'], ['true', 'true'], ['a string', '"title"'], ['an array of objects', '[{"title":"x"}]'],
  ];
  for (const [label, body] of hostile) {
    it(`POST with ${label} is a 4xx, never a 5xx`, async () => {
      const { memory } = serverWith();
      const response = await send(memory, 'POST', BASE, body);
      assert.ok(response.status >= 400 && response.status < 500, `${label}: ${response.status}`);
      assert.equal(typeof (await errorOf(response)).code, 'string');
    });
  }
  it('PATCH with a non-object body is a 400', async () => {
    const { memory } = serverWith();
    for (const body of ['null', '[]', '0', '"x"', 'true']) assert.equal((await send(memory, 'PATCH', `${BASE}/a`, body)).status, 400, body);
  });
});
