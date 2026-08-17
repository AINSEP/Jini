import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubApiRegistryClient } from '../github-client.js';

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
    const client = new GithubApiRegistryClient({ token: 'tok' });
    const result = await client.readManifest('acme', 'registry', 'main', 'registry/index.json');
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
    const client = new GithubApiRegistryClient();
    await client.readManifest('acme', 'registry', 'main', 'registry/index.json');
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
    const client = new GithubApiRegistryClient();
    await client.readManifest('acme', 'registry', 'main', 'a dir/index file.json');
    expect(seenUrl).toContain('/contents/a%20dir/index%20file.json');
  });

  it('throws a clear not-found error on a 404 without attempting to parse an error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const client = new GithubApiRegistryClient();
    await expect(client.readManifest('acme', 'registry', 'main', 'missing.json')).rejects.toThrow(
      'Registry manifest not found: acme/registry@main:missing.json',
    );
  });

  it('throws with the GitHub error message on a non-2xx, non-404 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { message: 'API rate limit exceeded' })));
    const client = new GithubApiRegistryClient();
    await expect(client.readManifest('acme', 'registry', 'main', 'index.json')).rejects.toThrow('API rate limit exceeded');
  });

  it('falls back to a generic message when a non-2xx array response has no message field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, [])));
    const client = new GithubApiRegistryClient();
    await expect(client.readManifest('acme', 'registry', 'main', 'index.json')).rejects.toThrow(
      'Failed to read registry manifest acme/registry@main:index.json.',
    );
  });

  it('throws when the path resolves to a directory listing (an array response)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [{ type: 'file', name: 'a.json' }])));
    const client = new GithubApiRegistryClient();
    await expect(client.readManifest('acme', 'registry', 'main', 'registry')).rejects.toThrow(
      'Registry manifest path is a directory, not a file: acme/registry@main:registry',
    );
  });

  it('throws when the path resolves to a non-file type (e.g. a symlink)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { type: 'symlink' })));
    const client = new GithubApiRegistryClient();
    await expect(client.readManifest('acme', 'registry', 'main', 'index.json')).rejects.toThrow(
      'Registry manifest path is not a file (type: symlink)',
    );
  });

  it('throws a clear oversized-file error when encoding is not base64 (the 1-100MB Contents API shape)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { type: 'file', encoding: 'none', content: '', size: 5_000_000 })));
    const client = new GithubApiRegistryClient();
    await expect(client.readManifest('acme', 'registry', 'main', 'index.json')).rejects.toThrow(
      /too large for the Contents API.*size: 5000000 bytes, encoding: none/s,
    );
  });

  it('reports "unknown" size when the oversized response omits a numeric size field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { type: 'file', encoding: 'none', content: '' })));
    const client = new GithubApiRegistryClient();
    await expect(client.readManifest('acme', 'registry', 'main', 'index.json')).rejects.toThrow(/size: unknown bytes/);
  });

  it('throws when the decoded content is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { type: 'file', encoding: 'base64', content: base64('not json') })));
    const client = new GithubApiRegistryClient();
    await expect(client.readManifest('acme', 'registry', 'main', 'index.json')).rejects.toThrow('is not valid JSON');
  });

  it('tolerates base64 content with embedded newlines (as GitHub actually wraps it)', async () => {
    const raw = JSON.stringify({ specVersion: '1.0.0', name: 'r', version: '1.0.0', entries: [] });
    const wrapped = base64(raw).replace(/(.{20})/g, '$1\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { type: 'file', encoding: 'base64', content: wrapped })));
    const client = new GithubApiRegistryClient();
    await expect(client.readManifest('acme', 'registry', 'main', 'index.json')).resolves.toEqual(JSON.parse(raw));
  });

  it('throws when the response body is not valid JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    const client = new GithubApiRegistryClient();
    await expect(client.readManifest('acme', 'registry', 'main', 'index.json')).rejects.toThrow('GitHub returned a non-JSON response.');
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
    const client = new GithubApiRegistryClient({ apiUrl: 'https://ghe.example.com/api/v3' });
    await client.readManifest('acme', 'registry', 'main', 'index.json');
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
    const client = new GithubApiRegistryClient();
    await client.readManifest('acme', 'registry', 'main', 'index.json');
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
    const client = new GithubApiRegistryClient();
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
    const client = new GithubApiRegistryClient({ token: 'tok' });
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
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await client.createPublishPullRequest(mutation);
    // getRefSha, getCommitTreeSha, createBlob, createTree, createCommit, ensureBranch (create), ensurePullRequest.
    expect(seenSignals).toHaveLength(7);
    for (const signal of seenSignals) {
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('throws a clear error when baseRef does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub base ref "main" does not exist in acme/registry.');
  });

  it('throws the same "does not exist" error when the ref lookup succeeds (200) but the response has no object.sha (a malformed/missing ref object)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ref: 'refs/heads/main' })));
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub base ref "main" does not exist in acme/registry.');
  });

  it('throws with the GitHub message when the ref lookup fails with a non-404 error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { message: 'Internal error' })));
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Internal error');
  });

  it('throws when the base commit lookup fails', async () => {
    const fetchSpy = happyPathRouter({
      'GET https://api.github.com/repos/acme/registry/git/commits/base-sha': () => jsonResponse(500, { message: 'Commit lookup failed' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Commit lookup failed');
  });

  it('throws when the base commit response has no tree sha', async () => {
    const fetchSpy = happyPathRouter({
      'GET https://api.github.com/repos/acme/registry/git/commits/base-sha': () => jsonResponse(200, { sha: 'base-sha' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub base commit response did not include a tree sha.');
  });

  it('throws when a blob creation fails', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/blobs': () => jsonResponse(422, { message: 'Bad blob' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Bad blob');
  });

  it('throws when a blob response has no sha', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/blobs': () => jsonResponse(201, {}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub blob response did not include a sha.');
  });

  it('throws when tree creation fails', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/trees': () => jsonResponse(422, { message: 'Bad tree' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Bad tree');
  });

  it('throws when the tree response has no sha', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/trees': () => jsonResponse(201, {}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub tree response did not include a sha.');
  });

  it('throws when commit creation fails', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/commits': () => jsonResponse(422, { message: 'Bad commit' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Bad commit');
  });

  it('throws when the commit response has no sha', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/commits': () => jsonResponse(201, {}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
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
    const client = new GithubApiRegistryClient({ token: 'tok' });
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
    const client = new GithubApiRegistryClient({ token: 'tok' });
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
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Update failed');
  });

  it('throws directly when branch creation fails for a reason other than a conflict', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/git/refs': () => jsonResponse(403, { message: 'Forbidden' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Forbidden');
  });

  it('throws when the pull request response has no html_url', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(201, {}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub pull request response did not include an html_url.');
  });

  it('throws directly when pull request creation fails for a reason unrelated to an existing PR', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(422, { message: 'Validation failed: no commits between main and publish/vendor-example-1.0.0' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('Validation failed');
  });

  it('falls back to the generic pull-request-creation error when a 422 response carries no message field at all', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(422, {}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
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
    const client = new GithubApiRegistryClient({ token: 'tok' });
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
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await client.createPublishPullRequest(mutation);
    expect(listSignal).toBeInstanceOf(AbortSignal);
  });

  it('rethrows the original "already exists" error when no matching open pull request can be found after all', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(422, { message: 'A pull request already exists for acme:publish/vendor-example-1.0.0.' }),
      'GET https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(200, []),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('A pull request already exists');
  });

  it('rethrows the original "already exists" error when the recovery lookup itself fails', async () => {
    const fetchSpy = happyPathRouter({
      'POST https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(422, { message: 'A pull request already exists for acme:publish/vendor-example-1.0.0.' }),
      'GET https://api.github.com/repos/acme/registry/pulls': () => jsonResponse(500, { message: 'list failed' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('A pull request already exists');
  });

  it('falls back to a generic message when an error body has no message field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));
    const client = new GithubApiRegistryClient({ token: 'tok' });
    await expect(client.createPublishPullRequest(mutation)).rejects.toThrow('GitHub ref lookup failed.');
  });
});
