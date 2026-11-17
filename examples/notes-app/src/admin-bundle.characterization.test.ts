/**
 * @file Characterization, before `/admin/` is served: with the adapter's `onUnmatched` hook present (and
 * answering nothing), every existing HTML route, the JSON routes and the contact form answer as they do today,
 * over a real socket and the real guard.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAppDatabase } from './db.ts';
import { createNodeServer, type NodeServer } from './node-server.ts';
import { registerNotesApp } from './app.ts';

describe('existing routes with an onUnmatched hook present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-bundle-char-'));
  let app: NodeServer;
  let closeDb: () => void = () => {};
  let base = '';
  const unmatched: string[] = [];

  const post = (path: string, fields: Record<string, string>) => fetch(base + path, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });

  before(async () => {
    const database = await openAppDatabase({ filePath: join(dir, 'notes.db') });
    closeDb = database.close;
    let boundPort = 0;
    app = createNodeServer({}, { onUnmatched: ({ request }) => { unmatched.push(new URL(request.url).pathname); return undefined; } });
    await registerNotesApp({ app, kernel: database.kernel, port: () => boundPort });
    boundPort = (await app.listen({ port: 0 })).port;
    base = `http://127.0.0.1:${boundPort}`;
  });
  after(async () => { await app.close(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

  it('serves the list, creates, edits, publishes and shows a note exactly as before', async () => {
    assert.match(await (await fetch(`${base}/`)).text(), /No notes yet\./);
    const created = await post('/notes', { title: 'Hello', slug: 'hello', body: 'world' });
    assert.deepEqual([created.status, created.headers.get('location')], [303, '/notes/hello']);
    assert.equal((await post('/notes/hello/edit', { title: 'Hello 2', body: 'world', version: '1' })).status, 303);
    assert.equal((await post('/notes/hello/publish', {})).status, 303);
    const page = await (await fetch(`${base}/notes/hello`)).text();
    assert.match(page, /<h1>Hello 2<\/h1>/);
    assert.match(page, /published · version 3/);
  });

  it('keeps the JSON routes, the contact form, 405 and the plain 404', async () => {
    assert.equal((await (await fetch(`${base}/api/notes`)).json() as { notes: unknown[] }).notes.length, 1);
    assert.equal((await post('/forms/contact?note=hello', { name: 'Ada', email: 'ada@example.com', message: 'Hi' })).headers.get('location'), '/notes/hello?sent=1');
    assert.equal((await fetch(`${base}/api/forms/contact/submissions`)).status, 200);
    assert.equal((await fetch(`${base}/notes`)).status, 405);
    const missing = await fetch(`${base}/admin/index.html`);
    assert.deepEqual([missing.status, await missing.text()], [404, 'Not Found']);
  });

  it('asked the hook only about the unmatched path, never about a matched route', () => {
    assert.deepEqual(unmatched, ['/admin/index.html']);
  });
});
