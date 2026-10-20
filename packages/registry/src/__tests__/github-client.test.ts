import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from '@jini-ai/platform';
import { FETCH_TIMEOUT_MS } from '@jini-ai/platform/fetch-with-timeout';
import type { HttpClientPort, HttpRequest, HttpResponse } from '@jini-ai/core/primitives';
import { GithubApiRegistryClient } from '../github-client.js';

// Bind the existing platform timeout behavior to the transport port; global fetch is stubbed below.
const http: HttpClientPort = {
  async send({ request }, optional = {}) {
    const response = await fetchWithTimeout(request.url, {
      method: request.method, headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(optional.redirect === undefined ? {} : { redirect: optional.redirect }),
    }, { timeoutMs: request.totalDeadlineMs ?? request.idleTimeoutMs ?? request.timeoutMs ?? 15_000 });
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), bodyText: await response.text() };
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

describe('GithubApiRegistryClient.readManifest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // REGRESSION: fails if readManifest restores this.http.fetch followed by readGithubJson(Response).
  it('propagates body transport failure before attempting to interpret GitHub JSON', async () => {
    const failure = new Error('response stream interrupted');
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(failure); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' }))
      .rejects.toBe(failure);
  });

  it('reads and decodes a base64 manifest file, sending ref as a query param and an Authorization header when a token is configured', async () => {
    const manifest = { specVersion: '1.0.0', name: 'reg', version: '1.0.0', entries: [] };
    let seenUrl = '';
    let seenAuth: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        seenUrl = String(input);
        seenAuth = (init?.headers as Record<string, string>)?.Authorization;
        return jsonResponse(200, { type: 'file', encoding: 'base64', content: base64(JSON.stringify(manifest)), size: 10 });
      }),
    );
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    const result = await client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'registry/index.json' });
    expect(result).toEqual(manifest);
    expect(seenUrl).toContain('/repos/acme/registry/contents/registry/index.json');
    expect(seenUrl).toContain('ref=main');
    expect(seenAuth).toBe('Bearer tok');
  });

  it('omits the Authorization header for anonymous (no-token) reads', async () => {
    let seenAuth: string | undefined = 'not-checked-yet';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        seenAuth = (init?.headers as Record<string, string>)?.Authorization;
        return jsonResponse(200, { type: 'file', encoding: 'base64', content: base64('{"specVersion":"1.0.0","name":"r","version":"1.0.0","entries":[]}') });
      }),
    );
    const client = new GithubApiRegistryClient({ http });
    await client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'registry/index.json' });
    expect(seenAuth).toBeUndefined();
  });

  it('URL-encodes a nested manifest path segment-by-segment', async () => {
    let seenUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        seenUrl = String(input);
        return jsonResponse(200, { type: 'file', encoding: 'base64', content: base64('{"specVersion":"1.0.0","name":"r","version":"1.0.0","entries":[]}') });
      }),
    );
    const client = new GithubApiRegistryClient({ http });
    await client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'a dir/index file.json' });
    expect(seenUrl).toContain('/contents/a%20dir/index%20file.json');
  });

  it('throws a clear not-found error on a 404 without attempting to parse an error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'missing.json' })).rejects.toThrow(
      'Registry manifest not found: acme/registry@main:missing.json',
    );
  });

  it('throws with the GitHub error message on a non-2xx, non-404 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { message: 'API rate limit exceeded' })));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' })).rejects.toThrow('API rate limit exceeded');
  });

  it('falls back to a generic message when a non-2xx array response has no message field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, [])));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' })).rejects.toThrow(
      'Failed to read registry manifest acme/registry@main:index.json.',
    );
  });

  it('throws when the path resolves to a directory listing (an array response)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [{ type: 'file', name: 'a.json' }])));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'registry' })).rejects.toThrow(
      'Registry manifest path is a directory, not a file: acme/registry@main:registry',
    );
  });

  it('throws when the path resolves to a non-file type (e.g. a symlink)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { type: 'symlink' })));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' })).rejects.toThrow(
      'Registry manifest path is not a file (type: symlink)',
    );
  });

  it('throws a clear oversized-file error when encoding is not base64 (the 1-100MB Contents API shape)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { type: 'file', encoding: 'none', content: '', size: 5_000_000 })));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' })).rejects.toThrow(
      /too large for the Contents API.*size: 5000000 bytes, encoding: none/s,
    );
  });

  it('reports "unknown" size when the oversized response omits a numeric size field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { type: 'file', encoding: 'none', content: '' })));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' })).rejects.toThrow(/size: unknown bytes/);
  });

  it('throws when the decoded content is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { type: 'file', encoding: 'base64', content: base64('not json') })));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' })).rejects.toThrow('is not valid JSON');
  });

  it('tolerates base64 content with embedded newlines (as GitHub actually wraps it)', async () => {
    const raw = JSON.stringify({ specVersion: '1.0.0', name: 'r', version: '1.0.0', entries: [] });
    const wrapped = base64(raw).replace(/(.{20})/g, '$1\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { type: 'file', encoding: 'base64', content: wrapped })));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' })).resolves.toEqual(JSON.parse(raw));
  });

  it('throws when the response body is not valid JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    const client = new GithubApiRegistryClient({ http });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' })).rejects.toThrow('GitHub returned a non-JSON response.');
  });

  it('honors a custom apiUrl override (e.g. GitHub Enterprise Server)', async () => {
    let seenUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        seenUrl = String(input);
        return jsonResponse(200, { type: 'file', encoding: 'base64', content: base64('{"specVersion":"1.0.0","name":"r","version":"1.0.0","entries":[]}') });
      }),
    );
    const client = new GithubApiRegistryClient({ http }, { apiUrl: 'https://ghe.example.com/api/v3' });
    await client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' });
    expect(seenUrl.startsWith('https://ghe.example.com/api/v3/repos/acme/registry/contents/index.json')).toBe(true);
  });

  it('bounds the Contents API read with a timeout signal, so a stalled response cannot hang this call forever', async () => {
    let seenSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        seenSignal = init?.signal;
        return jsonResponse(200, { type: 'file', encoding: 'base64', content: base64('{"specVersion":"1.0.0","name":"r","version":"1.0.0","entries":[]}') });
      }),
    );
    const client = new GithubApiRegistryClient({ http });
    await client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' });
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });
});

describe('GithubApiRegistryClient.createPublishPullRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mutation = {
    owner: 'acme',
    repo: 'registry',
    baseRef: 'main',
    branchName: 'publish/vendor-example-1.0.0',
    title: 'Add vendor/example@1.0.0',
    body: 'Publish body',
    files: [{ path: 'entries/vendor/example/entry.json', content: '{"name":"vendor/example"}' }],
  };

  function happyPathRouter(overrides: Partial<Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>> = {}) {
    return vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const key = `${method} ${url.split('?')[0]}`;
      for (const [pattern, handler] of Object.entries(overrides)) {
        if (handler && key.includes(pattern)) return handler(url, init);
      }
      if (method === 'GET' && url.includes('/git/ref/heads/main')) {
        return jsonResponse(200, { ref: 'refs/heads/main', object: { sha: 'base-sha', type: 'commit' } });
      }
      if (method === 'GET' && url.includes('/git/commits/base-sha')) {
        return jsonResponse(200, { sha: 'base-sha', tree: { sha: 'base-tree-sha' } });
      }
      if (method === 'POST' && url.endsWith('/git/blobs')) {
        return jsonResponse(201, { sha: 'blob-sha' });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) {
        return jsonResponse(201, { sha: 'tree-sha' });
      }
      if (method === 'POST' && url.endsWith('/git/commits')) {
        return jsonResponse(201, { sha: 'commit-sha' });
      }
      if (method === 'POST' && url.endsWith('/git/refs')) {
        return jsonResponse(201, { ref: 'refs/heads/publish/vendor-example-1.0.0' });
      }
      if (method === 'POST' && url.endsWith('/pulls')) {
        return jsonResponse(201, { html_url: 'https://github.com/acme/registry/pull/9' });
      }
      throw new Error(`unexpected request in test: ${key}`);
    });
  }

  it('throws immediately without any network call when no token is configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('A GitHub token is required');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('walks blob -> tree -> commit -> branch -> pull request end to end and returns the PR url', async () => {
    const seenBodies: Record<string, unknown> = {};
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/blobs': (_u, init) => {
        seenBodies.blob = JSON.parse(String(init?.body));
        return jsonResponse(201, { sha: 'blob-sha' });
      },
      'POST https://api.github.com/repos/acme/registry/git/trees': (_u, init) => {
        seenBodies.tree = JSON.parse(String(init?.body));
        return jsonResponse(201, { sha: 'tree-sha' });
      },
      'POST https://api.github.com/repos/acme/registry/git/commits': (_u, init) => {
        seenBodies.commit = JSON.parse(String(init?.body));
        return jsonResponse(201, { sha: 'commit-sha' });
      },
      'POST https://api.github.com/repos/acme/registry/git/refs': (_u, init) => {
        seenBodies.ref = JSON.parse(String(init?.body));
        return jsonResponse(201, { ref: 'refs/heads/publish/vendor-example-1.0.0' });
      },
      'POST https://api.github.com/repos/acme/registry/pulls': (_u, init) => {
        seenBodies.pr = JSON.parse(String(init?.body));
        return jsonResponse(201, { html_url: 'https://github.com/acme/registry/pull/9' });
      },
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    const result = await client.createPublishPullRequest(mutation);
    expect(result).toEqual({ url: 'https://github.com/acme/registry/pull/9' });
    expect(seenBodies.blob).toEqual({ content: base64('{"name":"vendor/example"}'), encoding: 'base64' });
    expect(seenBodies.tree).toEqual({ base_tree: 'base-tree-sha', tree: [{ path: 'entries/vendor/example/entry.json', mode: '100644', type: 'blob', sha: 'blob-sha' }] });
    expect(seenBodies.commit).toMatchObject({ tree: 'tree-sha', parents: ['base-sha'], message: 'Add vendor/example@1.0.0\n\nPublish body' });
    expect(seenBodies.ref).toEqual({ ref: 'refs/heads/publish/vendor-example-1.0.0', sha: 'commit-sha' });
    expect(seenBodies.pr).toEqual({ title: 'Add vendor/example@1.0.0', body: 'Publish body', head: 'publish/vendor-example-1.0.0', base: 'main' });
  });

  it('bounds every request in the ref -> commit -> blob -> tree -> commit -> branch -> pull-request chain with a timeout signal', async () => {
    const seenSignals: Array<AbortSignal | null | undefined> = [];
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      seenSignals.push(init?.signal);
      return happyPathRouter()(input, init);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await client.createPublishPullRequest(mutation);
    // getRefSha, getCommitTreeSha, createBlob, createTree, createCommit, ensureBranch (create), ensurePullRequest.
    expect(seenSignals).toHaveLength(7);
    for (const signal of seenSignals) {
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('throws a clear error when baseRef does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub base ref "main" does not exist in acme/registry.');
  });

  it('throws the same "does not exist" error when the ref lookup succeeds (200) but the response has no object.sha (a malformed/missing ref object)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ref: 'refs/heads/main' })));
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub base ref "main" does not exist in acme/registry.');
  });

  it('throws with the GitHub message when the ref lookup fails with a non-404 error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { message: 'Internal error' })));
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Internal error');
  });

  it('throws when the base commit lookup fails', async () => {
    const fetchSpy = happyPathRouter({
      'GET https://api.github.com/repos/acme/registry/git/commits/base-sha': () => jsonResponse(500, { message: 'Commit lookup failed' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Commit lookup failed');
  });

  it('throws when the base commit response has no tree sha', async () => {
    const fetchSpy = happyPathRouter({
      'GET https://api.github.com/repos/acme/registry/git/commits/base-sha': () => jsonResponse(200, { sha: 'base-sha' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub base commit response did not include a tree sha.');
  });

  it('throws when a blob creation fails', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/blobs': () => jsonResponse(422, { message: 'Bad blob' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Bad blob');
  });

  it('throws when a blob response has no sha', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/blobs': () => jsonResponse(201, {}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub blob response did not include a sha.');
  });

  it('throws when tree creation fails', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/trees': () => jsonResponse(422, { message: 'Bad tree' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Bad tree');
  });

  it('throws when the tree response has no sha', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/trees': () => jsonResponse(201, {}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub tree response did not include a sha.');
  });

  it('throws when commit creation fails', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/commits': () => jsonResponse(422, { message: 'Bad commit' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Bad commit');
  });

  it('throws when the commit response has no sha', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/commits': () => jsonResponse(201, {}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub commit response did not include a sha.');
  });

  it('falls back to PATCH-updating the branch with force:true when the branch ref already exists (409)', async () => {
    let patchBody: unknown;
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/refs': () => jsonResponse(409, { message: 'Reference already exists' }),
      'PATCH https://api.github.com/repos/acme/registry/git/refs/heads/publish%2Fvendor-example-1.0.0': (_u, init) => {
        patchBody = JSON.parse(String(init?.body));
        return jsonResponse(200, { ref: 'refs/heads/publish/vendor-example-1.0.0' });
      },
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    const result = await client.createPublishPullRequest(mutation);
    expect(result).toEqual({ url: 'https://github.com/acme/registry/pull/9' });
    expect(patchBody).toEqual({ sha: 'commit-sha', force: true });
  });

  it('bounds the PATCH branch-update fallback (after a 409 create conflict) with a timeout signal too', async () => {
    let patchSignal: AbortSignal | null | undefined;
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/refs': () => jsonResponse(409, { message: 'Reference already exists' }),
      'PATCH https://api.github.com/repos/acme/registry/git/refs/heads/publish%2Fvendor-example-1.0.0': (_u, init) => {
        patchSignal = init?.signal;
        return jsonResponse(200, { ref: 'refs/heads/publish/vendor-example-1.0.0' });
      },
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await client.createPublishPullRequest(mutation);
    expect(patchSignal).toBeInstanceOf(AbortSignal);
  });

  it('throws when the branch update (after a create conflict) itself fails', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/refs': () => jsonResponse(422, { message: 'Reference already exists' }),
      'PATCH https://api.github.com/repos/acme/registry/git/refs/heads/publish%2Fvendor-example-1.0.0': () =>
        jsonResponse(500, { message: 'Update failed' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Update failed');
  });

  it('throws directly when branch creation fails for a reason other than a conflict', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/refs': () => jsonResponse(403, { message: 'Forbidden' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Forbidden');
  });

  it('throws when the pull request response has no html_url', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(201, {}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub pull request response did not include an html_url.');
  });

  it('throws directly when pull request creation fails for a reason unrelated to an existing PR', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(422, { message: 'Validation failed: no commits between main and publish/vendor-example-1.0.0' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Validation failed');
  });

  it('falls back to the generic pull-request-creation error when a 422 response carries no message field at all', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(422, {}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub pull request creation failed.');
  });

  it('recovers by finding the existing open pull request when GitHub reports one already exists for this head/base', async () => {
    let listUrl = '';
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(422, { message: 'A pull request already exists for acme:publish/vendor-example-1.0.0.' }),
      'GET https://api.github.com/repos/acme/registry/pulls': (u) => {
        listUrl = u;
        return jsonResponse(200, [{ html_url: 'https://github.com/acme/registry/pull/7' }]);
      },
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    const result = await client.createPublishPullRequest(mutation);
    expect(result).toEqual({ url: 'https://github.com/acme/registry/pull/7' });
    expect(listUrl).toContain('head=acme%3Apublish%2Fvendor-example-1.0.0');
    expect(listUrl).toContain('state=open');
  });

  it('bounds the existing-open-pull-request recovery lookup with a timeout signal too', async () => {
    let listSignal: AbortSignal | null | undefined;
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(422, { message: 'A pull request already exists for acme:publish/vendor-example-1.0.0.' }),
      'GET https://api.github.com/repos/acme/registry/pulls': (_u, init) => {
        listSignal = init?.signal;
        return jsonResponse(200, [{ html_url: 'https://github.com/acme/registry/pull/7' }]);
      },
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await client.createPublishPullRequest(mutation);
    expect(listSignal).toBeInstanceOf(AbortSignal);
  });

  it('rethrows the original "already exists" error when no matching open pull request can be found after all', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(422, { message: 'A pull request already exists for acme:publish/vendor-example-1.0.0.' }),
      'GET https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(200, []),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('A pull request already exists');
  });

  it('rethrows the original "already exists" error when the recovery lookup itself fails', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(422, { message: 'A pull request already exists for acme:publish/vendor-example-1.0.0.' }),
      'GET https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(500, { message: 'list failed' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('A pull request already exists');
  });

  it('falls back to a generic message when an error body has no message field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));
    const client = new GithubApiRegistryClient({ http }, { token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub ref lookup failed.');
  });
});

// ---------------------------------------------------------------------------
// Pins written before the complexity refactor. These drive a typed fake
// HttpClientPort directly (no global fetch stub) so every request the client
// builds can be asserted exactly, and every response branch can be scripted.
// ---------------------------------------------------------------------------
type Responder = (request: HttpRequest) => HttpResponse;

function fakeHttp(responder: Responder): { http: HttpClientPort; requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  return {
    requests,
    http: {
      async send({ request }) {
        requests.push(request);
        return responder(request);
      },
    },
  };
}

function reply(status: number, body: unknown): HttpResponse {
  return { status, headers: {}, bodyText: typeof body === 'string' ? body : JSON.stringify(body) };
}

function fileReply(status: number, text: string): HttpResponse {
  return reply(status, { type: 'file', encoding: 'base64', content: base64(text) });
}

const where = { owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' };
const okManifest = '{"specVersion":"1.0.0","name":"r","version":"1.0.0","entries":[]}';
// Built at runtime so no secret-shaped literal is committed.
const secretToken = 'gh' + 'p_' + 'x'.repeat(36);

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the promise to reject');
}

describe('GithubApiRegistryClient.readManifest (pinned request/response contract)', () => {
  it('sends exactly one GET with segment-encoded owner/repo/path, ref as a query param, bounded timeouts and bearer auth', async () => {
    const { http, requests } = fakeHttp(() => fileReply(200, okManifest));
    const client = new GithubApiRegistryClient({ http }, { token: secretToken });
    await client.readManifest({ owner: 'a b', repo: 'x#y', ref: 'feat/x&y', path: '/dir//sub dir/%f.json' });
    expect(requests).toEqual([{
      url: 'https://api.github.com/repos/a%20b/x%23y/contents/dir/sub%20dir/%25f.json?ref=feat%2Fx%26y',
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', Authorization: `Bearer ${secretToken}` },
      idleTimeoutMs: FETCH_TIMEOUT_MS.QUICK,
      totalDeadlineMs: FETCH_TIMEOUT_MS.QUICK,
    }]);
  });

  it('passes ".." path segments through unencoded, so a host-supplied manifestPath can climb out of /contents/ once the URL is normalized (reported, not fixed)', async () => {
    const { http, requests } = fakeHttp(() => fileReply(200, okManifest));
    const client = new GithubApiRegistryClient({ http });
    await client.readManifest({ ...where, path: '../../../../user' });
    expect(requests[0]?.url).toBe('https://api.github.com/repos/acme/registry/contents/../../../../user?ref=main');
    expect(new URL(requests[0]!.url).pathname).toBe('/user');
  });

  it('treats 404 as not-found without parsing the body', async () => {
    const { http } = fakeHttp(() => reply(404, 'not json'));
    await expect(new GithubApiRegistryClient({ http }).readManifest(where)).rejects.toThrow('Registry manifest not found: acme/registry@main:index.json');
  });

  it('formats a non-2xx error as "<GitHub message> (HTTP <status>)"', async () => {
    const { http } = fakeHttp(() => reply(403, { message: 'API rate limit exceeded' }));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }).readManifest(where));
    expect(error.message).toBe('API rate limit exceeded (HTTP 403)');
  });

  it('uses the fallback when the GitHub message is an empty string', async () => {
    const { http } = fakeHttp(() => reply(500, { message: '' }));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }).readManifest(where));
    expect(error.message).toBe('Failed to read registry manifest acme/registry@main:index.json. (HTTP 500)');
  });

  it('uses the fallback when the GitHub message is not a string', async () => {
    const { http } = fakeHttp(() => reply(500, { message: 42 }));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }).readManifest(where));
    expect(error.message).toBe('Failed to read registry manifest acme/registry@main:index.json. (HTTP 500)');
  });

  it('accepts status 299 as success (upper 2xx boundary)', async () => {
    const { http } = fakeHttp(() => fileReply(299, okManifest));
    await expect(new GithubApiRegistryClient({ http }).readManifest(where)).resolves.toEqual(JSON.parse(okManifest));
  });

  it('rejects status 300 even with a valid file body (exclusive upper boundary)', async () => {
    const { http } = fakeHttp(() => fileReply(300, okManifest));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }).readManifest(where));
    expect(error.message).toBe('Failed to read registry manifest acme/registry@main:index.json. (HTTP 300)');
  });

  it('rejects status 199 even with a valid file body (lower boundary)', async () => {
    const { http } = fakeHttp(() => fileReply(199, okManifest));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }).readManifest(where));
    expect(error.message).toBe('Failed to read registry manifest acme/registry@main:index.json. (HTTP 199)');
  });

  it('reports a missing type as "type: undefined"', async () => {
    const { http } = fakeHttp(() => reply(200, { encoding: 'base64', content: base64(okManifest) }));
    await expect(new GithubApiRegistryClient({ http }).readManifest(where)).rejects.toThrow(
      'Registry manifest path is not a file (type: undefined): acme/registry@main:index.json',
    );
  });

  it('reports base64 encoding with non-string content as too large, with the numeric size', async () => {
    const { http } = fakeHttp(() => reply(200, { type: 'file', encoding: 'base64', size: 7 }));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }).readManifest(where));
    expect(error.message).toBe(
      'Registry manifest at acme/registry@main:index.json is too large for the Contents API\'s inline response ' +
        '(size: 7 bytes, encoding: base64); split the manifest into a smaller file or fetch it via the Git Trees/raw-media-type API instead.',
    );
  });

  it('keeps the JSON SyntaxError as cause when the decoded manifest is not JSON', async () => {
    const { http } = fakeHttp(() => fileReply(200, '{oops'));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }).readManifest(where));
    expect(error.message).toBe('Registry manifest at acme/registry@main:index.json is not valid JSON.');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('keeps the JSON SyntaxError as cause when the GitHub response body is not JSON', async () => {
    const { http } = fakeHttp(() => reply(200, '<html>'));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }).readManifest(where));
    expect(error.message).toBe('GitHub returned a non-JSON response.');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('fails with an unattributed TypeError when a 2xx body is JSON null (reported, not fixed)', async () => {
    const { http } = fakeHttp(() => reply(200, 'null'));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }).readManifest(where));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/Cannot read properties of null \(reading 'type'\)/);
  });

  it('never puts the token into any readManifest error message', async () => {
    const bodies: HttpResponse[] = [
      reply(404, ''), reply(403, {}), reply(500, []), reply(200, []), reply(200, { type: 'dir' }),
      reply(200, { type: 'file', encoding: 'none' }), fileReply(200, 'nope'), reply(200, 'nope'),
    ];
    for (const body of bodies) {
      const { http } = fakeHttp(() => body);
      const error = await rejectionOf(new GithubApiRegistryClient({ http }, { token: secretToken }).readManifest(where));
      expect(error.message).not.toContain(secretToken);
    }
  });
});

describe('GithubApiRegistryClient.createPublishPullRequest (pinned request/response contract)', () => {
  const mutation = {
    owner: 'acme',
    repo: 'registry',
    baseRef: 'main',
    branchName: 'publish/vendor-example-1.0.0',
    title: 'Add vendor/example@1.0.0',
    body: '',
    files: [
      { path: 'entries/a.json', content: 'A' },
      { path: 'entries/b.json', content: 'B' },
    ],
  };

  function router(overrides: Record<string, Responder> = {}): Responder {
    const defaults: Record<string, Responder> = {
      'GET /repos/acme/registry/git/ref/heads/main': () => reply(200, { object: { sha: 'base-sha' } }),
      'GET /repos/acme/registry/git/commits/base-sha': () => reply(200, { tree: { sha: 'base-tree' } }),
      'POST /repos/acme/registry/git/blobs': (req) => reply(201, { sha: `blob-${JSON.parse(String(req.body)).content}` }),
      'POST /repos/acme/registry/git/trees': () => reply(201, { sha: 'tree-sha' }),
      'POST /repos/acme/registry/git/commits': () => reply(201, { sha: 'commit-sha' }),
      'POST /repos/acme/registry/git/refs': () => reply(201, {}),
      'PATCH /repos/acme/registry/git/refs/heads/publish%2Fvendor-example-1.0.0': () => reply(200, {}),
      'POST /repos/acme/registry/pulls': () => reply(201, { html_url: 'https://github.com/acme/registry/pull/1' }),
      'GET /repos/acme/registry/pulls': () => reply(200, [{ html_url: 'https://github.com/acme/registry/pull/7' }]),
    };
    const routes = { ...defaults, ...overrides };
    return (req) => {
      const key = `${req.method} ${new URL(req.url).pathname}`;
      const route = routes[key];
      if (!route) throw new Error(`unexpected request in test: ${key}`);
      return route(req);
    };
  }

  const routeKeys = (requests: HttpRequest[]) => requests.map((req) => `${req.method} ${new URL(req.url).pathname}`);
  const alreadyExists = { message: 'A pull request ALREADY EXISTS for acme:publish/vendor-example-1.0.0.' };

  it('refuses without a token before sending any request', async () => {
    const { http, requests } = fakeHttp(router());
    await expect(new GithubApiRegistryClient({ http }).createPublishPullRequest(mutation)).rejects.toThrow(
      'A GitHub token is required to open a registry publish/yank pull request.',
    );
    expect(requests).toEqual([]);
  });

  it('sends the exact request chain with JSON bodies, content type, auth and bounded timeouts', async () => {
    const { http, requests } = fakeHttp(router());
    const result = await new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation);
    expect(result).toEqual({ url: 'https://github.com/acme/registry/pull/1' });
    expect(routeKeys(requests)).toEqual([
      'GET /repos/acme/registry/git/ref/heads/main',
      'GET /repos/acme/registry/git/commits/base-sha',
      'POST /repos/acme/registry/git/blobs',
      'POST /repos/acme/registry/git/blobs',
      'POST /repos/acme/registry/git/trees',
      'POST /repos/acme/registry/git/commits',
      'POST /repos/acme/registry/git/refs',
      'POST /repos/acme/registry/pulls',
    ]);
    for (const req of requests) {
      expect(req.headers.Authorization).toBe(`Bearer ${secretToken}`);
      expect(req.idleTimeoutMs).toBe(FETCH_TIMEOUT_MS.QUICK);
      expect(req.totalDeadlineMs).toBe(FETCH_TIMEOUT_MS.QUICK);
      expect(req.headers['Content-Type']).toBe(req.method === 'GET' ? undefined : 'application/json');
    }
    const bodies = requests.map((req) => (req.body === undefined ? undefined : JSON.parse(String(req.body))));
    expect(bodies[2]).toEqual({ content: base64('A'), encoding: 'base64' });
    expect(bodies[4]).toEqual({
      base_tree: 'base-tree',
      tree: [
        { path: 'entries/a.json', mode: '100644', type: 'blob', sha: `blob-${base64('A')}` },
        { path: 'entries/b.json', mode: '100644', type: 'blob', sha: `blob-${base64('B')}` },
      ],
    });
    // An empty body leaves only the title: the commit message is trimmed.
    expect(bodies[5]).toEqual({ message: 'Add vendor/example@1.0.0', tree: 'tree-sha', parents: ['base-sha'] });
    expect(bodies[6]).toEqual({ ref: 'refs/heads/publish/vendor-example-1.0.0', sha: 'commit-sha' });
    expect(bodies[7]).toEqual({ title: mutation.title, body: '', head: mutation.branchName, base: 'main' });
  });

  it('force-updates the branch when ref creation answers 422 (already exists)', async () => {
    const { http, requests } = fakeHttp(router({ 'POST /repos/acme/registry/git/refs': () => reply(422, { message: 'Reference already exists' }) }));
    await new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation);
    const patch = requests.find((req) => req.method === 'PATCH');
    expect(patch && JSON.parse(String(patch.body))).toEqual({ sha: 'commit-sha', force: true });
  });

  it('accepts a 299 branch creation without a PATCH and without parsing its body', async () => {
    const { http, requests } = fakeHttp(router({ 'POST /repos/acme/registry/git/refs': () => reply(299, 'not json') }));
    await new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation);
    expect(requests.some((req) => req.method === 'PATCH')).toBe(false);
  });

  it('reports a non-JSON branch-creation failure body as a non-JSON response', async () => {
    const { http } = fakeHttp(router({ 'POST /repos/acme/registry/git/refs': () => reply(500, '<html>') }));
    await expect(new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation)).rejects.toThrow(
      'GitHub returned a non-JSON response.',
    );
  });

  it('recovers an existing PR when the 422 message says "already exists" in any letter case', async () => {
    const { http, requests } = fakeHttp(router({ 'POST /repos/acme/registry/pulls': () => reply(422, alreadyExists) }));
    await expect(new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation)).resolves.toEqual({
      url: 'https://github.com/acme/registry/pull/7',
    });
    const lookup = new URL(requests.at(-1)!.url);
    expect(Object.fromEntries(lookup.searchParams)).toEqual({ head: 'acme:publish/vendor-example-1.0.0', base: 'main', state: 'open' });
  });

  it('does not attempt recovery when "already exists" arrives with a status other than 422', async () => {
    const { http, requests } = fakeHttp(router({ 'POST /repos/acme/registry/pulls': () => reply(409, alreadyExists) }));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation));
    expect(error.message).toBe(`${alreadyExists.message} (HTTP 409)`);
    expect(routeKeys(requests)).not.toContain('GET /repos/acme/registry/pulls');
  });

  it('does not attempt recovery when the 422 message is not a string', async () => {
    const { http, requests } = fakeHttp(router({ 'POST /repos/acme/registry/pulls': () => reply(422, { message: ['already exists'] }) }));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation));
    expect(error.message).toBe('GitHub pull request creation failed. (HTTP 422)');
    expect(routeKeys(requests)).not.toContain('GET /repos/acme/registry/pulls');
  });

  it('rethrows the original 422 when the recovery lookup answers a non-array body', async () => {
    const { http } = fakeHttp(router({
      'POST /repos/acme/registry/pulls': () => reply(422, alreadyExists),
      'GET /repos/acme/registry/pulls': () => reply(200, { html_url: 'https://github.com/acme/registry/pull/7' }),
    }));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation));
    expect(error.message).toBe(`${alreadyExists.message} (HTTP 422)`);
  });

  it('rethrows the original 422 when the first open PR has no string html_url', async () => {
    const { http } = fakeHttp(router({
      'POST /repos/acme/registry/pulls': () => reply(422, alreadyExists),
      'GET /repos/acme/registry/pulls': () => reply(200, [{ html_url: 7 }, { html_url: 'https://github.com/acme/registry/pull/8' }]),
    }));
    const error = await rejectionOf(new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation));
    expect(error.message).toBe(`${alreadyExists.message} (HTTP 422)`);
  });

  it('rejects a 2xx PR response whose html_url is not a string', async () => {
    const { http } = fakeHttp(router({ 'POST /repos/acme/registry/pulls': () => reply(201, { html_url: 1 }) }));
    await expect(new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation)).rejects.toThrow(
      'GitHub pull request response did not include an html_url.',
    );
  });

  it('never puts the token into any publish error message', async () => {
    const failures: Record<string, Responder>[] = [
      { 'GET /repos/acme/registry/git/ref/heads/main': () => reply(404, '') },
      { 'GET /repos/acme/registry/git/ref/heads/main': () => reply(500, {}) },
      { 'GET /repos/acme/registry/git/commits/base-sha': () => reply(200, {}) },
      { 'POST /repos/acme/registry/git/blobs': () => reply(500, {}) },
      { 'POST /repos/acme/registry/git/trees': () => reply(201, {}) },
      { 'POST /repos/acme/registry/git/commits': () => reply(500, 'x') },
      { 'POST /repos/acme/registry/git/refs': () => reply(500, {}) },
      { 'POST /repos/acme/registry/git/refs': () => reply(409, {}), 'PATCH /repos/acme/registry/git/refs/heads/publish%2Fvendor-example-1.0.0': () => reply(500, {}) },
      { 'POST /repos/acme/registry/pulls': () => reply(422, alreadyExists), 'GET /repos/acme/registry/pulls': () => reply(500, {}) },
    ];
    for (const overrides of failures) {
      const { http } = fakeHttp(router(overrides));
      const error = await rejectionOf(new GithubApiRegistryClient({ http }, { token: secretToken }).createPublishPullRequest(mutation));
      expect(error.message).not.toContain(secretToken);
    }
  });
});
