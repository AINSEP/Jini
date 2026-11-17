/** @file The note entity API end to end: registerNotesApp, temp SQLite, the guard in front, a stale client. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryServer, type InMemoryServer } from '@jini-ai/core/contracts/server/testing';
import { openAppDatabase } from './db.ts';
import { registerNotesApp } from './app.ts';

const HOST = '127.0.0.1:3000';
type Row = { id: string; title: string; slug: string; body: string; status: string; version: number };

describe('note entity API', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-entities-test-'));
  let memory: InMemoryServer;
  let closeDb: () => void = () => {};

  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    memory.fetch(new Request(`http://${HOST}${path}`, {
      method, headers: { host: HOST, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  const rows = async (query = ''): Promise<Row[]> => ((await (await call('GET', `/api/entities/note${query}`)).json()) as { items: Row[] }).items;

  before(async () => {
    const database = await openAppDatabase({ filePath: join(dir, 'notes.db') });
    closeDb = database.close;
    memory = createInMemoryServer();
    await registerNotesApp({ app: memory.server, kernel: database.kernel, port: () => 3000 });
  });
  after(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

  it('answers the fixed local-owner session', async () => {
    assert.deepEqual(await (await call('GET', '/api/session')).json(), { user: { id: 'local-owner', username: 'owner' } });
  });

  it('creates, lists, searches, edits and publishes a note over JSON', async () => {
    const created = await call('POST', '/api/entities/note', { title: 'Groceries', body: 'milk and eggs' });
    assert.equal(created.status, 201);
    const note = await created.json() as Row;
    assert.deepEqual({ slug: note.slug, status: note.status, version: note.version }, { slug: 'groceries', status: 'draft', version: 1 });
    await call('POST', '/api/entities/note', { title: 'Work', body: 'ship it' });
    assert.equal((await rows()).length, 2);
    assert.deepEqual((await rows('?search=MILK')).map((r) => r.title), ['Groceries']);
    const edited = await call('PATCH', `/api/entities/note/${note.id}`, { title: 'Groceries 2', status: 'published', version: 1 });
    assert.equal(edited.status, 200);
    const editedRow = await edited.json() as Row;
    assert.deepEqual({ id: editedRow.id, title: editedRow.title, status: editedRow.status, version: editedRow.version }, { id: note.id, title: 'Groceries 2', status: 'published', version: 3 });
    assert.deepEqual(await (await call('GET', `/api/entities/note/${note.id}`)).json(), editedRow);
  });

  it('a stale client gets 409 CONFLICT and the stored row is unchanged', async () => {
    const note = await (await call('POST', '/api/entities/note', { title: 'Shared' })).json() as Row;
    assert.equal((await call('PATCH', `/api/entities/note/${note.id}`, { title: 'First', version: 1 })).status, 200);
    const stale = await call('PATCH', `/api/entities/note/${note.id}`, { title: 'Second', version: 1 });
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as { error: { code: string } }).error.code, 'CONFLICT');
    assert.equal(((await (await call('GET', `/api/entities/note/${note.id}`)).json()) as Row).title, 'First');
  });

  it('answers 404 for an unknown note and 400 for a missing version, a bad status and invalid JSON', async () => {
    assert.equal((await call('GET', '/api/entities/note/nope')).status, 404);
    assert.equal((await call('PATCH', '/api/entities/note/nope', { title: 'x', version: 1 })).status, 404);
    const note = await (await call('POST', '/api/entities/note', { title: 'Strict' })).json() as Row;
    assert.equal((await call('PATCH', `/api/entities/note/${note.id}`, { title: 'x' })).status, 400);
    assert.equal((await call('PATCH', `/api/entities/note/${note.id}`, { status: 'banana', version: 1 })).status, 400);
    const broken = await memory.fetch(new Request(`http://${HOST}/api/entities/note/${note.id}`, { method: 'PATCH', headers: { host: HOST, 'content-type': 'application/json' }, body: '{"title":' }));
    assert.equal(broken.status, 400);
  });

  it('there is no delete: entries have none', async () => {
    const note = await (await call('POST', '/api/entities/note', { title: 'Keep' })).json() as Row;
    assert.equal((await call('DELETE', `/api/entities/note/${note.id}`)).status, 405);
  });

  it('refuses a cross-origin POST and PATCH (the routes sit behind the guard) and writes nothing', async () => {
    const before = (await rows()).length;
    const foreign = { origin: 'https://evil.example' };
    assert.equal((await call('POST', '/api/entities/note', { title: 'Injected' }, foreign)).status, 403);
    assert.equal((await call('PATCH', '/api/entities/note/anything', { title: 'Injected', version: 1 }, foreign)).status, 403);
    assert.equal((await rows()).length, before);
  });
});
