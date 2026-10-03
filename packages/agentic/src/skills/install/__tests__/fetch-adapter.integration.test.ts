import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createSkillFetchAdapter, fetchGitHubSkill } from '../index.js';

test('native fetch adaptation preserves URL, request options, response and errors', async () => {
  const response = Response.json({ sha: 'a'.repeat(40) });
  const options: RequestInit = { redirect: 'error', signal: new AbortController().signal };
  const requests: unknown[] = [];
  const port = createSkillFetchAdapter({ fetch: async (url, init) => {
    requests.push([url, init]);
    return response;
  } }, {});
  assert.equal(await port({ url: 'https://api.github.com/repos/acme/skills' }, options), response);
  assert.deepEqual(requests, [['https://api.github.com/repos/acme/skills', options]]);
  const failure = new Error('transport unavailable');
  const failing = createSkillFetchAdapter({ fetch: async () => { throw failure; } });
  await assert.rejects(() => failing({ url: 'https://api.github.com' }), error => error === failure);
});

// Adapted from the original GitHub installation characterization: keep native
// transport behind an explicit adapter and preserve the commit-pinned wire requests.
test('the adapter composes with the importer and pins every file to the resolved commit', async () => {
  const commit = 'a'.repeat(40), blob = 'b'.repeat(40);
  const markdown = '---\nname: incident-response\ndescription: Respond to outages.\n---\n';
  const urls: string[] = [];
  const fetch = createSkillFetchAdapter({ fetch: async (url, options) => {
    const address = String(url);
    urls.push(address);
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal instanceof AbortSignal);
    if (address.endsWith('/commits/HEAD')) return Response.json({ sha: commit });
    if (address.endsWith(`/git/trees/${commit}?recursive=1`)) return Response.json({
      truncated: false, tree: [{ path: 'SKILL.md', type: 'blob', mode: '100644', sha: blob, size: Buffer.byteLength(markdown) }],
    });
    if (address.endsWith(`/git/blobs/${blob}`)) return Response.json({ encoding: 'base64', content: Buffer.from(markdown).toString('base64') });
    throw new Error(`Unexpected request: ${address}`);
  } });
  const githubUrl = 'https://github.com/acme/skills';
  assert.deepEqual(await fetchGitHubSkill({ githubUrl, fetch }), {
    source: { githubUrl, commit }, files: [{ path: 'SKILL.md', contentBase64: Buffer.from(markdown).toString('base64') }],
  });
  assert.deepEqual(urls, [
    'https://api.github.com/repos/acme/skills/commits/HEAD',
    `https://api.github.com/repos/acme/skills/git/trees/${commit}?recursive=1`,
    `https://api.github.com/repos/acme/skills/git/blobs/${blob}`,
  ]);
});
