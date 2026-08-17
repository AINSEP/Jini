import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployError } from '../types.js';
import { GitHubPagesDeployTarget } from '../github-pages.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Shorthand matcher: does `url` end with `.../pages` exactly (not `.../pages/builds/latest`)? */
function isPagesSiteUrl(url: string): boolean {
  return url.endsWith('/pages');
}

describe('GitHubPagesDeployTarget.publish', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws DeployError without making a network call when token is missing', async () => {
    const target = new GitHubPagesDeployTarget({ token: '', owner: 'octo', repo: 'demo' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow(DeployError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws DeployError without making a network call when owner is missing', async () => {
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: '', repo: 'demo' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('GitHub Pages owner and repo are required.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws DeployError without making a network call when repo is missing', async () => {
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: '' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('GitHub Pages owner and repo are required.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses to follow a redirect on the branch-ref lookup, and requests redirect: manual on every call', async () => {
    const fetchSpy = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      return new Response('', { status: 302, headers: { location: 'https://evil.example/steal-token' } });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [{ file: 'index.html', data: 'hi' }], projectName: 'demo' })).rejects.toThrow(
      /attempted to redirect/
    );
    // Never advanced past the ref lookup to create a blob — the redirect was refused, not just logged.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('publishes a brand-new site: no existing branch, no existing Pages config, dedupes identical file content into one blob', async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    let blobCalls = 0;
    let buildPollCount = 0;

    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) {
        return new Response('', { status: 404 });
      }
      if (method === 'POST' && url.endsWith('/git/blobs')) {
        blobCalls += 1;
        return jsonResponse(201, { sha: `blob-sha-${blobCalls}` });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) {
        const body = JSON.parse(String(init?.body));
        expect(body.tree).toEqual([
          { path: 'index.html', mode: '100644', type: 'blob', sha: 'blob-sha-1' },
          { path: 'about.html', mode: '100644', type: 'blob', sha: 'blob-sha-1' },
        ]);
        return jsonResponse(201, { sha: 'tree-sha-1' });
      }
      if (method === 'POST' && url.endsWith('/git/commits')) {
        const body = JSON.parse(String(init?.body));
        expect(body.parents).toEqual([]);
        expect(body.tree).toBe('tree-sha-1');
        expect(body.message).toBe('Deploy My Demo Site via @jini-ai/deploy');
        return jsonResponse(201, { sha: 'commit-sha-1' });
      }
      if (method === 'POST' && url.endsWith('/git/refs')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({ ref: 'refs/heads/gh-pages', sha: 'commit-sha-1' });
        return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha-1', type: 'commit' } });
      }
      if (method === 'GET' && isPagesSiteUrl(url)) {
        return new Response('', { status: 404 });
      }
      if (method === 'POST' && isPagesSiteUrl(url)) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({ source: { branch: 'gh-pages', path: '/' }, build_type: 'legacy' });
        return jsonResponse(201, { html_url: 'https://octo.github.io/demo/', url: 'https://api.github.com/repos/octo/demo/pages', source: { branch: 'gh-pages', path: '/' } });
      }
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) {
        buildPollCount += 1;
        if (buildPollCount === 1) return new Response('', { status: 404 });
        if (buildPollCount === 2) return jsonResponse(200, { commit: 'some-other-old-sha', status: 'built' });
        if (buildPollCount === 3) return jsonResponse(200, { commit: 'commit-sha-1', status: 'building' });
        return jsonResponse(200, { commit: 'commit-sha-1', status: 'built' });
      }
      // Reachability probe.
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const result = await target.publish({
      files: [
        { file: 'index.html', data: '<html></html>' },
        { file: 'about.html', data: '<html></html>' },
      ],
      projectName: 'My Demo Site',
    });

    expect(result.targetId).toBe('github-pages');
    expect(result.deploymentId).toBe('commit-sha-1');
    expect(result.status).toBe('ready');
    expect(result.url).toBe('https://octo.github.io/demo/');
    expect(result.providerMetadata).toEqual({ owner: 'octo', repo: 'demo', branch: 'gh-pages', branchCreated: true });

    expect(blobCalls).toBe(1); // both files share identical content
    expect(buildPollCount).toBe(4);
  });

  it('bounds every call in the ref -> blob -> tree -> commit -> branch -> pages -> build-poll chain with a timeout signal', async () => {
    const signals: Record<string, AbortSignal | null | undefined> = {};
    let buildPollCount = 0;

    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) {
        signals.refLookup = init?.signal;
        return new Response('', { status: 404 });
      }
      if (method === 'POST' && url.endsWith('/git/blobs')) {
        signals.blob = init?.signal;
        return jsonResponse(201, { sha: 'blob-sha-1' });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) {
        signals.tree = init?.signal;
        return jsonResponse(201, { sha: 'tree-sha-1' });
      }
      if (method === 'POST' && url.endsWith('/git/commits')) {
        signals.commit = init?.signal;
        return jsonResponse(201, { sha: 'commit-sha-1' });
      }
      if (method === 'POST' && url.endsWith('/git/refs')) {
        signals.createRef = init?.signal;
        return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha-1', type: 'commit' } });
      }
      if (method === 'GET' && isPagesSiteUrl(url)) {
        signals.pagesLookup = init?.signal;
        return new Response('', { status: 404 });
      }
      if (method === 'POST' && isPagesSiteUrl(url)) {
        signals.pagesCreate = init?.signal;
        return jsonResponse(201, { html_url: 'https://octo.github.io/demo/', source: { branch: 'gh-pages', path: '/' } });
      }
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) {
        buildPollCount += 1;
        signals.buildPoll = init?.signal;
        return jsonResponse(200, { commit: 'commit-sha-1', status: 'built' });
      }
      // Reachability probe — a different, already-protected call site.
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await target.publish({ files: [{ file: 'index.html', data: '<html></html>' }], projectName: 'demo' });

    expect(buildPollCount).toBeGreaterThan(0);
    for (const [name, signal] of Object.entries(signals)) {
      expect(signal, `${name} should carry a timeout AbortSignal`).toBeInstanceOf(AbortSignal);
    }
    expect(Object.keys(signals).sort()).toEqual(
      ['blob', 'buildPoll', 'commit', 'createRef', 'pagesCreate', 'pagesLookup', 'refLookup', 'tree'].sort(),
    );
  });

  it('bounds the PATCH branch-update call with a timeout signal too', async () => {
    let updateRefSignal: AbortSignal | null | undefined;
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) {
        return jsonResponse(200, { ref: 'refs/heads/gh-pages', object: { sha: 'old-tip-sha', type: 'commit' } });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'new-commit-sha' });
      if (method === 'PATCH' && url.endsWith('/git/refs/heads/gh-pages')) {
        updateRefSignal = init?.signal;
        return jsonResponse(200, { ref: 'refs/heads/gh-pages', object: { sha: 'new-commit-sha', type: 'commit' } });
      }
      if (method === 'GET' && isPagesSiteUrl(url)) {
        return jsonResponse(200, { html_url: 'https://octo.github.io/demo/', source: { branch: 'gh-pages', path: '/' } });
      }
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) {
        return jsonResponse(200, { commit: 'new-commit-sha', status: 'built' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await target.publish({ files: [], projectName: 'demo' });
    expect(updateRefSignal).toBeInstanceOf(AbortSignal);
  });

  it('updates an existing branch (force push) instead of creating a new ref when the branch already has a tip commit', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) {
        return jsonResponse(200, { ref: 'refs/heads/gh-pages', object: { sha: 'old-tip-sha', type: 'commit' } });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) {
        const body = JSON.parse(String(init?.body));
        expect(body.parents).toEqual(['old-tip-sha']);
        return jsonResponse(201, { sha: 'new-commit-sha' });
      }
      if (method === 'PATCH' && url.endsWith('/git/refs/heads/gh-pages')) {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({ sha: 'new-commit-sha', force: true });
        return jsonResponse(200, { ref: 'refs/heads/gh-pages', object: { sha: 'new-commit-sha', type: 'commit' } });
      }
      if (method === 'POST' && url.endsWith('/git/refs')) {
        throw new Error('should not create a new ref when the branch already exists');
      }
      if (method === 'GET' && isPagesSiteUrl(url)) {
        return jsonResponse(200, { html_url: 'https://octo.github.io/demo/', source: { branch: 'gh-pages', path: '/' } });
      }
      if (method === 'POST' && isPagesSiteUrl(url)) {
        throw new Error('should not re-create an already-enabled Pages site');
      }
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) {
        return jsonResponse(200, { commit: 'new-commit-sha', status: 'built' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.providerMetadata).toEqual({ owner: 'octo', repo: 'demo', branch: 'gh-pages', branchCreated: false });
  });

  it('flags sourceBranchMismatch when the existing Pages site is configured against a different branch', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) {
        return jsonResponse(200, { html_url: 'https://octo.github.io/demo/', source: { branch: 'main', path: '/docs' } });
      }
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) return jsonResponse(200, { commit: 'commit-sha', status: 'built' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.providerMetadata).toEqual({ owner: 'octo', repo: 'demo', branch: 'gh-pages', branchCreated: true, sourceBranchMismatch: true });
  });

  it('uses a caller-supplied branch instead of the gh-pages default', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/site')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) {
        const body = JSON.parse(String(init?.body));
        expect(body.ref).toBe('refs/heads/site');
        return jsonResponse(201, { ref: 'refs/heads/site', object: { sha: 'commit-sha', type: 'commit' } });
      }
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) {
        const body = JSON.parse(String(init?.body));
        expect(body.source).toEqual({ branch: 'site', path: '/' });
        return jsonResponse(201, { html_url: 'https://octo.github.io/demo/', source: { branch: 'site', path: '/' } });
      }
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) return jsonResponse(200, { commit: 'commit-sha', status: 'built' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo', branch: 'site' });
    await target.publish({ files: [], projectName: 'demo' });
  });

  it('throws DeployError when the Pages build reaches a terminal errored state, surfacing error.message', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(201, { html_url: 'https://octo.github.io/demo/' });
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) {
        return jsonResponse(200, { commit: 'commit-sha', status: 'errored', error: { message: 'Page build failed.' } });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Page build failed.');
  });

  it('throws DeployError with a generic message when a terminal errored build carries no error.message', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(201, { html_url: 'https://octo.github.io/demo/' });
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) {
        return jsonResponse(200, { commit: 'commit-sha', status: 'errored' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('GitHub Pages build errored.');
  });

  it('proceeds to the reachability wait using whatever Pages URL it already has when the build poll exhausts its 30-attempt budget', async () => {
    vi.useFakeTimers();
    try {
      let pollCount = 0;
      const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
        if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
        if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
        if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
        if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
        if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(201, { html_url: 'https://octo.github.io/demo/' });
        if (method === 'GET' && url.endsWith('/pages/builds/latest')) {
          pollCount += 1;
          return jsonResponse(200, { commit: 'commit-sha', status: 'building' });
        }
        return new Response('', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchSpy);

      const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
      const publishPromise = target.publish({ files: [], projectName: 'demo' });
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await publishPromise;

      expect(pollCount).toBe(30);
      expect(result.status).toBe('ready');
      expect(result.url).toBe('https://octo.github.io/demo/');
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it('throws DeployError with the message field when blob creation fails', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/blobs')) return jsonResponse(422, { message: 'Blob too large' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [{ file: 'a.txt', data: 'a' }], projectName: 'demo' })).rejects.toThrow('Blob too large');
  });

  it('throws DeployError when a blob response has no sha', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/blobs')) return jsonResponse(201, {});
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [{ file: 'a.txt', data: 'a' }], projectName: 'demo' })).rejects.toThrow(
      'GitHub blob response did not include a sha.',
    );
  });

  it('throws DeployError with the message field when tree creation fails', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(422, { message: 'Invalid tree entry' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Invalid tree entry');
  });

  it('throws DeployError when a tree response has no sha', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, {});
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('GitHub tree response did not include a sha.');
  });

  it('throws DeployError with the message field when commit creation fails', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(422, { message: 'Invalid commit' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Invalid commit');
  });

  it('throws DeployError when a commit response has no sha', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, {});
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('GitHub commit response did not include a sha.');
  });

  it('throws DeployError with the message field when creating a new branch ref fails', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(422, { message: 'Reference already exists' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Reference already exists');
  });

  it('throws DeployError with the message field when updating an existing branch ref fails', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) {
        return jsonResponse(200, { ref: 'refs/heads/gh-pages', object: { sha: 'old-sha', type: 'commit' } });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'PATCH' && url.endsWith('/git/refs/heads/gh-pages')) return jsonResponse(422, { message: 'Update is not a fast forward' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Update is not a fast forward');
  });

  it('throws DeployError with the message field when the branch lookup itself fails (not a 404)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(403, { message: 'Forbidden' }));
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Forbidden');
  });

  it('throws DeployError with the message field when the Pages site lookup fails (not a 404)', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return jsonResponse(500, { message: 'Internal error' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Internal error');
  });

  it('throws DeployError with the message field when Pages site creation fails', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(422, { message: 'Pages already building elsewhere' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Pages already building elsewhere');
  });

  it('falls back to HTTP 502 when a non-JSON response carries no HTTP status of its own', async () => {
    // `Response.error()` is the Fetch spec's own "network error" response:
    // status 0, ok: false, null body — the same real shape `netlify.test.ts`
    // exercises for its own `readNetlifyJson` catch branch.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.error()));
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const err = (await target.publish({ files: [], projectName: 'demo' }).catch((e: unknown) => e)) as DeployError;
    expect(err).toBeInstanceOf(DeployError);
    expect(err.message).toBe('GitHub returned a non-JSON response.');
    expect(err.status).toBe(502);
  });

  it('treats a malformed branch-ref response (200 OK, but no object.sha) the same as a not-yet-existing branch', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) {
        // A 200 with no usable `object.sha` — malformed, but should not crash;
        // treated the same as "branch doesn't exist yet" (no parent commit).
        return jsonResponse(200, { ref: 'refs/heads/gh-pages' });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) {
        const body = JSON.parse(String(init?.body));
        expect(body.parents).toEqual([]);
        return jsonResponse(201, { sha: 'commit-sha' });
      }
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(201, { html_url: 'https://octo.github.io/demo/' });
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) return jsonResponse(200, { commit: 'commit-sha', status: 'built' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.providerMetadata).toMatchObject({ branchCreated: true });
  });

  it('keeps polling past a builds/latest entry with a non-string commit or status field before matching the real build', async () => {
    let pollCount = 0;
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(201, { html_url: 'https://octo.github.io/demo/' });
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) {
        pollCount += 1;
        // 1st poll: no `commit` field at all (defensive fallback to '').
        if (pollCount === 1) return jsonResponse(200, {});
        // 2nd poll: our commit, but no `status` field (defensive fallback to '').
        if (pollCount === 2) return jsonResponse(200, { commit: 'commit-sha' });
        return jsonResponse(200, { commit: 'commit-sha', status: 'built' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(pollCount).toBe(3);
    expect(result.status).toBe('ready');
  });

  it('keeps polling past a builds/latest response that fails to parse as JSON instead of treating it as a hard failure', async () => {
    // Regression for a live publish (2026-08-16) that reported `published: false` /
    // 'GitHub returned a non-JSON response.' even though the commit, ref, and Pages site
    // had ALL already been created — an immediately-following byte-identical retry
    // succeeded, and the only state that changed between the two runs was that a build
    // record now existed. This reproduces the mechanism: the very first poll right after
    // `ensureGitHubPagesSite` hits before GitHub's build-tracking record exists yet, but
    // returns a 200 with an empty body instead of the already-handled 404 — `readGitHubJson`
    // rejects on `resp.json()` and (before this fix) `pollGitHubPagesBuild` let that
    // exception propagate all the way out of `publish()`, turning an ambiguous polling
    // hiccup into a reported publish failure for content that was already live.
    let pollCount = 0;
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(201, { html_url: 'https://octo.github.io/demo/' });
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) {
        pollCount += 1;
        // 1st poll: a 200 with an empty body — no build-tracking record exists yet, but
        // GitHub did not (this time) signal that with a 404 the way the rest of this
        // file's tests assume.
        if (pollCount === 1) return new Response('', { status: 200 });
        return jsonResponse(200, { commit: 'commit-sha', status: 'built' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(pollCount).toBe(2);
    expect(result.status).toBe('ready');
  });

  it('throws DeployError when a build status check fails mid-poll (not a 404)', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(201, { html_url: 'https://octo.github.io/demo/' });
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) return jsonResponse(503, { message: 'Service unavailable' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Service unavailable');
  });

  it('throws DeployError when a response body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('GitHub returned a non-JSON response.');
  });

  it('falls back to a bare url when html_url is absent from the Pages site response', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(201, { url: 'octo.github.io/demo' });
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) return jsonResponse(200, { commit: 'commit-sha', status: 'built' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.url).toBe('https://octo.github.io/demo');
  });

  it('falls back to an empty URL and link-delayed status when the Pages site response has no URL at all', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(201, {});
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) return jsonResponse(200, { commit: 'commit-sha', status: 'built' });
      throw new Error('should never reach a reachability probe with no candidate URL');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.url).toBe('');
    expect(result.status).toBe('link-delayed');
    expect(result).not.toHaveProperty('reachableAt');
  });

  it('falls back to "site" in the commit message when projectName is blank/whitespace', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) {
        const body = JSON.parse(String(init?.body));
        expect(body.message).toBe('Deploy site via @jini-ai/deploy');
        return jsonResponse(201, { sha: 'commit-sha' });
      }
      if (method === 'POST' && url.endsWith('/git/refs')) return jsonResponse(201, { ref: 'refs/heads/gh-pages', object: { sha: 'commit-sha', type: 'commit' } });
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) return jsonResponse(201, { html_url: 'https://octo.github.io/demo/' });
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) return jsonResponse(200, { commit: 'commit-sha', status: 'built' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await target.publish({ files: [], projectName: '   ' });
  });

  it('checkReachability probes the URL without any protected-response detection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const result = await target.checkReachability('https://octo.github.io/demo/');
    expect(result.reachable).toBe(true);
  });
});
