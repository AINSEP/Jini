import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('the exported Cloudflare payload loads both targets and constructs a portable receiver outside host dependencies', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'jini-cloudflare-payload-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const published = path.dirname(fileURLToPath(import.meta.resolve('@jini-ai/agent-plugins/cloudflare')));
  const copied = path.join(root, 'cloudflare');
  await cp(published, copied, { recursive: true });
  const descriptor = JSON.parse(await readFile(path.join(copied, 'tovu-deploy-targets.json'), 'utf8'));
  assert.deepEqual(descriptor.targets.map(target => target.id).sort(), ['cloudflare-pages', 'cloudflare-workers']);
  for (const target of descriptor.targets) {
    const module = await import(pathToFileURL(path.join(copied, target.module)));
    assert.equal(typeof module.default.create, 'function', target.id);
  }
  const directReceiver = await import(pathToFileURL(path.join(copied, 'worker/forms-receiver.mjs')));
  assert.equal(typeof directReceiver.handleRequest, 'function');
  const { formsWorkerParts } = await import(pathToFileURL(path.join(copied, 'lib/forms.mjs')));
  const { modules } = await formsWorkerParts({ manifest: { forms: [] }, secret: 's'.repeat(32), databaseId: 'fixture' });
  const receiver = path.join(root, 'receiver');
  await mkdir(receiver);
  for (const module of modules) await writeFile(path.join(receiver, module.name), module.source);
  const worker = await import(pathToFileURL(path.join(receiver, 'index.mjs')));
  const response = await worker.default.fetch(new Request('https://site.example/forms/missing/submit', { method: 'POST' }), {});
  assert.equal(response.status, 404, 'the generated worker executes without CMS installed beside it');
});
