/**
 * @file Characterization of the 8 existing routes through core's in-memory server and a temp SQLite
 * file: status, content type, redirect location and key body fields. It pins what the app does today
 * so splitting `registerNotesApp` cannot silently change a route.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryServer, type InMemoryServer } from '@jini-ai/core/contracts/server/testing';
import { openAppDatabase } from './db.ts';
import { registerNotesApp } from './app.ts';

const ORIGIN = 'http://127.0.0.1:3000';

describe('notes app routes (characterization)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-routes-test-'));
  let memory: InMemoryServer;
  let closeDb: () => void = () => {};

  const send = (path: string, init: { method?: string; fields?: Record<string, string> } = {}): Promise<Response> =>
    memory.fetch(new Request(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      ...(init.fields ? { body: new URLSearchParams(init.fields) } : {}),
    }));
  const post = (path: string, fields: Record<string, string>) => send(path, { method: 'POST', fields });

  before(async () => {
    const database = await openAppDatabase({ filePath: join(dir, 'notes.db') });
    closeDb = database.close;
    memory = createInMemoryServer();
    await registerNotesApp({ app: memory.server, kernel: database.kernel });
  });
  after(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET / lists notes as html, with the empty state first', async () => {
    const response = await send('/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    assert.match(await response.text(), /No notes yet\./);
  });

  it('POST /notes creates a draft and redirects to /notes/<slug>', async () => {
    const response = await post('/notes', { title: 'Alpha', slug: 'alpha', body: 'first body' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/notes/alpha');
  });

  it('POST /notes with a slug already in use answers 400 and the service message as json', async () => {
    const response = await post('/notes', { title: 'Again', slug: 'alpha', body: '' });
    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.match(((await response.json()) as { error: string }).error, /slug 'alpha' already exists/);
  });

  it('GET /notes/:slug renders the note, its version and the contact form', async () => {
    const response = await send('/notes/alpha');
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /<h1>Alpha<\/h1>/);
    assert.match(page, /draft · version 1/);
    assert.match(page, /action="\/forms\/contact\?note=alpha"/);
    assert.doesNotMatch(page, /<p role="status">/);
  });

  it('GET /notes/:slug?sent=1 shows the thanks line', async () => {
    assert.match(await (await send('/notes/alpha?sent=1')).text(), /<p role="status">Thanks, your message was sent\./);
  });

  it('GET /notes/<unknown> answers 404 html', async () => {
    const response = await send('/notes/missing');
    assert.equal(response.status, 404);
    assert.match(await response.text(), /<h1>Not found<\/h1>/);
  });

  it('POST /notes/:slug/edit with the current version saves and redirects; a stale version is 409', async () => {
    const saved = await post('/notes/alpha/edit', { title: 'Alpha v2', body: 'second body', version: '1' });
    assert.equal(saved.status, 303);
    assert.equal(saved.headers.get('location'), '/notes/alpha');
    const stale = await post('/notes/alpha/edit', { title: 'Alpha stale', body: 'lost', version: '1' });
    assert.equal(stale.status, 409);
    assert.equal(typeof ((await stale.json()) as { error: string }).error, 'string');
    assert.match(await (await send('/notes/alpha')).text(), /<h1>Alpha v2<\/h1>/);
  });

  it('POST /notes/<unknown>/edit and /publish answer 404 json', async () => {
    for (const path of ['/notes/missing/edit', '/notes/missing/publish']) {
      const response = await post(path, { title: 'x', version: '1' });
      assert.equal(response.status, 404, path);
      assert.deepEqual(await response.json(), { error: 'not found' });
    }
  });

  it('POST /notes/:slug/publish marks the note published', async () => {
    const response = await post('/notes/alpha/publish', {});
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/notes/alpha');
    assert.match(await (await send('/notes/alpha')).text(), /published · version 3/);
  });

  it('GET /api/notes lists slug, title, body, status and version', async () => {
    const response = await send('/api/notes');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.deepEqual(await response.json(), {
      notes: [{ slug: 'alpha', title: 'Alpha v2', body: 'second body', status: 'published', version: 3 }],
    });
  });

  it('POST /forms/contact: invalid is 422 with the error text, valid redirects to ?sent=1', async () => {
    const invalid = await post('/forms/contact?note=alpha', { name: '', email: 'not-an-email', message: '' });
    assert.equal(invalid.status, 422);
    assert.equal(typeof ((await invalid.json()) as { error: string }).error, 'string');
    const valid = await post('/forms/contact?note=alpha', { name: 'Ada', email: 'ada@example.com', message: 'Nice note' });
    assert.equal(valid.status, 303);
    assert.equal(valid.headers.get('location'), '/notes/alpha?sent=1');
  });

  it('POST /forms/contact without ?note answers 202 accepted', async () => {
    const response = await post('/forms/contact', { name: 'Ada', email: 'ada@example.com', message: 'Hello' });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: 'accepted' });
  });

  it('GET /api/forms/:slug/submissions lists the stored submissions; unknown form is 404', async () => {
    const response = await send('/api/forms/contact/submissions');
    assert.equal(response.status, 200);
    const { submissions } = await response.json() as { submissions: Array<{ data: Record<string, unknown> }> };
    assert.deepEqual(submissions.map((s) => s.data.message).sort(), ['Hello', 'Nice note']);
    assert.equal((await send('/api/forms/nope/submissions')).status, 404);
  });

  it('wrong method on a known path is 405 with Allow; an unknown path is 404', async () => {
    const wrong = await send('/notes');
    assert.equal(wrong.status, 405);
    assert.match(wrong.headers.get('allow') ?? '', /POST/);
    assert.equal((await send('/nope')).status, 404);
  });
});
