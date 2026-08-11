import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployError } from '../types.js';
import { NetlifyDeployTarget } from '../netlify.js';
import * as naming from '../naming.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function sha1(data: string): string {
  return createHash('sha1').update(Buffer.from(data)).digest('hex');
}

describe('NetlifyDeployTarget.publish', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws DeployError without making a network call when token is missing', async () => {
    const target = new NetlifyDeployTarget({ token: '' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow(DeployError);
  });

  it('throws DeployError without making a network call when a site name cannot be derived', async () => {
    // `deriveNetlifySiteName`'s own fallback (`|| 'site'`) means no real
    // `projectName` can reach this guard today — verified by tracing
    // `safeDnsLabel`/`safeProjectLabel`, which always floor to a non-empty
    // label. This proves the defensive throw itself still behaves
    // correctly if that sanitizer's guarantee ever changes, rather than
    // leaving the branch silently unverified.
    const spy = vi.spyOn(naming, 'safeDnsLabel').mockReturnValue('');
    try {
      const target = new NetlifyDeployTarget({ token: 'tok' });
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow(DeployError);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('finds an existing site, uploads only required files, polls to ready, and returns the reachable URL', async () => {
    const fileHash = sha1('<html></html>');
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];

    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body });

      if (method === 'GET' && url.includes('/sites?')) {
        expect(url).toContain('name=jini-my-demo-site');
        return jsonResponse(200, [{ id: 'site_1', name: 'jini-my-demo-site', ssl_url: 'https://jini-my-demo-site.netlify.app' }]);
      }
      if (method === 'POST' && url.endsWith('/sites/site_1/deploys')) {
        const parsed = JSON.parse(String(init?.body));
        expect(parsed.async).toBe(true);
        expect(parsed.files).toEqual({ '/index.html': fileHash });
        return jsonResponse(200, { id: 'deploy_1', state: 'preparing', required: [fileHash] });
      }
      if (method === 'PUT' && url.includes('/deploys/deploy_1/files/index.html')) {
        return jsonResponse(200, { id: 'f1', path: '/index.html', sha: fileHash, size: 13 });
      }
      if (method === 'GET' && url.endsWith('/deploys/deploy_1')) {
        return jsonResponse(200, { id: 'deploy_1', state: 'ready', ssl_url: 'https://jini-my-demo-site.netlify.app' });
      }
      // Reachability probe.
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new NetlifyDeployTarget({ token: 'tok' });
    const result = await target.publish({
      files: [{ file: 'index.html', data: '<html></html>', contentType: 'text/html' }],
      projectName: 'My Demo Site!!',
    });

    expect(result.targetId).toBe('netlify');
    expect(result.deploymentId).toBe('deploy_1');
    expect(result.status).toBe('ready');
    expect(result.url).toBe('https://jini-my-demo-site.netlify.app');
    expect(result.providerMetadata).toEqual({ siteId: 'site_1', siteName: 'jini-my-demo-site' });

    // Exactly one file upload happened (the only required hash).
    const uploads = calls.filter((c) => c.method === 'PUT');
    expect(uploads).toHaveLength(1);
  });

  it('creates a new site when none exists yet', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, []);
      if (method === 'POST' && url.endsWith('/sites')) {
        const parsed = JSON.parse(String(init?.body));
        expect(parsed.name).toBe('jini-demo');
        return jsonResponse(200, { id: 'site_new', name: 'jini-demo', ssl_url: 'https://jini-demo.netlify.app' });
      }
      if (method === 'POST' && url.endsWith('/sites/site_new/deploys')) {
        return jsonResponse(200, { id: 'deploy_new', state: 'ready', required: [] });
      }
      if (method === 'GET' && url.endsWith('/deploys/deploy_new')) {
        return jsonResponse(200, { id: 'deploy_new', state: 'ready', ssl_url: 'https://jini-demo.netlify.app' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new NetlifyDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.providerMetadata).toEqual({ siteId: 'site_new', siteName: 'jini-demo' });
  });

  it('recovers from a site-creation conflict by re-listing and using the now-existing site', async () => {
    let listCount = 0;
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) {
        listCount += 1;
        if (listCount === 1) return jsonResponse(200, []);
        return jsonResponse(200, [{ id: 'site_race', name: 'jini-demo' }]);
      }
      if (method === 'POST' && url.endsWith('/sites')) {
        return jsonResponse(422, { code: 422, message: 'Name has already been taken' });
      }
      if (method === 'POST' && url.endsWith('/sites/site_race/deploys')) {
        return jsonResponse(200, { id: 'deploy_race', state: 'ready', required: [] });
      }
      if (method === 'GET' && url.endsWith('/deploys/deploy_race')) {
        return jsonResponse(200, { id: 'deploy_race', state: 'ready', url: 'jini-demo.netlify.app' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new NetlifyDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.providerMetadata).toEqual({ siteId: 'site_race', siteName: 'jini-demo' });
    expect(listCount).toBe(2);
  });

  it('throws the original creation error when the site truly cannot be found after a failed create', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, []);
      if (method === 'POST' && url.endsWith('/sites')) {
        return jsonResponse(422, { code: 422, message: 'Name has already been taken' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Name has already been taken');
  });

  it('throws DeployError when Netlify reports a terminal error state, surfacing error_message', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
      if (method === 'POST' && url.endsWith('/deploys')) return jsonResponse(200, { id: 'deploy_err', state: 'preparing', required: [] });
      if (method === 'GET' && url.endsWith('/deploys/deploy_err')) {
        return jsonResponse(200, { id: 'deploy_err', state: 'error', error_message: 'Build script failed' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Build script failed');
  });

  it('throws DeployError with a generic message when a terminal failure state carries no error_message', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
      if (method === 'POST' && url.endsWith('/deploys')) return jsonResponse(200, { id: 'deploy_rej', state: 'preparing', required: [] });
      if (method === 'GET' && url.endsWith('/deploys/deploy_rej')) {
        return jsonResponse(200, { id: 'deploy_rej', state: 'rejected' });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Netlify deployment rejected.');
  });

  it('throws DeployError with the message field when site lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { code: 401, message: 'Invalid token' })));
    const target = new NetlifyDeployTarget({ token: 'bad' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Invalid token');
  });

  it('falls back to a generic message when an error body has no message field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));
    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Netlify site lookup failed.');
  });

  it('throws DeployError when a response body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow(DeployError);
  });

  it('throws DeployError when the site response has no id', async () => {
    // A fresh `Response` per call (not `mockResolvedValue` sharing one instance) — both the
    // site-lookup GET and the site-creation POST read `.json()`, and a `Response` body can
    // only be consumed once.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse(200, { name: 'jini-demo' })));
    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Netlify site response did not include an id.');
  });

  it('throws DeployError when the deploy response has no id', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
      if (method === 'POST' && url.endsWith('/deploys')) return jsonResponse(200, { state: 'preparing', required: [] });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Netlify deploy response did not include an id.');
  });

  it('throws DeployError when a required file upload fails', async () => {
    const fileHash = sha1('x');
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
      if (method === 'POST' && url.endsWith('/deploys')) return jsonResponse(200, { id: 'deploy_1', state: 'preparing', required: [fileHash] });
      if (method === 'PUT') return jsonResponse(413, { code: 413, message: 'Payload too large' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(
      target.publish({ files: [{ file: 'big.bin', data: 'x' }], projectName: 'demo' }),
    ).rejects.toThrow('Payload too large');
  });

  it('skips uploading a hash Netlify reports as required but that is not in the sent manifest', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
      if (method === 'POST' && url.endsWith('/deploys')) {
        return jsonResponse(200, { id: 'deploy_1', state: 'preparing', required: ['unknown-hash-not-in-manifest'] });
      }
      if (method === 'PUT') throw new Error('should never upload an unknown hash');
      if (method === 'GET' && url.endsWith('/deploys/deploy_1')) return jsonResponse(200, { id: 'deploy_1', state: 'ready', url: 'demo.netlify.app' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new NetlifyDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'a.txt', data: 'a' }], projectName: 'demo' });
    expect(result.status).toBe('ready');
  });

  it('URL-encodes nested file paths for the upload endpoint and treats duplicate-content files as one upload', async () => {
    const shared = sha1('same-content');
    const paths: string[] = [];
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
      if (method === 'POST' && url.endsWith('/deploys')) {
        const parsed = JSON.parse(String(init?.body));
        expect(parsed.files).toEqual({ '/assets/a b.txt': shared, '/assets/c.txt': shared });
        return jsonResponse(200, { id: 'deploy_1', state: 'preparing', required: [shared] });
      }
      if (method === 'PUT') {
        paths.push(url);
        return jsonResponse(200, {});
      }
      if (method === 'GET' && url.endsWith('/deploys/deploy_1')) return jsonResponse(200, { id: 'deploy_1', state: 'ready', url: 'demo.netlify.app' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new NetlifyDeployTarget({ token: 'tok' });
    await target.publish({
      files: [
        { file: 'assets/a b.txt', data: 'same-content' },
        { file: 'assets/c.txt', data: 'same-content' },
      ],
      projectName: 'demo',
    });
    // Only the first file sharing the hash gets uploaded — Netlify already knows every
    // manifest path mapped to that hash from the create-deploy call.
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('/deploys/deploy_1/files/assets/a%20b.txt');
  });

  it('returns the last known deploy state once polling exhausts its 30-attempt budget without a terminal state', async () => {
    vi.useFakeTimers();
    try {
      let pollCount = 0;
      const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
        if (method === 'POST' && url.endsWith('/deploys')) return jsonResponse(200, { id: 'deploy_stuck', state: 'preparing', required: [] });
        if (method === 'GET' && url.endsWith('/deploys/deploy_stuck')) {
          pollCount += 1;
          return jsonResponse(200, { id: 'deploy_stuck', state: 'processing', url: 'demo.netlify.app' });
        }
        return new Response('', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchSpy);

      const target = new NetlifyDeployTarget({ token: 'tok' });
      const publishPromise = target.publish({ files: [], projectName: 'demo' });
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await publishPromise;

      expect(pollCount).toBe(30);
      expect(result.deploymentId).toBe('deploy_stuck');
      expect(result.url).toBe('https://demo.netlify.app');
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it('checkReachability probes the URL without any protected-response detection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    const target = new NetlifyDeployTarget({ token: 'tok' });
    const result = await target.checkReachability('https://demo.netlify.app');
    expect(result.reachable).toBe(true);
  });

  it('skips the required-uploads loop entirely when the deploy-creation response omits a `required` array', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
      if (method === 'POST' && url.endsWith('/deploys')) {
        // No `required` field at all — Netlify's real API always includes
        // it, but the code treats a non-array value defensively rather
        // than crashing on `.filter`.
        return jsonResponse(200, { id: 'deploy_1', state: 'preparing' });
      }
      if (method === 'PUT') throw new Error('should never upload when the deploy response has no required array');
      if (method === 'GET' && url.endsWith('/deploys/deploy_1')) return jsonResponse(200, { id: 'deploy_1', state: 'ready', url: 'demo.netlify.app' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new NetlifyDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'a.txt', data: 'a' }], projectName: 'demo' });
    expect(result.status).toBe('ready');
  });

  it('falls back to an empty URL and omits reachableAt when no response provides a candidate deployment URL', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
      if (method === 'POST' && url.endsWith('/deploys')) return jsonResponse(200, { id: 'deploy_1', state: 'preparing', required: [] });
      if (method === 'GET' && url.endsWith('/deploys/deploy_1')) return jsonResponse(200, { id: 'deploy_1', state: 'ready' });
      // Neither the site nor the deploy carried any URL field, so
      // `waitForReachableDeploymentUrl` should short-circuit on an empty
      // candidate list without ever probing reachability.
      throw new Error(`unexpected reachability probe: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new NetlifyDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.url).toBe('');
    expect(result.status).toBe('link-delayed');
    expect(result).not.toHaveProperty('reachableAt');
  });

  it('falls back to deploy_ssl_url / deploy_url when neither response carries ssl_url or url', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) {
        return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo', deploy_url: 'demo.netlify.app' }]);
      }
      if (method === 'POST' && url.endsWith('/deploys')) return jsonResponse(200, { id: 'deploy_1', state: 'preparing', required: [] });
      if (method === 'GET' && url.endsWith('/deploys/deploy_1')) {
        return jsonResponse(200, { id: 'deploy_1', state: 'ready', deploy_ssl_url: 'deploy-preview--demo.netlify.app' });
      }
      // Reachability probe against whichever candidate URL is tried first.
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new NetlifyDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    // `finalState` (the deploy response, carrying `deploy_ssl_url`) is
    // scanned before `site` (carrying `deploy_url`), so its candidate wins.
    expect(result.url).toBe('https://deploy-preview--demo.netlify.app');
  });

  it('handles a non-object (array) error body from a failed site lookup by falling back to a generic message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, ['unexpected', 'array', 'body'])));
    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Netlify site lookup failed.');
  });

  it('falls back to HTTP 502 when a non-JSON response carries no HTTP status of its own', async () => {
    // `Response.error()` is the Fetch spec's own "network error" response:
    // status 0, ok: false, null body — a real shape a `fetch` mock (or a
    // browser-hosted caller relying on the opaque-response path) can hand
    // back, unlike a status manufactured out of thin air (the `Response`
    // constructor itself rejects any status outside 200-599).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.error()));
    const target = new NetlifyDeployTarget({ token: 'tok' });
    const err = (await target.publish({ files: [], projectName: 'demo' }).catch((e: unknown) => e)) as DeployError;
    expect(err).toBeInstanceOf(DeployError);
    expect(err.message).toBe('Netlify returned a non-JSON response.');
    expect(err.status).toBe(502);
  });

  it('throws DeployError with the message field when deploy creation itself fails', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
      if (method === 'POST' && url.endsWith('/deploys')) return jsonResponse(422, { code: 422, message: 'Too many files in one deploy' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Too many files in one deploy');
  });

  it('throws DeployError when a deploy status check fails mid-poll', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/sites?')) return jsonResponse(200, [{ id: 'site_1', name: 'jini-demo' }]);
      if (method === 'POST' && url.endsWith('/deploys')) return jsonResponse(200, { id: 'deploy_1', state: 'preparing', required: [] });
      if (method === 'GET' && url.endsWith('/deploys/deploy_1')) return jsonResponse(503, { code: 503, message: 'Service unavailable' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new NetlifyDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Service unavailable');
  });
});
