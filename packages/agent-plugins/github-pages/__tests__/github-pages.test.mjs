// Moved from Tovu's apps/website/src/features/agent-plugins/__tests__/unit/bundled-deploy-github-pages.unit.test.ts (types stripped), then with the plugin into Jini
// (2026-11-02): the host kit is now `./fake-deploy-host-kit.mjs`, a test double over the same devops helpers.
import path from "node:path";
import { describe, it, afterEach } from "node:test";
import { pathToFileURL } from "node:url";

import { DeployError } from "@jini-ai/devops/deploy";

import { createFakeDeployHostKit } from "./fake-deploy-host-kit.mjs";

import { expect, installNetworkGuard, vi } from "./vitest-compat.mjs";

/**
 * @file The bundled `github-pages` plugin's module
 * (`targets/github-pages.mjs`).
 *
 * PORTED, not re-authored, from `@jini-ai/devops` `src/deploy/__tests__/github-pages.test.ts` at Jini
 * commit 28f67f9a (vitest): every original case below the "Ported" marker is unchanged, running on
 * node:test through `./vitest-compat.mjs` with the module bound to the fake host kit (whose
 * `fetch` calls the stubbed global `fetch` at call time). The network guard fails the file if any
 * call reaches an unstubbed `fetch`. The cases above the marker are new: the module contract, the
 * `.nojekyll` marker, the base path and config validation that used to live in Tovu core.
 */

installNetworkGuard();

const MODULE_PATH = path.resolve(import.meta.dirname, "../targets/github-pages.mjs");


const loaded = (await import(pathToFileURL(MODULE_PATH).href));
const { GitHubPagesDeployTarget } = loaded.bindGitHubPages(createFakeDeployHostKit());

/** A GitHub API double for one publish to an existing `octo/demo` gh-pages branch; returns the tree
 *  paths committed and the branch the ref lookup asked for. */
function stubGitHubApi() {
  let treePaths = [];
  const refUrls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("https://api.github.com/")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
        expect(new Headers(init?.headers).get("Accept")).toBe("application/vnd.github+json");
      }
      if (method === "GET" && url.includes("/git/ref/heads/")) {
        refUrls.push(url);
        return jsonResponse(200, { object: { sha: "parent-sha" } });
      }
      if (method === "POST" && url.endsWith("/git/blobs")) return jsonResponse(201, { sha: "blob-sha" });
      if (method === "POST" && url.endsWith("/git/trees")) {
        treePaths = JSON.parse(String(init?.body)).tree.map((entry) => entry.path);
        return jsonResponse(201, { sha: "tree-sha" });
      }
      if (method === "POST" && url.endsWith("/git/commits")) return jsonResponse(201, { sha: "commit-sha" });
      if (method === "PATCH" && url.includes("/git/refs/heads/")) return jsonResponse(200, {});
      if (method === "GET" && url.endsWith("/pages")) return jsonResponse(200, { html_url: "https://octo.github.io/demo/", source: { branch: "gh-pages" } });
      if (method === "GET" && url.includes("/pages/builds")) return jsonResponse(200, { status: "built", commit: "commit-sha" });
      if (url.startsWith("https://octo.github.io")) return new Response("", { status: 200 });
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    }),
  );
  return { treePaths: () => treePaths, refUrls };
}

describe("hosting plugin module contract (github-pages)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const kit = { ...createFakeDeployHostKit(), sleep: async () => undefined };

  it("create() builds a target from the token and the config's owner/repo/branch, and publishes a .nojekyll marker", async () => {
    const api = stubGitHubApi();
    const target = loaded.default.create({ credential: { token: "tok" }, config: { target: "github-pages", owner: "octo", repo: "demo", branch: "site" }, kit });
    expect(target.id).toBe("github-pages");
    const result = await target.publish({ files: [{ file: "index.html", data: "<html></html>" }], projectName: "demo" });
    expect(result.url).toBe("https://octo.github.io/demo/");
    expect(api.treePaths()).toEqual(["index.html", ".nojekyll"]);
    expect(api.refUrls[0]).toContain("/repos/octo/demo/git/ref/heads/site");
  });

  it("a site-supplied .nojekyll is not duplicated", async () => {
    const api = stubGitHubApi();
    const target = loaded.default.create({ credential: { token: "tok" }, config: { target: "github-pages", owner: "octo", repo: "demo" }, kit });
    await target.publish({ files: [{ file: ".nojekyll", data: "" }, { file: "index.html", data: "hi" }], projectName: "demo" });
    expect(api.treePaths()).toEqual([".nojekyll", "index.html"]);
  });

  it("responseHeaders are ignored: GitHub Pages has no header config, and no header file is published", async () => {
    const api = stubGitHubApi();
    const target = loaded.default.create({ credential: { token: "tok" }, config: { target: "github-pages", owner: "octo", repo: "demo" }, kit });
    await target.publish({ files: [{ file: "index.html", data: "hi" }], projectName: "demo", responseHeaders: { "X-Frame-Options": "DENY" } });
    expect(api.treePaths()).toEqual(["index.html", ".nojekyll"]);
  });

  for (const status of [200, 401, 403, 429, 503]) {
    it(`verifyCredential classifies HTTP ${status} with the exact account request`, async () => {
      const requests = [];
      const result = await loaded.default.verifyCredential({ credential: { token: "tok" }, kit: {
        ...kit,
        fetch: async (url, init, options) => {
          requests.push({ url, headers: Object.fromEntries(new Headers(init.headers)), timeoutMs: options.timeoutMs });
          return jsonResponse(status, { login: "octo", email: "private@example.com" });
        },
      } });
      expect(requests).toEqual([{
        url: "https://api.github.com/user",
        headers: { authorization: "Bearer tok", accept: "application/vnd.github+json" }, timeoutMs: 15_000,
      }]);
      expect(result).toEqual(status === 200 ? { ok: true, accountLabel: "octo" } : {
        ok: false, reason: status === 401 || status === 403 ? "rejected" : "unreachable", statusCode: status,
      });
    });
  }

  for (const body of [{}, { login: "" }, { login: 42 }, null, "not JSON"]) {
    it(`verifyCredential accepts a valid response without a usable login: ${JSON.stringify(body)}`, async () => {
      const result = await loaded.default.verifyCredential({ credential: { token: "tok" }, kit: {
        ...kit, fetch: async () => typeof body === "string" ? new Response(body) : jsonResponse(200, body),
      } });
      expect(result).toEqual({ ok: true, accountLabel: undefined });
      expect(result.ok && result.accountLabel).toBeUndefined();
    });
  }

  it("basePath is /<repo>, the prefix a project site serves from", () => {
    expect(loaded.default.basePath?.({ target: "github-pages", owner: "octo", repo: "demo" })).toBe("/demo");
  });

  it("summarize folds owner and repo into one Repository row, plus the branch when one is given", () => {
    expect(loaded.default.summarize?.({ target: "github-pages", owner: "octo", repo: "demo" })).toEqual([{ label: "Repository", value: "octo/demo" }]);
    expect(loaded.default.summarize?.({ target: "github-pages", owner: "octo", repo: "demo", branch: "main" })).toEqual([
      { label: "Repository", value: "octo/demo" },
      { label: "Branch", value: "main" },
    ]);
  });

  it("validateConfig keeps the legacy exact refusal texts", () => {
    const validate = (config) => loaded.default.validateConfig?.({ target: "github-pages", owner: "octo", repo: "demo", ...config });
    expect(validate({})).toBeNull();
    expect(validate({ branch: "gh-pages" })).toBeNull();
    expect(validate({ owner: "-bad" })).toBe("invalid GitHub owner '-bad'");
    expect(validate({ owner: undefined })).toBe("invalid GitHub owner ''");
    expect(validate({ repo: ".." })).toBe("invalid GitHub repo '..'");
    expect(validate({ repo: "a/b" })).toBe("invalid GitHub repo 'a/b'");
    expect(validate({ branch: "has space" })).toBe("invalid branch name 'has space'");
  });
});


function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Shorthand matcher: does `url` end with `.../pages` exactly (not `.../pages/builds/latest`)? */
function isPagesSiteUrl(url) {
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
    const fetchSpy = vi.fn(async (_input, init) => {
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
    const calls = [];
    let blobCalls = 0;
    const binary = Buffer.from([0, 255, 128, 13, 10]);
    const blobs = [];
    let buildPollCount = 0;

    const fetchSpy = vi.fn(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('https://api.github.com/')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok');
        expect(new Headers(init?.headers).get('Accept')).toBe('application/vnd.github+json');
      }
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) {
        return new Response('', { status: 404 });
      }
      if (method === 'POST' && url.endsWith('/git/blobs')) {
        const body = JSON.parse(String(init?.body));
        blobs.push(body);
        expect(body.encoding).toBe('base64');
        expect(Buffer.from(body.content, 'base64')).toEqual(blobCalls === 0 ? Buffer.from('<html></html>') : binary);
        blobCalls += 1;
        return jsonResponse(201, { sha: `blob-sha-${blobCalls}` });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) {
        const body = JSON.parse(String(init?.body));
        expect(body.tree).toEqual([
          { path: 'index.html', mode: '100644', type: 'blob', sha: 'blob-sha-1' },
          { path: 'about.html', mode: '100644', type: 'blob', sha: 'blob-sha-1' },
          { path: 'image.png', mode: '100644', type: 'blob', sha: 'blob-sha-2' },
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
        { file: 'image.png', data: binary },
      ],
      projectName: 'My Demo Site',
    });

    expect(result.targetId).toBe('github-pages');
    expect(result.deploymentId).toBe('commit-sha-1');
    expect(result.status).toBe('ready');
    expect(result.url).toBe('https://octo.github.io/demo/');
    expect(result.providerMetadata).toEqual({ owner: 'octo', repo: 'demo', branch: 'gh-pages', commitSha: result.deploymentId, branchCreated: true });

    expect(blobs).toEqual([
      { content: Buffer.from('<html></html>').toString('base64'), encoding: 'base64' },
      { content: binary.toString('base64'), encoding: 'base64' },
    ]);
    expect(blobs.filter((body) => body.content === Buffer.from('<html></html>').toString('base64')).length).toBe(1); // both text files share identical content
    expect(blobCalls).toBe(2);
    expect(buildPollCount).toBe(4);
  });

  it('bounds every call in the ref -> blob -> tree -> commit -> branch -> pages -> build-poll chain with a timeout signal', async () => {
    const deadlines = [];
    const kit = createFakeDeployHostKit();
    const bound = loaded.bindGitHubPages({ ...kit, fetch: (url, init, options) => {
      deadlines.push(options.timeoutMs);
      return kit.fetch(url, init, options);
    } });
    const signals = {};
    let buildPollCount = 0;

    const fetchSpy = vi.fn(async (input, init) => {
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

    const target = new bound.GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    await target.publish({ files: [{ file: 'index.html', data: '<html></html>' }], projectName: 'demo' });

    expect(deadlines).toEqual([15_000, 15_000, 15_000, 15_000, 15_000, 15_000, 30_000, 30_000]);
    expect(buildPollCount).toBeGreaterThan(0);
    for (const [name, signal] of Object.entries(signals)) {
      expect(signal, `${name} should carry a timeout AbortSignal`).toBeInstanceOf(AbortSignal);
    }
    expect(Object.keys(signals).sort()).toEqual(
      ['blob', 'buildPoll', 'commit', 'createRef', 'pagesCreate', 'pagesLookup', 'refLookup', 'tree'].sort(),
    );
  });

  for (const [stalledCall, existingBranch] of [
    ...Array.from({ length: 8 }, (_, index) => [index, false]), [4, true],
  ]) {
    it(`aborts stalled request ${stalledCall + 1} (${existingBranch ? 'update' : 'create'} branch)`, async () => {
      let call = 0;
      let aborted = false;
      const responses = [
        () => existingBranch ? jsonResponse(200, { object: { sha: 'parent' } }) : new Response('', { status: 404 }),
        () => jsonResponse(201, { sha: 'blob' }),
        () => jsonResponse(201, { sha: 'tree' }),
        () => jsonResponse(201, { sha: 'commit' }),
        () => jsonResponse(201, {}),
        () => new Response('', { status: 404 }),
        () => jsonResponse(201, { html_url: 'https://octo.github.io/demo/' }),
        () => jsonResponse(200, { commit: 'commit', status: 'built' }),
      ];
      const kit = createFakeDeployHostKit({}, { timeouts: { QUICK: 15, DEPLOY: 20, UPLOAD: 25 }, fetchFn: async (_url, init) => {
        const current = call++;
        if (current !== stalledCall) return responses[current]();
        return new Promise((_resolve, reject) => {
          const watchdog = setTimeout(() => reject(new Error('deadline did not abort')), 1000);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(watchdog);
            aborted = true;
            reject(init.signal.reason);
          }, { once: true });
        });
      } });
      const { GitHubPagesDeployTarget: Target } = loaded.bindGitHubPages({ ...kit, sleep: async () => undefined });
      await expect(new Target({ token: 'tok', owner: 'octo', repo: 'demo' }).publish({
        files: [{ file: 'index.html', data: 'hi' }], projectName: 'demo',
      })).rejects.toThrow(`fetch timed out after ${stalledCall >= 6 ? 20 : 15}ms:`);
      expect(aborted).toBe(true);
      expect(call).toBe(stalledCall + 1);
    });
  }

  it('bounds the PATCH branch-update call with a timeout signal too', async () => {
    let updateRefSignal;
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    expect(result.providerMetadata).toEqual({ owner: 'octo', repo: 'demo', branch: 'gh-pages', commitSha: result.deploymentId, branchCreated: false });
  });

  it('flags sourceBranchMismatch when the existing Pages site is configured against a different branch', async () => {
    const fetchSpy = vi.fn(async (input, init) => {
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
    expect(result.providerMetadata).toEqual({ owner: 'octo', repo: 'demo', branch: 'gh-pages', commitSha: result.deploymentId, branchCreated: true, sourceBranchMismatch: true });
  });

  it('uses a caller-supplied branch instead of the gh-pages default', async () => {
    let refBody;
    let pagesBody;
    const fetchSpy = vi.fn(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/site')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) return jsonResponse(201, { sha: 'commit-sha' });
      if (method === 'POST' && url.endsWith('/git/refs')) {
        const body = JSON.parse(String(init?.body));
        refBody = body;
        expect(body.ref).toBe('refs/heads/site');
        return jsonResponse(201, { ref: 'refs/heads/site', object: { sha: 'commit-sha', type: 'commit' } });
      }
      if (method === 'GET' && isPagesSiteUrl(url)) return new Response('', { status: 404 });
      if (method === 'POST' && isPagesSiteUrl(url)) {
        const body = JSON.parse(String(init?.body));
        pagesBody = body;
        expect(body.source).toEqual({ branch: 'site', path: '/' });
        return jsonResponse(201, { html_url: 'https://octo.github.io/demo/', source: { branch: 'site', path: '/' } });
      }
      if (method === 'GET' && url.endsWith('/pages/builds/latest')) return jsonResponse(200, { commit: 'commit-sha', status: 'built' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo', branch: 'site' });
    const result = await target.publish({ files: [], projectName: 'demo' });
    expect(refBody).toEqual({ ref: 'refs/heads/site', sha: 'commit-sha' });
    expect(pagesBody).toEqual({ source: { branch: 'site', path: '/' }, build_type: 'legacy' });
    expect(result.status).toBe('ready');
    expect(result.providerMetadata?.branch).toBe('site');
  });

  it('throws DeployError when the Pages build reaches a terminal errored state, surfacing error.message', async () => {
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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

  it('proceeds to the reachability wait using whatever Pages URL it already has when the build poll exhausts its 30-attempt budget', { timeout: 20_000 }, async () => {
    const delays = [];
    const { GitHubPagesDeployTarget: PollingTarget } = loaded.bindGitHubPages({
      ...createFakeDeployHostKit(), sleep: async ms => { delays.push(ms); },
    });
    let pollCount = 0;
    const fetchSpy = vi.fn(async (input, init) => {
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

    const target = new PollingTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const publishPromise = target.publish({ files: [], projectName: 'demo' });
    const result = await publishPromise;

    expect(pollCount).toBe(30);
    expect(delays).toEqual([...Array(5).fill(1000), ...Array(25).fill(2000)]);
    expect(result.status).toBe('ready');
    expect(result.url).toBe('https://octo.github.io/demo/');
  });

  it('throws DeployError with the message field when blob creation fails', async () => {
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const err = (await target.publish({ files: [], projectName: 'demo' }).catch((e) => e));
    expect(err).toBeInstanceOf(DeployError);
    expect(err.message).toBe('GitHub returned a non-JSON response.');
    expect(err.status).toBe(502);
  });

  it('treats a malformed branch-ref response (200 OK, but no object.sha) the same as a not-yet-existing branch', async () => {
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async (input, init) => {
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
    let commitBody;
    const fetchSpy = vi.fn(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/git/ref/heads/gh-pages')) return new Response('', { status: 404 });
      if (method === 'POST' && url.endsWith('/git/trees')) return jsonResponse(201, { sha: 'tree-sha' });
      if (method === 'POST' && url.endsWith('/git/commits')) {
        const body = JSON.parse(String(init?.body));
        commitBody = body;
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
    const result = await target.publish({ files: [], projectName: '   ' });
    expect(commitBody).toEqual({ message: 'Deploy site via @jini-ai/deploy', tree: 'tree-sha', parents: [] });
    expect(result.status).toBe('ready');
  });

  it('checkReachability probes the URL without any protected-response detection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    const target = new GitHubPagesDeployTarget({ token: 'tok', owner: 'octo', repo: 'demo' });
    const result = await target.checkReachability('https://octo.github.io/demo/');
    expect(result.reachable).toBe(true);
  });
});
