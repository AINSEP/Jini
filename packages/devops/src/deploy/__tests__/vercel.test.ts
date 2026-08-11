import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployError } from '../types.js';
import { VercelDeployTarget, isVercelProtectedResponse } from '../vercel.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('isVercelProtectedResponse', () => {
  it('detects Vercel SSO nonce cookie as a protected-link signal', () => {
    const resp = new Response('', { headers: { 'set-cookie': '_vercel_sso_nonce=abc; Path=/' } });
    expect(isVercelProtectedResponse(resp)).toBe(true);
  });

  it('detects the Vercel Authentication body text as a protected-link signal', () => {
    const resp = new Response('', {});
    expect(isVercelProtectedResponse(resp, 'Vercel Authentication required to view this deployment')).toBe(true);
  });

  it('returns false for a plain unrelated 401', () => {
    const resp = new Response('', {});
    expect(isVercelProtectedResponse(resp, 'unauthorized')).toBe(false);
  });
});

describe('VercelDeployTarget.publish', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws DeployError without making a network call when token is missing', async () => {
    const target = new VercelDeployTarget({ token: '' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow(DeployError);
  });

  it('creates a deployment, polls until READY, and returns the reachable URL', async () => {
    const createBody = { id: 'dpl_1', readyState: 'QUEUED', url: 'demo-abc123.vercel.app' };
    const readyBody = { id: 'dpl_1', readyState: 'READY', url: 'demo-abc123.vercel.app' };

    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        // Assert the deployment name was sanitized from the caller's projectName.
        const parsed = JSON.parse(String(init.body));
        expect(parsed.name).toBe('my-demo-site');
        return jsonResponse(200, createBody);
      }
      if (String(input).includes('/v13/deployments/dpl_1')) {
        return jsonResponse(200, readyBody);
      }
      // Reachability probe against the deployment URL.
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({
      files: [{ file: 'index.html', data: '<html></html>', contentType: 'text/html' }],
      projectName: 'My Demo Site!!',
    });

    expect(result.targetId).toBe('vercel');
    expect(result.deploymentId).toBe('dpl_1');
    expect(result.status).toBe('ready');
    expect(result.url).toBe('https://demo-abc123.vercel.app');
  });

  it('throws DeployError when Vercel reports readyState ERROR', async () => {
    const createBody = { id: 'dpl_2', readyState: 'QUEUED', url: 'demo.vercel.app' };
    const errorBody = { id: 'dpl_2', readyState: 'ERROR', error: { message: 'Build failed' } };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        return jsonResponse(200, errorBody);
      }),
    );

    const target = new VercelDeployTarget({ token: 'tok' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' }),
    ).rejects.toThrow('Build failed');
  });

  it('surfaces a permission-denied Vercel error with a friendly message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: 'forbidden', message: 'no access' } })),
    );

    const target = new VercelDeployTarget({ token: 'tok' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' }),
    ).rejects.toThrow("You don't have permission to create a project.");
  });

  it('surfaces a generic permission-phrased error message even without a "forbidden" code', async () => {
    // Exercises the second half of the `code === 'forbidden' || /permission/i.test(message)` OR.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { message: 'missing permission to deploy' })));
    const target = new VercelDeployTarget({ token: 'tok' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' }),
    ).rejects.toThrow("You don't have permission to create a project.");
  });

  it('falls back to a generic "Vercel request failed" message when the error body carries neither an error object nor a message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));
    const target = new VercelDeployTarget({ token: 'tok' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' }),
    ).rejects.toThrow('Vercel request failed (500).');
  });

  it('throws DeployError when Vercel responds with a non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    const target = new VercelDeployTarget({ token: 'tok' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' }),
    ).rejects.toThrow(DeployError);
  });

  it('falls back to `uid` for polling/deploymentId when the create response has no `id` field', async () => {
    // Vercel's own deployments API has historically used both `id` and `uid` across API
    // versions/endpoints for the same concept; this covers the `typeof created.uid === 'string'`
    // fallback side of the nested ternary.
    const createBody = { uid: 'dpl_uid_only', readyState: 'QUEUED', url: 'demo.vercel.app' };
    const readyBody = { uid: 'dpl_uid_only', readyState: 'READY', url: 'demo.vercel.app' };
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(200, createBody);
      if (String(input).includes('/v13/deployments/dpl_uid_only')) return jsonResponse(200, readyBody);
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(result.deploymentId).toBe('dpl_uid_only');
  });

  it('falls back to a generic "Vercel deployment failed" message when a terminal ERROR state carries no error object at all', async () => {
    const createBody = { id: 'dpl_noerr', readyState: 'QUEUED', url: 'demo.vercel.app' };
    const errorBody = { id: 'dpl_noerr', readyState: 'ERROR' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        return jsonResponse(200, errorBody);
      }),
    );
    const target = new VercelDeployTarget({ token: 'tok' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' }),
    ).rejects.toThrow('Vercel deployment failed.');
  });

  it('throws DeployError when the poll status check itself (not the initial create) receives a non-ok response', async () => {
    const createBody = { id: 'dpl_pollfail', readyState: 'QUEUED', url: 'demo.vercel.app' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        return jsonResponse(500, {});
      }),
    );
    const target = new VercelDeployTarget({ token: 'tok' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' }),
    ).rejects.toThrow('Vercel request failed (500).');
  });

  it('falls back to `resp.status || 502` when a zero-status network-error response is also non-JSON', async () => {
    // Response.error() produces a real zero-status (`status: 0`, `type: 'error'`) opaque Response
    // whose body can't be parsed as JSON, exercising both readVercelJson's catch AND the
    // `resp.status || 502` fallback (0 is falsy) in the same real call.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.error()));
    const target = new VercelDeployTarget({ token: 'tok' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('leaves the url already-absolute when a candidate is returned with an explicit https:// prefix', async () => {
    // deploymentUrl()'s `/^https?:\/\//i.test(url) ? url : \`https://${url}\`` true side: Vercel's
    // `alias`/`url` fields are usually bare hostnames, but nothing prevents a fully-qualified
    // value from coming back (or a caller-shaped test double), and this file must not double-prefix it.
    const createBody = { readyState: 'READY', url: 'https://already-absolute.vercel.app' };
    const probed: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        probed.push(String(input));
        return new Response('', { status: 200 });
      }),
    );
    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(result.url).toBe('https://already-absolute.vercel.app');
    expect(probed[0]).toBe('https://already-absolute.vercel.app/');
  });

  it("falls back to alias[0] in deploymentUrl()'s own url resolution when the response has no top-level url field", async () => {
    // deploymentUrl() is called unconditionally for `initialUrl` right after create, independent
    // of the reachability wait — this covers its `(json?.alias)?.[0]` fallback branch specifically
    // (as opposed to deploymentUrlCandidates' separate, already-covered `.alias` loop).
    const createBody = { readyState: 'READY', alias: ['alias-only.vercel.app'] };
    const probed: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        probed.push(String(input));
        return new Response('', { status: 200 });
      }),
    );
    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(result.url).toBe('https://alias-only.vercel.app');
  });

  it('collects a plain-string entry from the `aliases` array (not just object-shaped {domain}/{url} entries)', async () => {
    const createBody = {
      readyState: 'READY',
      aliases: ['plain-string-alias.example'],
    };
    const probed: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        probed.push(String(input));
        return new Response('', { status: 200 });
      }),
    );
    const target = new VercelDeployTarget({ token: 'tok' });
    await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(probed[0]).toBe('https://plain-string-alias.example/');
  });

  it('falls all the way through to an empty url/no-reachableAt result when neither the create/ready responses nor a fallback url exist', async () => {
    // Every url-bearing field (`url`, `alias`, `aliases`) is absent from both the create response
    // and (since there's no id/uid) the "ready" response is the same object — so
    // deploymentUrlCandidates() is empty, forcing the `[initialUrl]` fallback path
    // (candidates.length === 0), and deploymentUrl() on both `created`/`ready` also resolves to
    // ''. This exercises: candidates.length===0 -> [initialUrl]; the full
    // `link.url || deploymentUrl(ready) || initialUrl` fallback chain bottoming out; and
    // `reachableAt` staying absent (link-delayed with no candidates never sets it).
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy.mockResolvedValue(jsonResponse(200, { readyState: 'READY' })));
    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(result.url).toBe('');
    expect(result.status).toBe('link-delayed');
    expect(result.reachableAt).toBeUndefined();
    // One create call only — no reachability probe network call, since waitForReachableDeploymentUrl
    // short-circuits before ever calling fetch when its candidate list is empty.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('skips polling entirely when the create response carries neither an id nor a uid', async () => {
    // ready = created directly (no deploymentId), so this must complete with exactly one fetch call.
    const fetchSpy = vi.fn(async () => jsonResponse(200, { url: 'demo.vercel.app' }));
    vi.stubGlobal('fetch', fetchSpy);

    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });

    expect(result.deploymentId).toBeUndefined();
    expect(result.url).toBe('https://demo.vercel.app');
    // One create call plus one reachability probe — no poll call in between.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('collects deployment URL candidates from string aliases, and from aliases entries shaped as {domain} or {url} objects', async () => {
    const createBody = {
      id: 'dpl_3',
      readyState: 'READY',
      url: 'primary.vercel.app',
      alias: ['alias-one.vercel.app'],
      aliases: [{ domain: 'from-domain.example' }, { url: 'from-url.example' }, 42, { neither: true }],
    };
    const probed: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        if (String(input).includes('/v13/deployments/dpl_3')) return jsonResponse(200, createBody);
        probed.push(String(input));
        return new Response('', { status: 200 });
      }),
    );

    const target = new VercelDeployTarget({ token: 'tok' });
    await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });

    // The first probed candidate wins (waitForReachableDeploymentUrl tries them in order); assert
    // the full candidate set was actually assembled by checking the winning one is among them.
    expect(probed[0]).toMatch(/^https:\/\/(primary\.vercel\.app|alias-one\.vercel\.app|from-domain\.example|from-url\.example)/);
  });

  it('returns the last known deployment state once polling exhausts its 30-attempt budget without a terminal readyState', async () => {
    // pollVercelDeployment's attempt budget/backoff are fixed constants (~1s
    // for the first 5 attempts, 2s thereafter — ~55s total) with no
    // caller-facing override, so driving it to exhaustion for real would
    // cost ~55s of wall-clock time per run. Fake timers step through the
    // same real setTimeout/fetch/json await chain deterministically instead.
    vi.useFakeTimers();
    try {
      const createBody = { id: 'dpl_never_ready', readyState: 'QUEUED', url: 'demo.vercel.app' };
      const pollingBody = { id: 'dpl_never_ready', readyState: 'BUILDING', url: 'demo.vercel.app' };
      let pollCount = 0;
      const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        if (String(input).includes('/v13/deployments/dpl_never_ready')) {
          pollCount += 1;
          return jsonResponse(200, pollingBody);
        }
        // Reachability probe against the deployment URL — reachable immediately.
        return new Response('', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchSpy);

      const target = new VercelDeployTarget({ token: 'tok' });
      const publishPromise = target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
      // 5 attempts * 1000ms + 25 attempts * 2000ms = 55_000ms; give it headroom.
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await publishPromise;

      expect(pollCount).toBe(30);
      expect(result.deploymentId).toBe('dpl_never_ready');
      expect(result.url).toBe('https://demo.vercel.app');
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it('checkReachability probes the URL with the Vercel-protected-response detector wired in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.checkReachability('https://demo.vercel.app');
    expect(result.reachable).toBe(true);
  });

  it('includes teamId (preferred over teamSlug) or teamSlug in the query string when configured', async () => {
    const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(200, { url: 'demo.vercel.app' }));
    vi.stubGlobal('fetch', fetchSpy);

    const withTeamId = new VercelDeployTarget({ token: 'tok', teamId: 'team_1', teamSlug: 'ignored-slug' });
    await withTeamId.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('teamId=team_1');

    fetchSpy.mockClear();
    const withTeamSlug = new VercelDeployTarget({ token: 'tok', teamSlug: 'my-team' });
    await withTeamSlug.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('slug=my-team');
  });

  it('falls back to a random project name when the caller-supplied projectName sanitizes to nothing', async () => {
    const fetchSpy = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const parsed = JSON.parse(String(init.body));
        expect(parsed.name).toMatch(/^deploy-[a-z0-9]+$/);
        return jsonResponse(200, { url: 'demo.vercel.app' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new VercelDeployTarget({ token: 'tok' });
    await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: '!!!' });
  });
});
