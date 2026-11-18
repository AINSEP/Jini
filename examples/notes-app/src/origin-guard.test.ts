/**
 * @file The Host/Origin guard: one fully valid request, then one broken clause at a time, and proof
 * that every route `registerNotesApp` registers sits behind it.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withServerMiddleware, type ServerMethod, type ServerRoute } from '@jini-ai/core/contracts/server';
import { createInMemoryServer, type InMemoryServer } from '@jini-ai/core/contracts/server/testing';
import { createOriginGuard } from './gaps/origin-guard.ts';
import { openAppDatabase } from './db.ts';
import { registerNotesApp } from './app.ts';

const PORT = 4321;
const GOOD_HOST = `127.0.0.1:${PORT}`;

function guardedServer(): InMemoryServer {
  const memory = createInMemoryServer();
  const guarded = withServerMiddleware({ server: memory.server, middleware: [createOriginGuard({ port: () => PORT })] });
  for (const method of ['GET', 'POST'] as const) {
    guarded.route({ method, path: '/probe', handler: () => new Response('reached') });
  }
  return memory;
}

async function send(
  memory: InMemoryServer,
  { method = 'POST', headers = {} }: { method?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return memory.fetch(new Request(`http://${GOOD_HOST}/probe`, { method, headers }));
}

async function assertRefused(response: Response, code: string): Promise<void> {
  assert.equal(response.status, 403);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  const body = await response.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, code);
  assert.notEqual(body.error.message, '');
}

describe('origin guard clauses', () => {
  const memory = guardedServer();

  it('passes a fully valid same-origin POST', async () => {
    const response = await send(memory, { headers: { host: GOOD_HOST, origin: `http://${GOOD_HOST}`, 'sec-fetch-site': 'same-origin' } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'reached');
  });

  it('refuses a foreign Origin on POST', async () => {
    await assertRefused(await send(memory, { headers: { host: GOOD_HOST, origin: 'https://evil.example' } }), 'ORIGIN_REJECTED');
  });

  it('refuses a foreign Origin that merely names the right port', async () => {
    await assertRefused(await send(memory, { headers: { host: GOOD_HOST, origin: `http://evil.example:${PORT}` } }), 'ORIGIN_REJECTED');
  });

  it('refuses the opaque Origin "null"', async () => {
    await assertRefused(await send(memory, { headers: { host: GOOD_HOST, origin: 'null' } }), 'ORIGIN_REJECTED');
  });

  it('refuses a Host that is not loopback with the bound port, for GET too', async () => {
    for (const method of ['POST', 'GET']) {
      await assertRefused(await send(memory, { method, headers: { host: `evil.example:${PORT}` } }), 'HOST_REJECTED');
      await assertRefused(await send(memory, { method, headers: { host: '127.0.0.1:9999' } }), 'HOST_REJECTED');
    }
  });

  it('refuses a request with no Host header', async () => {
    await assertRefused(await send(memory, { method: 'GET' }), 'HOST_REJECTED');
  });

  it('allows a POST without Origin from a same-Host non-browser client, with or without Sec-Fetch-Site same-origin/none', async () => {
    for (const site of [undefined, 'same-origin', 'none']) {
      const headers: Record<string, string> = { host: `localhost:${PORT}`, ...(site ? { 'sec-fetch-site': site } : {}) };
      assert.equal((await send(memory, { headers })).status, 200, String(site));
    }
  });

  it('refuses a POST without Origin when Sec-Fetch-Site is cross-site', async () => {
    await assertRefused(await send(memory, { headers: { host: GOOD_HOST, 'sec-fetch-site': 'cross-site' } }), 'ORIGIN_REJECTED');
  });

  it('answers a GET navigation that carries Sec-Fetch-Site cross-site (a link click) if the Host is right', async () => {
    assert.equal((await send(memory, { method: 'GET', headers: { host: GOOD_HOST, 'sec-fetch-site': 'cross-site' } })).status, 200);
  });

  it('refuses everything while the server has no bound port yet', async () => {
    const early = createInMemoryServer();
    withServerMiddleware({ server: early.server, middleware: [createOriginGuard({ port: () => 0 })] })
      .route({ method: 'GET', path: '/probe', handler: () => new Response('reached') });
    await assertRefused(await send(early, { method: 'GET', headers: { host: GOOD_HOST } }), 'HOST_REJECTED');
  });
});

describe('every notes app route is behind the guard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-guard-test-'));
  const routes: ServerRoute[] = [];
  let memory: InMemoryServer;
  let closeDb: () => void = () => {};

  before(async () => {
    const database = await openAppDatabase({ filePath: join(dir, 'notes.db') });
    closeDb = database.close;
    memory = createInMemoryServer();
    const recording = { route: (route: ServerRoute) => { routes.push(route); memory.server.route(route); } };
    await registerNotesApp({ app: recording, kernel: database.kernel, port: () => PORT });
  });
  after(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a foreign Origin and a foreign Host on every registered route and method', async () => {
    assert.ok(routes.length >= 8, `expected the app's routes to be registered (got ${routes.length})`);
    for (const { method, path } of routes) {
      const url = `http://${GOOD_HOST}${path.replace(/:\w+/g, 'x')}`;
      const attempt = (headers: Record<string, string>, m: ServerMethod = method) => memory.fetch(new Request(url, { method: m, headers }));
      assert.equal((await attempt({ host: GOOD_HOST, origin: 'https://evil.example' })).status, 403, `${method} ${path} foreign Origin`);
      assert.equal((await attempt({ host: 'evil.example:4321' })).status, 403, `${method} ${path} foreign Host`);
    }
  });
});
