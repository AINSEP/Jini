import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployError } from '../types.js';
import {
  CloudflarePagesDeployTarget,
  chunkCloudflarePagesAssetUploads,
  cloudflarePagesAssetHash,
  listCloudflarePagesZones,
} from '../cloudflare-pages.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Mirrors `cloudflarePagesDnsMarker`'s derivation (`shortHash` = sha256,
 * hex, sliced to 12 chars) so tests can predict the marker `canPatch...`
 * needs to match, rather than assume the reuse-patch path is unreachable.
 */
function expectedCloudflareDnsMarker(projectName: string, pagesTarget: string): string {
  const shortHash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `jini-deploy:${shortHash(projectName)}:${shortHash(pagesTarget)}`;
}

describe('cloudflarePagesAssetHash', () => {
  it('is deterministic for the same file/data pair', () => {
    const file = { file: 'index.html', data: '<html></html>' };
    expect(cloudflarePagesAssetHash(file)).toBe(cloudflarePagesAssetHash(file));
  });

  it('is a 32-character lowercase hex string', () => {
    const hash = cloudflarePagesAssetHash({ file: 'a.css', data: 'body{}' });
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs for the same bytes under a different file extension', () => {
    const a = cloudflarePagesAssetHash({ file: 'a.css', data: 'x' });
    const b = cloudflarePagesAssetHash({ file: 'a.js', data: 'x' });
    expect(a).not.toBe(b);
  });

  it('hashes a file with no extension (no "." in the filename) without throwing', () => {
    const a = cloudflarePagesAssetHash({ file: 'Makefile', data: 'x' });
    const b = cloudflarePagesAssetHash({ file: 'Dockerfile', data: 'x' });
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    // Same bytes, both extension-less, but different filenames don't affect the hash
    // (only the extension does) — so these two collide, which is expected/documented behavior.
    expect(a).toBe(b);
  });
});

describe('chunkCloudflarePagesAssetUploads', () => {
  it('keeps a single small batch under the file-count cap in one chunk', () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ hash: `h${i}`, data: 'x', contentType: 'text/plain' }));
    const chunks = chunkCloudflarePagesAssetUploads(files);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(5);
  });

  it('splits into multiple batches once the file-count cap is exceeded', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ hash: `h${i}`, data: 'x', contentType: 'text/plain' }));
    const chunks = chunkCloudflarePagesAssetUploads(files, { maxFiles: 4 });
    expect(chunks.map((c) => c.length)).toEqual([4, 4, 2]);
  });

  it('splits into multiple batches once the byte-size cap is exceeded', () => {
    const bigData = 'x'.repeat(1000);
    const files = Array.from({ length: 5 }, (_, i) => ({ hash: `h${i}`, data: bigData, contentType: 'text/plain' }));
    // Each file's estimated payload is ~1000*4/3 + overhead; cap tight enough to force 1-per-batch.
    const chunks = chunkCloudflarePagesAssetUploads(files, { maxBytes: 1500 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length >= 1)).toBe(true);
  });

  it('gives an over-cap single file its own batch rather than dropping it', () => {
    const hugeData = 'x'.repeat(10_000);
    const files = [{ hash: 'solo', data: hugeData, contentType: 'text/plain' }];
    const chunks = chunkCloudflarePagesAssetUploads(files, { maxBytes: 10 });
    expect(chunks).toEqual([[files[0]]]);
  });

  it('returns no chunks for an empty file list', () => {
    expect(chunkCloudflarePagesAssetUploads([])).toEqual([]);
  });

  it('estimates a reasonable payload size for a file missing optional hash/contentType/data (public API, defensive against non-TS callers)', () => {
    // chunkCloudflarePagesAssetUploads/estimateCloudflarePagesAssetUploadPayloadBytes are exported,
    // general-purpose utilities; their own real production caller (uploadCloudflarePagesAssets)
    // always supplies a complete {hash,data,contentType} object, but this file's declared param
    // type for the byte-estimator is deliberately wider (`hash?`, `data?`, `contentType?`) for a
    // caller — like this test, exercising the public surface directly — that doesn't have to be.
    const files = [{} as { hash: string; data: Buffer | Uint8Array | string; contentType?: string }];
    const chunks = chunkCloudflarePagesAssetUploads(files);
    expect(chunks).toEqual([[files[0]]]);
  });
});

describe('listCloudflarePagesZones', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects with DeployError when accountId is missing, without a network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(listCloudflarePagesZones({ token: 'tok', accountId: '' })).rejects.toThrow(DeployError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects with DeployError when token is missing, without a network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(listCloudflarePagesZones({ token: '', accountId: 'acct' })).rejects.toThrow(DeployError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('filters out zones missing an id or name and stops pagination when a page returns fewer items than per_page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          success: true,
          result: [
            { id: 'z1', name: 'Example.com', status: 'active', type: 'full' },
            { id: '', name: 'missing-id.com' },
            { id: 'z2', name: '' },
            { id: 42, name: 'non-string-id.com' },
          ],
          result_info: { count: 4, per_page: 100 },
        }),
      ),
    );

    const { zones } = await listCloudflarePagesZones({ token: 'tok', accountId: 'acct' });
    expect(zones).toEqual([{ id: 'z1', name: 'example.com', status: 'active', type: 'full' }]);
  });

  it('treats a missing/non-array `result` field as zero items for that page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { success: true })));
    const { zones } = await listCloudflarePagesZones({ token: 'tok', accountId: 'acct' });
    expect(zones).toEqual([]);
  });
});

describe('CloudflarePagesDeployTarget.publish', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws DeployError without a network call when accountId is missing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: '' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow(DeployError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws DeployError without a network call when the token is missing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const target = new CloudflarePagesDeployTarget({ token: '', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Cloudflare API token is required.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to "site" in the derived project name when projectName sanitizes to nothing', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('/pages/projects/') && url.endsWith('jini-site') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: { name: 'jini-site' } });
        }
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-site.pages.dev' } });
        }
        if (url.startsWith('https://jini-site.pages.dev')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({ files: [], projectName: '!!!' });
    expect(result.providerMetadata?.projectName).toBe('jini-site');
  });

  it('ensures the project, uploads assets, deploys, and returns the reachable pages.dev URL', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);

        if (url.includes('/pages/projects/') && url.endsWith('jini-demo-site') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(404, { success: false });
        }
        if (url.endsWith('/pages/projects') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'jini-demo-site' } });
        }
        if (url.endsWith('/upload-token')) {
          return jsonResponse(200, { success: true, result: { jwt: 'upload-jwt' } });
        }
        if (url.endsWith('/pages/assets/check-missing')) {
          const body = JSON.parse(String(init?.body));
          return jsonResponse(200, { success: true, result: body.hashes });
        }
        if (url.endsWith('/pages/assets/upload')) {
          return jsonResponse(200, { success: true });
        }
        if (url.endsWith('/pages/assets/upsert-hashes')) {
          return jsonResponse(200, { success: true });
        }
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'depl_1', url: 'jini-demo-site.pages.dev' } });
        }
        // Reachability HEAD probe against the pages.dev production URL.
        if (url === 'https://jini-demo-site.pages.dev/' || url === 'https://jini-demo-site.pages.dev') {
          return new Response('', { status: 200 });
        }
        throw new Error(`Unexpected fetch call in test: ${init?.method ?? 'GET'} ${url}`);
      }),
    );

    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [{ file: 'index.html', data: '<html></html>', contentType: 'text/html' }],
      projectName: 'Demo Site!!',
    });

    expect(result.targetId).toBe('cloudflare-pages');
    expect(result.deploymentId).toBe('depl_1');
    expect(result.url).toBe('https://jini-demo-site.pages.dev');
    expect(result.status).toBe('ready');
    expect(result.providerMetadata?.projectName).toBe('jini-demo-site');
    // Derives the same project name deterministically across the whole flow.
    expect(calls.some((c) => c.includes('jini-demo-site'))).toBe(true);
  });

  it('reuses an existing Cloudflare Pages project when the initial GET already finds it (no 404/create round-trip)', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: { name: 'jini-demo' } });
        }
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
        }
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.status).toBe('ready');
    // No POST to /pages/projects — the project already existed.
    expect(calls.some((c) => c.startsWith('POST') && c.endsWith('/pages/projects'))).toBe(false);
  });

  it('retries the project lookup and succeeds when project creation races into an "already exists" response', async () => {
    let projectLookups = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
          // First GET (before create) 404s; the retry GET (after the raced create) succeeds.
          projectLookups += 1;
          return projectLookups === 1 ? jsonResponse(404, { success: false }) : jsonResponse(200, { success: true, result: { name: 'jini-demo' } });
        }
        if (url.endsWith('/pages/projects') && init?.method === 'POST') {
          return jsonResponse(409, { success: false, errors: [{ message: 'a project with this name already exists' }] });
        }
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
        }
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.status).toBe('ready');
  });

  it('throws the underlying error when project creation fails for a reason other than "already exists"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/pages/projects/') && (!init?.method || init.method === 'GET')) return jsonResponse(404, { success: false });
        if (url.endsWith('/pages/projects') && init?.method === 'POST') {
          return jsonResponse(500, { success: false, errors: [{ message: 'internal error' }] });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('internal error');
  });

  it('throws DeployError when Cloudflare returns a non-JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/pages/projects/') && (!init?.method || init.method === 'GET')) return new Response('not json', { status: 200 });
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow(DeployError);
  });

  it('falls back through the message/messages/generic chain when a Cloudflare error body has no errors[].message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/pages/projects/') && (!init?.method || init.method === 'GET')) return jsonResponse(404, { success: false });
        if (url.endsWith('/pages/projects') && init?.method === 'POST') {
          return jsonResponse(500, { success: false, messages: [{ message: 'from messages array' }] });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('from messages array');
  });

  it('falls back to the caller-supplied fallback message when the error body is empty (no errors[]/messages[]/message)', async () => {
    // `cloudflareError`'s own final `Cloudflare request failed (${status}).` default is unreachable
    // through this module's actual call sites — every call passes its own non-empty fallback text
    // (see the "Flagged for human review" note) — so this exercises the `fallback` disjunct instead.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/pages/projects/') && (!init?.method || init.method === 'GET')) return jsonResponse(404, { success: false });
        if (url.endsWith('/pages/projects') && init?.method === 'POST') return jsonResponse(503, {});
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Cloudflare Pages project creation failed.');
  });

  it('falls back to the raw response body when a found project GET response has no `result` field', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true });
        }
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
        }
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.status).toBe('ready');
  });

  it('throws the underlying error when the initial project lookup fails for a reason other than "not found" (404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
          return jsonResponse(500, { success: false, errors: [{ message: 'project lookup exploded' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('project lookup exploded');
  });

  it('falls back to the raw body when the retry-after-conflict lookup response has no `result` field', async () => {
    let projectLookups = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
          projectLookups += 1;
          return projectLookups === 1 ? jsonResponse(404, { success: false }) : jsonResponse(200, { success: true });
        }
        if (url.endsWith('/pages/projects') && init?.method === 'POST') {
          return jsonResponse(409, { success: false, errors: [{ message: 'a project with this name already exists' }] });
        }
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
        }
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.status).toBe('ready');
  });

  it('falls back to the raw body when the just-created project response has no `result` field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) return jsonResponse(404, { success: false });
        if (url.endsWith('/pages/projects') && init?.method === 'POST') return jsonResponse(200, { success: true });
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
        }
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.status).toBe('ready');
  });

  it('throws DeployError when the API returns a genuinely zero-status network-error response that is also non-JSON', async () => {
    // Response.error() (status 0, type 'error') mirrors the same real fetch-layer failure mode
    // netlify.ts/vercel.ts/github-pages.ts's own equivalent tests exercise.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.error()));
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toMatchObject({ status: 502 });
  });

  it('rejects an asset over the Cloudflare Pages per-asset size cap before any upload call', async () => {
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
        return jsonResponse(404, { success: false });
      }
      if (url.endsWith('/pages/projects') && init?.method === 'POST') {
        return jsonResponse(200, { success: true, result: {} });
      }
      if (url.endsWith('/upload-token')) {
        return jsonResponse(200, { success: true, result: { jwt: 'upload-jwt' } });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const oversized = Buffer.alloc(26 * 1024 * 1024, 1);
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({ files: [{ file: 'big.bin', data: oversized }], projectName: 'demo' }),
    ).rejects.toThrow(/25\.00 MiB or smaller/);
  });
});

describe('CloudflarePagesDeployTarget.publish — custom domain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function baseHandlers(url: string, init: RequestInit | undefined, calls: string[]): Response | undefined {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    // Bare project lookup: `.../pages/projects/<name>` with nothing after it.
    if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
      return jsonResponse(200, { success: true, result: { name: 'jini-demo' } });
    }
    if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
    if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
    if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
    if (url.endsWith('/deployments') && init?.method === 'POST') {
      return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
    }
    if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
    return undefined;
  }

  it('sets up a brand-new custom domain end to end: zone validation, CNAME creation, Pages domain creation, and reachability', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers(url, init, calls);
        if (base) return base;
        if (url.includes('/zones/zone1') && !url.includes('dns_records')) {
          return jsonResponse(200, { success: true, result: { name: 'example.com', status: 'active', type: 'full' } });
        }
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: [] });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'dns-1' } });
        }
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );

    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });

    expect(result.status).toBe('ready');
    expect(result.providerMetadata?.customDomain).toMatchObject({
      hostname: 'demo.example.com',
      status: 'ready',
      dnsStatus: 'created',
      dnsOwnership: 'marked',
      domainStatus: 'active',
    });
  });

  it('reuses an existing exact CNAME record and an already-active Pages domain (idempotent republish)', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers(url, init, calls);
        if (base) return base;
        if (url.includes('/zones/zone1') && !url.includes('dns_records')) {
          return jsonResponse(200, { success: true, result: { name: 'example.com', status: 'active', type: 'full' } });
        }
        if (url.includes('/zones/zone1/dns_records')) {
          return jsonResponse(200, {
            success: true,
            result: [{ id: 'dns-1', type: 'CNAME', name: 'demo.example.com', content: 'jini-demo.pages.dev', comment: 'existing-marker' }],
          });
        }
        if (url.includes('/domains/demo.example.com')) {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );

    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });

    expect(result.providerMetadata?.customDomain).toMatchObject({ dnsStatus: 'reused', domainStatus: 'active', status: 'ready' });
  });

  it('reports a DNS conflict when an unrelated record already occupies the hostname', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers(url, init, calls);
        if (base) return base;
        if (url.includes('/zones/zone1') && !url.includes('dns_records')) {
          return jsonResponse(200, { success: true, result: { name: 'example.com', status: 'active', type: 'full' } });
        }
        if (url.includes('/zones/zone1/dns_records')) {
          return jsonResponse(200, {
            success: true,
            result: [{ id: 'other-1', type: 'A', name: 'demo.example.com', content: '1.2.3.4' }],
          });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );

    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });

    // Custom-domain failure is captured into providerMetadata, not thrown — the base pages.dev
    // result still comes back (see the publish() @tradeoffs doc).
    expect(result.status).toBe('ready');
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'conflict', errorCode: 'cloudflare_dns_record_conflict' });
  });

  it('rejects an invalid custom-domain selection (missing prefix) before making any zone-validation network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({ files: [], projectName: 'demo', metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: '' } } }),
    ).rejects.toThrow(/subdomain prefix/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a syntactically invalid zone name before making any zone-validation network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({
        files: [],
        projectName: 'demo',
        metadata: { customDomain: { zoneId: 'zone1', zoneName: 'not_a_valid_zone!!', domainPrefix: 'demo' } },
      }),
    ).rejects.toThrow(/valid Cloudflare domain/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a zone name containing a double dot ("..") before making any zone-validation network call', async () => {
    // Exercises isValidCloudflareZoneName's own early `!name || name.length > 253 ||
    // name.includes('..')` guard specifically (as opposed to the per-label regex failure the
    // "syntactically invalid" test above exercises).
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({
        files: [],
        projectName: 'demo',
        metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example..com', domainPrefix: 'demo' } },
      }),
    ).rejects.toThrow(/valid Cloudflare domain/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-string zoneId field (still required even though zoneName/domainPrefix are valid)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({
        files: [],
        projectName: 'demo',
        metadata: { customDomain: { zoneId: 123 as unknown as string, zoneName: 'example.com', domainPrefix: 'demo' } },
      }),
    ).rejects.toThrow(/Cloudflare zone is required/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-string zoneName field (metadata is untyped JSON at the real trust boundary)', async () => {
    // DeployPublishInput.metadata is a loosely-typed JsonObject cast to CloudflarePagesPublishMetadata
    // — a real caller deserializing untrusted JSON (an HTTP request body, for example) can easily
    // supply the wrong shape despite the TS interface declaring string fields.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({
        files: [],
        projectName: 'demo',
        metadata: { customDomain: { zoneId: 'zone1', zoneName: 456 as unknown as string, domainPrefix: 'demo' } },
      }),
    ).rejects.toThrow(/valid Cloudflare domain/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a domainPrefix that syntactically fails the label regex despite passing the earlier blank/@/./* checks', async () => {
    // Exercises normalizeCloudflareDomainPrefix's own regex-test false side specifically: a prefix
    // starting with a hyphen is non-empty, isn't '@', and contains neither '.' nor '*', so it
    // clears the first guard, but still fails `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({
        files: [],
        projectName: 'demo',
        metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: '-bad-prefix' } },
      }),
    ).rejects.toThrow(/subdomain prefix/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-string domainPrefix field', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({
        files: [],
        projectName: 'demo',
        metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 789 as unknown as string } },
      }),
    ).rejects.toThrow(/subdomain prefix/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats an all-non-string customDomain object as "no custom domain requested" (falls through to a normal publish)', async () => {
    // Every field non-string means every field normalizes to '' — normalizeCloudflarePagesDeploySelection's
    // own "all three blank" early-exit returns null, same as if metadata.customDomain had been omitted.
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers(url, init, calls);
        if (base) return base;
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 123 as unknown as string, zoneName: 456 as unknown as string, domainPrefix: 789 as unknown as string } },
    });
    expect(result.status).toBe('ready');
    expect(result.providerMetadata?.customDomain).toBeUndefined();
  });

  it('treats an all-empty/whitespace customDomain object (present but every field blank) as "no custom domain requested"', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers(url, init, calls);
        if (base) return base;
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: '  ', zoneName: '  ', domainPrefix: '  ' } },
    });
    expect(result.status).toBe('ready');
    expect(result.providerMetadata?.customDomain).toBeUndefined();
  });

  it('rejects when zoneId is blank but zoneName/domainPrefix are present', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({
        files: [],
        projectName: 'demo',
        metadata: { customDomain: { zoneId: '', zoneName: 'example.com', domainPrefix: 'demo' } },
      }),
    ).rejects.toThrow(/Cloudflare zone is required/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects when the resolved zone no longer matches the selected zone name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/zones/zone1')) return jsonResponse(200, { success: true, result: { name: 'different.com', status: 'active', type: 'full' } });
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({ files: [], projectName: 'demo', metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } } }),
    ).rejects.toThrow(/no longer matches/);
  });

  it('rejects when the zone is not active', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/zones/zone1')) return jsonResponse(200, { success: true, result: { name: 'example.com', status: 'pending', type: 'full' } });
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({ files: [], projectName: 'demo', metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } } }),
    ).rejects.toThrow(/active zone/);
  });

  it('rejects with the underlying error when the zone-lookup call itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/zones/zone1')) return jsonResponse(500, { success: false, errors: [{ message: 'zone lookup exploded' }] });
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({ files: [], projectName: 'demo', metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } } }),
    ).rejects.toThrow('zone lookup exploded');
  });

  it('treats a zone-lookup response with a missing `result` field as an empty zone object (fails the name-match check)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/zones/zone1')) return jsonResponse(200, { success: true });
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({ files: [], projectName: 'demo', metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } } }),
    ).rejects.toThrow(/no longer matches/);
  });

  it('rejects when the zone is not a full DNS zone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/zones/zone1')) return jsonResponse(200, { success: true, result: { name: 'example.com', status: 'active', type: 'partial' } });
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({ files: [], projectName: 'demo', metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } } }),
    ).rejects.toThrow(/full DNS zone/);
  });
});

describe('CloudflarePagesDeployTarget.checkReachability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('probes the given URL with the shared reachability checker', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.checkReachability('https://demo.example.com');
    expect(result.reachable).toBe(true);
  });
});

describe('listCloudflarePagesZones — pagination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows multiple pages using total_pages when the API reports it', async () => {
    let page = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        page += 1;
        return jsonResponse(200, {
          success: true,
          result: [{ id: `z${page}`, name: `zone${page}.com`, status: 'active', type: 'full' }],
          result_info: { total_pages: 2 },
        });
      }),
    );
    const { zones } = await listCloudflarePagesZones({ token: 'tok', accountId: 'acct' });
    expect(zones.map((z) => z.id)).toEqual(['z1', 'z2']);
  });

  it('throws a DeployError when a page response reports success:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { success: false, errors: [{ message: 'zones lookup broke' }] })));
    await expect(listCloudflarePagesZones({ token: 'tok', accountId: 'acct' })).rejects.toThrow('zones lookup broke');
  });

  it('stops pagination immediately when a page comes back with zero items, even with no other pagination hints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { success: true, result: [] })));
    const { zones } = await listCloudflarePagesZones({ token: 'tok', accountId: 'acct' });
    expect(zones).toEqual([]);
  });

  it('uses total_count (not total_pages) to decide whether to keep paginating', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return jsonResponse(200, {
            success: true,
            result: Array.from({ length: 2 }, (_, i) => ({ id: `z${i}`, name: `zone${i}.com`, status: 'active', type: 'full' })),
            // No total_pages; total_count says there are more than this page returned.
            result_info: { total_count: 3, per_page: 2 },
          });
        }
        return jsonResponse(200, {
          success: true,
          result: [{ id: 'z-last', name: 'last.com', status: 'active', type: 'full' }],
          result_info: { total_count: 3, per_page: 2 },
        });
      }),
    );
    const { zones } = await listCloudflarePagesZones({ token: 'tok', accountId: 'acct' });
    expect(calls).toBe(2);
    expect(zones).toHaveLength(3);
  });
});

describe('CloudflarePagesDeployTarget.publish — custom domain conflict/pending states', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function baseHandlers2(url: string, init: RequestInit | undefined): Response | undefined {
    if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
      return jsonResponse(200, { success: true, result: { name: 'jini-demo' } });
    }
    if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
    if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
    if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
    if (url.endsWith('/deployments') && init?.method === 'POST') {
      return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
    }
    if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
    if (url.includes('/zones/zone1') && !url.includes('dns_records')) {
      return jsonResponse(200, { success: true, result: { name: 'example.com', status: 'active', type: 'full' } });
    }
    if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
      return jsonResponse(200, { success: true, result: [] });
    }
    if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
      return jsonResponse(200, { success: true, result: { id: 'dns-1' } });
    }
    return undefined;
  }

  it('throws the underlying error when the Pages custom-domain lookup call itself fails (not 404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers2(url, init);
        if (base) return base;
        if (url.includes('/domains/demo.example.com') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(500, { success: false, errors: [{ message: 'domain lookup broke' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'failed', statusMessage: expect.stringContaining('domain lookup broke') });
  });

  it('treats a found-domain response with a missing `result` field as not matching (falls through to create)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers2(url, init);
        if (base) return base;
        if (url.includes('/domains/demo.example.com') && (!init?.method || init.method === 'GET')) return jsonResponse(200, { success: true });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ domainStatus: 'active', status: 'ready' });
  });

  it('treats a found-domain response whose `name` does not match the looked-up hostname as not found (falls through to create)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers2(url, init);
        if (base) return base;
        if (url.includes('/domains/demo.example.com') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: { name: 'totally-different.example.com', status: 'active' } });
        }
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ domainStatus: 'active', status: 'ready' });
  });

  it('recovers when the domain-create call races into "already bound" and the retry lookup now finds it', async () => {
    let domainLookups = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers2(url, init);
        if (base) return base;
        if (url.includes('/domains/demo.example.com') && (!init?.method || init.method === 'GET')) {
          domainLookups += 1;
          return domainLookups === 1
            ? jsonResponse(404, { success: false })
            : jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(409, { success: false, errors: [{ message: 'already bound to another project' }] });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ domainStatus: 'active', status: 'ready' });
  });

  it('falls back to the raw body when the domain-create response has no `result` field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers2(url, init);
        if (base) return base;
        if (url.includes('/domains/demo.example.com') && (!init?.method || init.method === 'GET')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') return jsonResponse(200, { success: true });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    // No `status` field on the fallback body either — normalizeCloudflarePagesDomainStatus's own
    // `status || ''` fallback (undefined status) classifies this as 'pending'.
    expect(result.providerMetadata?.customDomain).toMatchObject({ domainStatus: 'pending' });
  });

  it('captures a non-JSON domain-create response as the domain-setup failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers2(url, init);
        if (base) return base;
        if (url.includes('/domains/demo.example.com') && (!init?.method || init.method === 'GET')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') return new Response('not json', { status: 502 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'failed', statusMessage: expect.stringContaining('non-JSON') });
  });

  it('reports the custom domain as not-yet-ready when Cloudflare marks it active but the hostname does not actually respond yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers2(url, init);
        if (base) return base;
        if (url.includes('/domains/demo.example.com') && (!init?.method || init.method === 'GET')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        // Cloudflare reports the domain as active, but it doesn't actually respond yet
        // (DNS/TLS propagation delay) — a real, distinct state from both 'ready' and 'failed'.
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 503 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({
      domainStatus: 'active',
      status: 'pending',
      statusMessage: expect.stringContaining('HTTP 503'),
    });
  });

  it('reports a domain conflict when Cloudflare says the hostname is already bound to another project, with no matching domain on retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers2(url, init);
        if (base) return base;
        if (url.includes('/domains/demo.example.com') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(404, { success: false });
        }
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(409, { success: false, errors: [{ message: 'already bound to another project' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'conflict', errorCode: 'cloudflare_domain_already_bound' });
    // The base pages.dev deployment is still reported ready even though the custom domain failed.
    expect(result.status).toBe('ready');
  });

  it('reports the custom domain as pending (not ready) while Cloudflare is still verifying it, and reflects that in the aggregate status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers2(url, init);
        if (base) return base;
        if (url.includes('/domains/demo.example.com') && (!init?.method || init.method === 'GET')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'pending' } });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ domainStatus: 'pending', status: 'pending' });
    // pages.dev itself is ready, but the aggregate must reflect the still-pending custom domain.
    expect(result.status).toBe('link-delayed');
  });
});

describe('CloudflarePagesDeployTarget.publish — core flow failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function coreHandlers(url: string, init: RequestInit | undefined): Response | undefined {
    if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
      return jsonResponse(200, { success: true, result: { name: 'jini-demo' } });
    }
    return undefined;
  }

  it('throws when the upload-token request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(500, { success: false, errors: [{ message: 'upload token unavailable' }] });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('upload token unavailable');
  });

  it('throws when the upload-token response has no jwt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: {} });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('Cloudflare Pages upload token request failed.');
  });

  it('throws when the check-missing asset-lookup call itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(500, { success: false, errors: [{ message: 'asset lookup broke' }] });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: '<html></html>' }], projectName: 'demo' }),
    ).rejects.toThrow('asset lookup broke');
  });

  it('treats a check-missing response with no `result` field at all as the raw body itself', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        // No `result` key at all — `result ?? json` falls back to the whole body, which is
        // neither an array nor `{hashes: [...]}`, so `cloudflarePagesMissingAssetHashes` in turn
        // falls all the way back to treating every sent hash as missing.
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true });
        if (url.endsWith('/pages/assets/upload')) return jsonResponse(200, { success: true });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
        }
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({ files: [{ file: 'index.html', data: '<html></html>' }], projectName: 'demo' });
    expect(result.status).toBe('ready');
  });

  it('reads missing hashes from a `{result: {hashes: [...]}}` response shape (not just a bare array)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) {
          const body = JSON.parse(String(init?.body));
          return jsonResponse(200, { success: true, result: { hashes: body.hashes } });
        }
        if (url.endsWith('/pages/assets/upload')) return jsonResponse(200, { success: true });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
        }
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({ files: [{ file: 'index.html', data: '<html></html>' }], projectName: 'demo' });
    expect(result.status).toBe('ready');
  });

  it('treats a check-missing `result` that is neither an array nor `{hashes:[...]}` as "everything is missing" (falls back to the sent hash list)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: { unexpected: 'shape' } });
        if (url.endsWith('/pages/assets/upload')) return jsonResponse(200, { success: true });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
        }
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({ files: [{ file: 'index.html', data: '<html></html>' }], projectName: 'demo' });
    expect(result.status).toBe('ready');
  });

  it('throws when Cloudflare reports a missing-asset hash this run never actually sent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: ['some-hash-we-never-sent'] });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: '<html></html>' }], projectName: 'demo' }),
    ).rejects.toThrow(/unknown asset hash/);
  });

  it('throws when a missing-asset upload batch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) {
          const body = JSON.parse(String(init?.body));
          return jsonResponse(200, { success: true, result: body.hashes });
        }
        if (url.endsWith('/pages/assets/upload')) {
          return jsonResponse(502, { success: false, errors: [{ message: 'asset upload broke' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: '<html></html>' }], projectName: 'demo' }),
    ).rejects.toThrow('asset upload broke');
  });

  it('throws when upsert-hashes fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) {
          return jsonResponse(502, { success: false, errors: [{ message: 'hash upsert broke' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('hash upsert broke');
  });

  it('falls back to the raw body when the deployment-creation response has no `result` field, and omits deploymentId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') return jsonResponse(200, { success: true });
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(result.deploymentId).toBeUndefined();
    // No deployment.url either — falls back to the derived jini-demo.pages.dev production URL.
    expect(result.url).toBe('https://jini-demo.pages.dev');
  });

  it('throws when the deployment creation call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = coreHandlers(url, init);
        if (base) return base;
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(502, { success: false, errors: [{ message: 'deployment creation broke' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    await expect(target.publish({ files: [], projectName: 'demo' })).rejects.toThrow('deployment creation broke');
  });
});

describe('listCloudflarePagesZones — pagination fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to comparing itemCount against perPage when result_info has no total_pages/total_count/count', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        // A full page (itemCount === perPage) with no pagination hints at all
        // must still be treated as "there might be more" (line 267's
        // fallback), while a short final page stops.
        const items =
          calls === 1
            ? Array.from({ length: 5 }, (_, i) => ({ id: `z${i}`, name: `zone${i}.com`, status: 'active', type: 'full' }))
            : [{ id: 'z-last', name: 'last.com', status: 'active', type: 'full' }];
        return jsonResponse(200, { success: true, result: items, result_info: {} });
      }, ),
    );
    const { zones } = await listCloudflarePagesZones({ token: 'tok', accountId: 'acct' });
    // First page returned perPage(=100)? No — 5 < 100, so the fallback
    // `itemCount >= perPage` is false and pagination stops after page 1.
    expect(calls).toBe(1);
    expect(zones).toHaveLength(5);
  });

  it('keeps paginating via the itemCount-vs-perPage fallback when a page comes back exactly full', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          // Exactly perPage (100, the default) items with no pagination
          // hints: `itemCount >= perPage` is true, so it must fetch page 2.
          const items = Array.from({ length: 100 }, (_, i) => ({ id: `z${i}`, name: `zone${i}.com`, status: 'active', type: 'full' }));
          return jsonResponse(200, { success: true, result: items, result_info: {} });
        }
        // A short second page stops pagination (itemCount(1) < perPage(100)).
        return jsonResponse(200, { success: true, result: [{ id: 'z-last', name: 'last.com', status: 'active', type: 'full' }], result_info: {} });
      }),
    );
    const { zones } = await listCloudflarePagesZones({ token: 'tok', accountId: 'acct' });
    expect(calls).toBe(2);
    expect(zones).toHaveLength(101);
  });
});

describe('CloudflarePagesDeployTarget.publish — custom domain: DNS record reuse-by-patch and races', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function baseHandlers3(url: string, init: RequestInit | undefined): Response | undefined {
    if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
      return jsonResponse(200, { success: true, result: { name: 'jini-demo' } });
    }
    if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
    if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
    if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
    if (url.endsWith('/deployments') && init?.method === 'POST') {
      return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
    }
    if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 200 });
    if (url.includes('/zones/zone1') && !url.includes('dns_records')) {
      return jsonResponse(200, { success: true, result: { name: 'example.com', status: 'active', type: 'full' } });
    }
    return undefined;
  }

  it('throws with the underlying error when the DNS records list call itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records')) return jsonResponse(500, { success: false, errors: [{ message: 'dns list broke' }] });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'failed', statusMessage: expect.stringContaining('dns list broke') });
  });

  it('treats a DNS records list response with a missing `result` field as zero records (no conflict, proceeds to create)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) return jsonResponse(200, { success: true });
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') return jsonResponse(200, { success: true, result: { id: 'dns-1' } });
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ dnsStatus: 'created', status: 'ready' });
  });

  it('falls back to the raw body when the DNS record creation response has no `result` field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) return jsonResponse(200, { success: true, result: [] });
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') return jsonResponse(200, { success: true });
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ dnsStatus: 'created', status: 'ready' });
  });

  it('captures a non-JSON DNS-record-creation response as the DNS failure (not treated as a duplicate or a comment error)', async () => {
    // A malformed/non-JSON response from the create-record POST makes readCloudflareJson throw a
    // DeployError with no `details` (unlike cloudflareError's usual JSON-body details) — exercising
    // the `err.details || err.message` fallback in both maybeReuseCloudflarePagesCnameAfterDuplicate
    // and the outer comment-retry check, isCloudflareCommentError's string-typed `value` branch, and
    // setupCloudflarePagesCustomDomain's own `typeof err.details === 'object' ? ... : {}` fallback.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) return jsonResponse(200, { success: true, result: [] });
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') return new Response('not json', { status: 502 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({
      status: 'failed',
      statusMessage: expect.stringContaining('non-JSON'),
    });
  });

  it('finds an exact CNAME match even when an unrelated record in the list has a missing/falsy `type` field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, {
            success: true,
            result: [
              { id: 'no-type-record', name: 'demo.example.com', content: 'something-else' }, // type is missing entirely
              { id: 'exact-1', type: 'CNAME', name: 'demo.example.com', content: 'jini-demo.pages.dev' },
            ],
          });
        }
        if (url.includes('/domains/demo.example.com')) {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    // The exact match (id 'exact-1') is what gets reused, proving the type-less record didn't
    // false-positive-match and didn't crash the `.toUpperCase()` call.
    expect(result.providerMetadata?.customDomain).toMatchObject({ dnsStatus: 'reused', dnsRecordId: 'exact-1' });
  });

  it('reuses a matched record with a missing/non-string `id`, surfacing dnsRecordId as undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, {
            success: true,
            result: [{ id: 42, type: 'CNAME', name: 'demo.example.com', content: 'jini-demo.pages.dev', comment: 'whatever' }],
          });
        }
        if (url.includes('/domains/demo.example.com')) {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ dnsStatus: 'reused', dnsRecordId: undefined, dnsOwnership: 'unmarked' });
  });

  it('reuses an exact match whose comment matches the marker we would have stamped, reporting dnsOwnership as marked', async () => {
    const marker = expectedCloudflareDnsMarker('jini-demo', 'jini-demo.pages.dev');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, {
            success: true,
            result: [{ id: 'exact-marked', type: 'CNAME', name: 'demo.example.com', content: 'jini-demo.pages.dev', comment: marker }],
          });
        }
        if (url.includes('/domains/demo.example.com')) {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ dnsStatus: 'reused', dnsOwnership: 'marked' });
  });

  it('patches a prior-owned CNAME record in place when its id/marker match this run\'s prior metadata', async () => {
    // publish({projectName:'demo'}) always derives config.projectName === 'jini-demo'
    // (asserted throughout this file's other tests), and the pages.dev target
    // is always `${config.projectName}.pages.dev` — both deterministic, so the
    // marker `canPatchCloudflarePagesCname` requires is computable up front.
    const marker = expectedCloudflareDnsMarker('jini-demo', 'jini-demo.pages.dev');
    let patchedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, {
            success: true,
            result: [
              {
                id: 'prior-record-id',
                type: 'CNAME',
                name: 'demo.example.com',
                content: 'stale-target.pages.dev', // NOT the current target — no exact match
                comment: marker,
              },
            ],
          });
        }
        if (url.includes('/zones/zone1/dns_records/prior-record-id') && init?.method === 'PATCH') {
          patchedBody = JSON.parse(String(init.body));
          return jsonResponse(200, { success: true, result: { id: 'prior-record-id' } });
        }
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );

    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: {
        customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' },
        priorCustomDomain: { dnsRecordId: 'prior-record-id', marker },
      },
    });

    expect(result.providerMetadata?.customDomain).toMatchObject({
      dnsStatus: 'patched',
      dnsRecordId: 'prior-record-id',
      dnsOwnership: 'marked',
      status: 'ready',
    });
    expect(patchedBody).toMatchObject({ type: 'CNAME', name: 'demo.example.com', content: 'jini-demo.pages.dev', comment: marker });
  });

  it('reports a conflict (not a patch) when a same-name conflicting record has a missing/falsy `type` field', async () => {
    // Exercises canPatchCloudflarePagesCname's own `String(record.type || '').toUpperCase()`
    // fallback specifically — a type-less record can never satisfy `=== 'CNAME'`, so it always
    // falls to the conflict path regardless of prior metadata, but the branch itself must still
    // be exercised for real.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, {
            success: true,
            result: [{ id: 'typeless-conflict', name: 'demo.example.com', content: 'unrelated.pages.dev' }],
          });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'conflict', errorCode: 'cloudflare_dns_record_conflict' });
  });

  it('falls back to the pre-known conflicting record id when the PATCH response has no `result.id`', async () => {
    const marker = expectedCloudflareDnsMarker('jini-demo', 'jini-demo.pages.dev');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, {
            success: true,
            result: [{ id: 'prior-record-id', type: 'CNAME', name: 'demo.example.com', content: 'stale-target.pages.dev', comment: marker }],
          });
        }
        if (url.includes('/zones/zone1/dns_records/prior-record-id') && init?.method === 'PATCH') {
          return jsonResponse(200, { success: true }); // No `result` at all this time.
        }
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: {
        customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' },
        priorCustomDomain: { dnsRecordId: 'prior-record-id', marker },
      },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ dnsStatus: 'patched', dnsRecordId: 'prior-record-id' });
  });

  it('captures the underlying error when the PATCH call to update a prior-owned CNAME fails', async () => {
    const marker = expectedCloudflareDnsMarker('jini-demo', 'jini-demo.pages.dev');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, {
            success: true,
            result: [{ id: 'prior-record-id', type: 'CNAME', name: 'demo.example.com', content: 'stale-target.pages.dev', comment: marker }],
          });
        }
        if (url.includes('/zones/zone1/dns_records/prior-record-id') && init?.method === 'PATCH') {
          return jsonResponse(500, { success: false, errors: [{ message: 'patch exploded' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: {
        customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' },
        priorCustomDomain: { dnsRecordId: 'prior-record-id', marker },
      },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'failed', statusMessage: expect.stringContaining('patch exploded') });
  });

  it('reports a conflict (not a patch) when a same-name record exists but its id/marker do not match prior metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, {
            success: true,
            result: [{ id: 'someone-elses-record', type: 'CNAME', name: 'demo.example.com', content: 'unrelated.pages.dev', comment: 'not-ours' }],
          });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'conflict', errorCode: 'cloudflare_dns_record_conflict' });
  });

  it('reuses a CNAME created by a racing publish when creation 409s as "already exists" and a re-list finds the exact match', async () => {
    let listCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          listCalls += 1;
          // First list (before create): nothing there yet.
          if (listCalls === 1) return jsonResponse(200, { success: true, result: [] });
          // Second list (after the raced create): the other publish's record now exists.
          return jsonResponse(200, {
            success: true,
            result: [{ id: 'raced-in-record', type: 'CNAME', name: 'demo.example.com', content: 'jini-demo.pages.dev', comment: 'other-run-marker' }],
          });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          return jsonResponse(409, { success: false, errors: [{ message: 'record already exists' }] });
        }
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ dnsStatus: 'reused', status: 'ready' });
  });

  it('reports a conflict when creation races into "already exists" but the re-list finds a different, unrelated record', async () => {
    let listCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          listCalls += 1;
          if (listCalls === 1) return jsonResponse(200, { success: true, result: [] });
          return jsonResponse(200, {
            success: true,
            result: [{ id: 'unrelated', type: 'A', name: 'demo.example.com', content: '9.9.9.9' }],
          });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          return jsonResponse(409, { success: false, errors: [{ message: 'record already exists' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'conflict', errorCode: 'cloudflare_dns_record_conflict' });
  });

  it('rethrows the original "already exists" error when a race is suspected but the re-list finds nothing at all', async () => {
    let listCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          listCalls += 1;
          return jsonResponse(200, { success: true, result: [] }); // still nothing, even on re-list
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          return jsonResponse(409, { success: false, errors: [{ message: 'record already exists, somehow' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    // The re-list found no record at all — the original DeployError propagates
    // as the DNS-setup failure captured into providerMetadata.
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'failed', statusMessage: expect.stringContaining('already exists') });
  });

  it('retries without the comment field when Cloudflare rejects the comment field itself, and succeeds unmarked', async () => {
    let createAttempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: [] });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          createAttempts += 1;
          const body = JSON.parse(String(init.body));
          if (createAttempts === 1) {
            expect(body.comment).toBeDefined();
            return jsonResponse(400, { success: false, errors: [{ message: 'comment field is not supported on this plan' }] });
          }
          expect(body.comment).toBeUndefined();
          return jsonResponse(200, { success: true, result: { id: 'created-unmarked' } });
        }
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(createAttempts).toBe(2);
    expect(result.providerMetadata?.customDomain).toMatchObject({ dnsStatus: 'created', dnsOwnership: 'unmarked', status: 'ready' });
  });

  it('reuses the racing record when the comment-field retry itself races into "already exists"', async () => {
    let createAttempts = 0;
    let listCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          listCalls += 1;
          if (listCalls === 1) return jsonResponse(200, { success: true, result: [] });
          return jsonResponse(200, {
            success: true,
            result: [{ id: 'raced-record-2', type: 'CNAME', name: 'demo.example.com', content: 'jini-demo.pages.dev', comment: '' }],
          });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          createAttempts += 1;
          if (createAttempts === 1) {
            return jsonResponse(400, { success: false, errors: [{ message: 'comment field is not supported on this plan' }] });
          }
          return jsonResponse(409, { success: false, errors: [{ message: 'record already exists' }] });
        }
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(createAttempts).toBe(2);
    expect(result.providerMetadata?.customDomain).toMatchObject({ dnsStatus: 'reused', status: 'ready' });
  });

  it('rethrows the comment-retry failure as-is when it is neither a duplicate nor a comment error', async () => {
    let createAttempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: [] });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          createAttempts += 1;
          if (createAttempts === 1) {
            return jsonResponse(400, { success: false, errors: [{ message: 'comment field is not supported on this plan' }] });
          }
          // The comment-retry's own failure is unrelated to duplicates or
          // comments — maybeReuseCloudflarePagesCnameAfterDuplicate bails out
          // (line 527) rather than rethrowing itself, so the outer catch's
          // own `throw retryErr` (line 593) is what actually surfaces it.
          return jsonResponse(500, { success: false, errors: [{ message: 'totally unrelated internal error' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(createAttempts).toBe(2);
    expect(result.providerMetadata?.customDomain).toMatchObject({
      status: 'failed',
      statusMessage: expect.stringContaining('totally unrelated internal error'),
    });
  });

  it('throws the underlying DeployError when creation fails for a reason unrelated to duplicates or comments', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: [] });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          return jsonResponse(500, { success: false, errors: [{ message: 'internal server explosion' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'failed', statusMessage: expect.stringContaining('internal server explosion') });
  });

  it('captures a generic Cloudflare Pages domain-setup failure (not "already bound") into providerMetadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: [] });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'dns-ok' } });
        }
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(500, { success: false, errors: [{ message: 'domain setup exploded' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'failed', statusMessage: expect.stringContaining('domain setup exploded') });
  });

  it('reports the custom domain as failed when Cloudflare marks it error/blocked/deactivated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const base = baseHandlers3(url, init);
        if (base) return base;
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: [] });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'dns-ok' } });
        }
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'error' } });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const result = await target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    expect(result.providerMetadata?.customDomain).toMatchObject({
      domainStatus: 'failed',
      status: 'failed',
      statusMessage: 'Cloudflare Pages reported a custom-domain error.',
    });
  });
});

describe('CloudflarePagesDeployTarget.publish — aggregate status: pages.dev not-ready plus a failed custom domain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reports the aggregate status/message from the not-ready pages.dev link, not the custom-domain failure message', async () => {
    // aggregateCloudflarePagesStatus's else-branch (customDomain.status is 'conflict'/'failed', not
    // 'ready'/'pending') has its own `pagesDev.status === 'ready' ? ... : pagesDev.statusMessage ||
    // customFailureMessage` ternary — this drives it down the `false` side, which is only
    // reachable by making the base pages.dev link itself never become reachable.
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: { name: 'jini-demo' } });
        }
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
        }
        // pages.dev never comes up.
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 500 });
        if (url.includes('/zones/zone1') && !url.includes('dns_records')) {
          return jsonResponse(200, { success: true, result: { name: 'example.com', status: 'active', type: 'full' } });
        }
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: [] });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'dns-1' } });
        }
        // Custom domain setup itself fails outright.
        if (url.includes('/domains/demo.example.com') && (!init?.method || init.method === 'GET')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(500, { success: false, errors: [{ message: 'domain create exploded' }] });
        }
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );

    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const publishPromise = target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    await vi.advanceTimersByTimeAsync(65_000);
    const result = await publishPromise;

    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'failed', statusMessage: expect.stringContaining('domain create exploded') });
    // The aggregate status/message reflects pages.dev's own not-yet-reachable state, not the
    // custom-domain failure — proving the `pagesDev.statusMessage || customFailureMessage` side
    // actually took the `pagesDev.statusMessage` branch (always truthy) rather than crashing or
    // silently swallowing it.
    expect(result.status).toBe('link-delayed');
    expect(result.statusMessage).not.toContain('domain create exploded');
  }, 20_000);
});

describe('CloudflarePagesDeployTarget.publish — custom domain ready before pages.dev itself', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reflects a not-yet-reachable pages.dev link even once the custom domain is ready (aggregate stays link-delayed)', async () => {
    // waitForReachableDeploymentUrl's pages.dev poll has no caller-exposed
    // timeout override from CloudflarePagesDeployTarget.publish(), so
    // forcing pages.dev to never become reachable means riding out its real
    // default 60s/2s poll — done here with fake timers instead of a real
    // 60-second test.
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (/\/pages\/projects\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: { name: 'jini-demo' } });
        }
        if (url.endsWith('/upload-token')) return jsonResponse(200, { success: true, result: { jwt: 'jwt' } });
        if (url.endsWith('/pages/assets/check-missing')) return jsonResponse(200, { success: true, result: [] });
        if (url.endsWith('/pages/assets/upsert-hashes')) return jsonResponse(200, { success: true });
        if (url.endsWith('/deployments') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'd1', url: 'jini-demo.pages.dev' } });
        }
        // The pages.dev link never comes up — every probe 500s.
        if (url.startsWith('https://jini-demo.pages.dev')) return new Response('', { status: 500 });
        if (url.includes('/zones/zone1') && !url.includes('dns_records')) {
          return jsonResponse(200, { success: true, result: { name: 'example.com', status: 'active', type: 'full' } });
        }
        if (url.includes('/zones/zone1/dns_records') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { success: true, result: [] });
        }
        if (url.includes('/zones/zone1/dns_records') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { id: 'dns-1' } });
        }
        if (url.includes('/domains/demo.example.com')) return jsonResponse(404, { success: false });
        if (url.endsWith('/domains') && init?.method === 'POST') {
          return jsonResponse(200, { success: true, result: { name: 'demo.example.com', status: 'active' } });
        }
        // The custom domain itself is reachable right away.
        if (url.startsWith('https://demo.example.com')) return new Response('', { status: 200 });
        throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
      }),
    );

    const target = new CloudflarePagesDeployTarget({ token: 'tok', accountId: 'acct' });
    const publishPromise = target.publish({
      files: [],
      projectName: 'demo',
      metadata: { customDomain: { zoneId: 'zone1', zoneName: 'example.com', domainPrefix: 'demo' } },
    });
    // Drive the pages.dev reachability poll (default 60s timeout, 2s
    // interval) to exhaustion without a real wall-clock wait.
    await vi.advanceTimersByTimeAsync(65_000);
    const result = await publishPromise;

    expect(result.status).toBe('link-delayed');
    expect(result.providerMetadata?.pagesDev).toMatchObject({ status: 'link-delayed' });
    expect(result.providerMetadata?.customDomain).toMatchObject({ status: 'ready', domainStatus: 'active' });
  }, 20_000);
});
