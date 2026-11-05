import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { bindVercel } from '../targets/vercel.mjs';
import { createFakeDeployHostKit } from '../../__tests__/fake-deploy-host-kit.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const sha = data => createHash('sha1').update(data).digest('hex');
const files = [{ file: 'index.html', data: 'page' }, { file: 'hero.mp4', data: 'video' }];
const input = { files, projectName: 'demo' };

/** Provider content store survives target instances, just as a retry after a timed-out call does. */
function fixture({ failUpload, failCreate, poll = () => json({ readyState: 'READY', url: 'demo.vercel.app' }) } = {}) {
  const stored = new Set();
  const uploads = [];
  const creates = [];
  const progress = [];
  let probes = 0;
  const kit = {
    ...createFakeDeployHostKit(), sleep: async () => {},
    fetch: async (url, init) => {
      if (url.includes('/v2/files')) {
        const digest = new Headers(init.headers).get('x-vercel-digest');
        uploads.push(digest);
        if (failUpload?.(digest)) throw new Error('fetch timed out; token=secret-canary');
        stored.add(digest);
        return json({});
      }
      if (init.method === 'POST' && url.includes('/v13/deployments')) {
        const body = JSON.parse(init.body);
        creates.push(body);
        const missing = body.files.map(file => file.sha).filter(digest => !stored.has(digest));
        if (missing.length) return json({ error: { code: 'missing_files', missing } }, 400);
        if (failCreate?.()) throw new Error('fetch timed out; token=secret-canary');
        return json({ id: 'dpl_new', readyState: 'QUEUED', url: 'demo-new.vercel.app' });
      }
      if (url.includes('/v13/deployments/dpl_new')) return poll();
      return new Response('', { status: 200 });
    },
    waitForReachableDeploymentUrl: async () => { probes++; return { status: 'ready', url: 'https://demo.vercel.app' }; },
  };
  const { VercelDeployTarget } = bindVercel(kit);
  return { target: () => new VercelDeployTarget({ token: 'secret-canary' }), stored, uploads, creates, progress, probes: () => probes };
}

test('retry on a fresh target sends only hashes the provider is missing', async () => {
  const f = fixture();
  f.stored.add(sha('page'));
  await f.target().publish({ ...input, onProgress: value => f.progress.push(value) });
  await f.target().publish(input);
  assert.deepEqual(f.uploads, [sha('video')]);
  assert.equal(f.creates.length, 3); // negotiate + create, then already-present files
  assert.ok(f.progress.some(value => value.uploadedFiles === 1 && value.reusedFiles === 1));
});

test('upload timeout reports confirmed counts, no deployment, and a safe next step', async () => {
  const f = fixture({ failUpload: digest => digest === sha('video') });
  await assert.rejects(f.target().publish({ ...input, onProgress: value => f.progress.push(value) }), error => {
    assert.match(error.message, /deployment.*not created/i);
    assert.match(error.message, /1.*2.*uploaded/i);
    assert.match(error.message, /retry.*missing/i);
    assert.doesNotMatch(error.message, /secret-canary/);
    return true;
  });
  assert.equal(f.progress.at(-1).uploadedFiles, 1);
  assert.equal(f.progress.at(-1).deploymentCreated, false);
});

test('creation timeout says unknown rather than claiming no deployment was created', async () => {
  const f = fixture({ failCreate: () => true });
  await assert.rejects(f.target().publish(input), error => {
    assert.match(error.message, /deployment.*unknown/i);
    assert.match(error.message, /2.*2.*uploaded/i);
    assert.match(error.message, /Vercel.*dashboard/i);
    assert.doesNotMatch(error.message, /secret-canary/);
    return true;
  });
});

test('poll timeout returns the created deployment facts and never probes the old public alias', async () => {
  const f = fixture({ poll: () => { throw new Error('fetch timed out; token=secret-canary'); } });
  const result = await f.target().publish({ ...input, onProgress: value => f.progress.push(value) });
  assert.equal(result.status, 'link-delayed');
  assert.equal(result.deploymentId, 'dpl_new');
  assert.equal(result.url, 'https://demo-new.vercel.app');
  assert.match(result.statusMessage, /2.*2.*uploaded/i);
  assert.match(result.statusMessage, /dpl_new/);
  assert.match(result.statusMessage, /dashboard/i);
  assert.doesNotMatch(result.statusMessage, /secret-canary/);
  assert.equal(f.progress.at(-1).deploymentCreated, true);
  assert.equal(f.progress.at(-1).deploymentId, 'dpl_new');
  assert.equal(f.probes(), 0);
});

test('exhausted BUILDING poll budget cannot turn an old production 200 into success', async () => {
  let polls = 0;
  const f = fixture({ poll: () => { polls++; return json({ readyState: 'BUILDING', url: 'demo-new.vercel.app' }); } });
  const result = await f.target().publish(input);
  assert.equal(polls, 30);
  assert.equal(result.status, 'link-delayed');
  assert.match(result.statusMessage, /BUILDING/);
  assert.equal(f.probes(), 0);
});

test('retry after failed upload preserves provider bytes without resending acknowledgements', async () => {
  let fail = true;
  const f = fixture({ failUpload: digest => digest === sha('video') && fail });
  await assert.rejects(f.target().publish(input));
  fail = false;
  await f.target().publish(input);
  assert.equal(f.uploads.filter(digest => digest === sha('page')).length, 1);
  assert.equal(f.uploads.filter(digest => digest === sha('video')).length, 2);
});
