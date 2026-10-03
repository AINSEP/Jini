import assert from 'node:assert/strict';
import { test } from 'vitest';
import { fetchGitHubSkill } from '../index.js';
import type { SkillInstallDeps } from '../ports.js';

// Generalized from the originating install-service suite: inject the transport,
// preserve immutable provenance, and assert the two argument objects at every call.
const markdown = '---\nname: incident-response\ndescription: Respond to outages.\n---\nAlways check ownership.\n';
const commit = 'a'.repeat(40), blob = 'b'.repeat(40);

test('GitHub transport receives required URL and optional request policy separately', async () => {
  const urls: string[] = [];
  const signals: AbortSignal[] = [];
  const fetchPort: SkillInstallDeps['fetch'] = async (required, optional = {}) => {
    assert.ok(typeof required === 'object' && 'url' in required, 'the public transport must receive { url }');
    assert.deepEqual(Object.keys(required), ['url']);
    const { url } = required;
    assert.equal(optional.redirect, 'error');
    assert.deepEqual(optional.headers, { Accept: 'application/vnd.github+json' });
    assert.ok(optional.signal instanceof AbortSignal);
    signals.push(optional.signal);
    urls.push(url);
    if (url.endsWith('/commits/main')) return Response.json({ sha: commit });
    if (url.endsWith(`/git/trees/${commit}?recursive=1`)) return Response.json({ truncated: false, tree: [
      { path: 'ops/SKILL.md', type: 'blob', mode: '100644', sha: blob, size: Buffer.byteLength(markdown) },
    ] });
    if (url.endsWith(`/git/blobs/${blob}`)) return Response.json({ encoding: 'base64', content: Buffer.from(markdown).toString('base64') });
    throw new Error(`Unexpected request: ${url}`);
  };
  const githubUrl = 'https://github.com/acme/skills/tree/main/ops';
  assert.deepEqual(await fetchGitHubSkill({ githubUrl, fetch: fetchPort }, {}), {
    files: [{ path: 'SKILL.md', contentBase64: Buffer.from(markdown).toString('base64') }],
    source: { githubUrl, commit },
  });
  assert.deepEqual(urls, [
    'https://api.github.com/repos/acme/skills/commits/main',
    `https://api.github.com/repos/acme/skills/git/trees/${commit}?recursive=1`,
    `https://api.github.com/repos/acme/skills/git/blobs/${blob}`,
  ]);
  assert.equal(signals.length, 3);
  assert.equal(signals[0], signals[1]);
  assert.equal(signals[0], signals[2]);
});

test('unsafe repository URLs refuse before calling the injected transport', async () => {
  let calls = 0;
  const fetchPort: SkillInstallDeps['fetch'] = async () => { calls++; throw new Error('must not fetch'); };
  await assert.rejects(() => fetchGitHubSkill({ githubUrl: 'https://127.0.0.1/repo', fetch: fetchPort }), {
    message: 'Use an HTTPS GitHub repository URL, optionally ending in /tree/ref/skill-folder.',
  });
  assert.equal(calls, 0);
});

test('transport HTTP failures retain the existing installation refusal', async () => {
  const fetchPort: SkillInstallDeps['fetch'] = async required => {
    assert.ok(typeof required === 'object' && 'url' in required, 'the public transport must receive { url }');
    assert.equal(required.url, 'https://api.github.com/repos/acme/skills/commits/HEAD');
    return new Response(null, { status: 404 });
  };
  await assert.rejects(() => fetchGitHubSkill({ githubUrl: 'https://github.com/acme/skills', fetch: fetchPort }), {
    message: 'GitHub could not fetch this skill (HTTP 404). Use a public repository URL.',
  });
});
