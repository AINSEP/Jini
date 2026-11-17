/**
 * @file `serveAdminBundle`: serves the built admin only under `/admin/`, for GET and HEAD, never outside the
 * bundle folder, and stays out of the way (returns undefined) for everything else.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveAdminBundle } from './admin-bundle.ts';
import { createNodeServer, type NodeServer } from './node-server.ts';

describe('serveAdminBundle', () => {
  const root = mkdtempSync(join(tmpdir(), 'notes-bundle-'));
  const dir = join(root, 'bundle');
  const get = (path: string, method = 'GET') => serveAdminBundle({ request: new Request(`http://127.0.0.1:3000${path}`, { method }) }, { dir });

  before(() => {
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>admin</title>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(dir, 'assets', 'style.css'), 'body{}');
    writeFileSync(join(dir, 'assets', 'logo.svg'), '<svg/>');
    writeFileSync(join(dir, 'assets', 'data.bin'), 'x');
    writeFileSync(join(root, 'secret.txt'), 'outside the bundle');
    symlinkSync(join(root, 'secret.txt'), join(dir, 'assets', 'link.txt'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('serves the index at /admin/ and a file with its content type', async () => {
    const index = await get('/admin/');
    assert.equal(index?.status, 200);
    assert.match(index?.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(await index?.text(), '<!doctype html><title>admin</title>');
    for (const [path, type] of [['/admin/assets/app.js', /javascript/], ['/admin/assets/style.css', /^text\/css/], ['/admin/assets/logo.svg', /^image\/svg\+xml/], ['/admin/assets/data.bin', /octet-stream/]] as const) {
      assert.match((await get(path))?.headers.get('content-type') ?? '', type, path);
    }
    assert.equal(await (await get('/admin/assets/app.js'))?.text(), 'console.log(1)');
  });

  it('answers index.html for a client route (no file extension) and HEAD without a body', async () => {
    assert.equal(await (await get('/admin/notes/row/42/edit'))?.text(), '<!doctype html><title>admin</title>');
    const head = await get('/admin/assets/app.js', 'HEAD');
    assert.equal(head?.status, 200);
    assert.equal(head?.headers.get('content-length'), String('console.log(1)'.length));
    assert.equal(await head?.text(), '');
  });

  it('returns undefined outside /admin/, for another method, and for a missing file with an extension', async () => {
    for (const path of ['/', '/admin', '/administrator/index.html', '/api/notes', '/notes/x']) assert.equal(await get(path), undefined, path);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(await get('/admin/', method), undefined, method);
    assert.equal(await get('/admin/assets/missing.js'), undefined);
  });

  it('refuses a path that escapes the bundle folder, however it is spelled', async () => {
    for (const path of ['/admin/..%2fsecret.txt', '/admin/%2e%2e%2fsecret.txt', '/admin/assets/..%2f..%2fsecret.txt', '/admin/assets/%2e%2e%2f..%2fsecret.txt', '/admin/%5c..%5csecret.txt', '/admin/assets/%00.js', '/admin/%2fetc%2fpasswd', '/admin/assets/link.txt']) {
      const answer = await get(path);
      assert.ok(answer === undefined || answer.status === 404, `${path} -> ${answer?.status}`);
      assert.notEqual(await answer?.text(), 'outside the bundle', path);
    }
  });

  it('through the adapter: dot segments and encoded slashes never reach a file outside the folder', async () => {
    let app: NodeServer | undefined = createNodeServer({}, { onUnmatched: ({ request }) => serveAdminBundle({ request }, { dir }) });
    const { port } = await app.listen({ port: 0 });
    try {
      for (const path of ['/admin/../secret.txt', '/admin/%2e%2e/secret.txt', '/admin/..%2fsecret.txt', '/admin/assets/%2e%2e/%2e%2e/secret.txt']) {
        const body = await new Promise<{ status: number; text: string }>((resolve, reject) => {
          httpRequest({ host: '127.0.0.1', port, path }, (res) => {
            let text = '';
            res.on('data', (chunk: Buffer) => { text += chunk.toString(); });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
          }).on('error', reject).end();
        });
        assert.equal(body.status, 404, path);
        assert.notEqual(body.text, 'outside the bundle', path);
      }
    } finally {
      await app.close();
      app = undefined;
    }
  });

  it('answers undefined, not a crash, when the bundle folder does not exist', async () => {
    const answer = await serveAdminBundle({ request: new Request('http://127.0.0.1:3000/admin/') }, { dir: join(root, 'no-such-folder') });
    assert.equal(answer, undefined);
  });
});
