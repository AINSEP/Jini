// Moved from Tovu's apps/website/src/features/agent-plugins/__tests__/unit/bundled-deploy-vercel.unit.test.ts (types stripped), then with the plugin into Jini
// (2026-11-02): the host kit is now `../../__tests__/fake-deploy-host-kit.mjs`, a test double over the same devops helpers.
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, it, afterEach } from "node:test";
import { pathToFileURL } from "node:url";

import { DeployError } from "@jini-ai/devops/deploy";

import { createFakeDeployHostKit } from "../../__tests__/fake-deploy-host-kit.mjs";

import { expect, installNetworkGuard, vi } from "../../__tests__/vitest-compat.mjs";

/**
 * @file The bundled `vercel` plugin's module (`targets/vercel.mjs`).
 *
 * PORTED, not re-authored, from `@jini-ai/devops` `src/deploy/__tests__/vercel.test.ts` at Jini commit
 * 28f67f9a (vitest): the ported cases run on node:test through
 * `../../__tests__/vitest-compat.mjs` with the module bound to the fake host kit (whose `fetch`
 * calls the stubbed global `fetch` at call time). The network guard fails the file if any call
 * reaches an unstubbed `fetch`. The cases above the marker are new: the module contract and
 * `responseHeaders` (rendered into `vercel.json` by the module itself), and the per-file `/v2/files`
 * upload (2026-10-11). Ported cases whose fake answered EVERY POST as the create call now match the
 * create by its `/v13/deployments` path, so the file uploads fall through to a plain 200.
 * Job C updates those contracts to negotiate missing hashes before uploading and retain accepted
 * deployments when readiness is not confirmed. Injected sleeps/deadline failures avoid real waits.
 */

installNetworkGuard();

const MODULE_PATH = path.resolve(import.meta.dirname, "../targets/vercel.mjs");


const loaded = (await import(pathToFileURL(MODULE_PATH).href));
const { VercelDeployTarget, isVercelProtectedResponse } = loaded.bindVercel({ ...createFakeDeployHostKit(), sleep: async () => undefined });

/** A Vercel API double that stores `/v2/files` uploads by digest, requests missing hashes before
 *  accepting a deployment and reporting it READY; returns deployed files resolved by `sha`. */
function stubVercelApi() {
  let posted = [];
  const uploads = new Map();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/v2/files")) {
        uploads.set(new Headers(init.headers).get("x-vercel-digest") ?? "", Buffer.from(init.body));
        return jsonResponse(200, {});
      }
      if (init?.method === "POST" && url.includes("/v13/deployments")) {
        const refs = JSON.parse(String(init.body)).files;
        const missing = [...new Set(refs.filter((file) => !uploads.has(file.sha)).map((file) => file.sha))];
        if (missing.length) return jsonResponse(400, { error: { code: "missing_files", missing } });
        posted = refs.map((file) => ({ file: file.file, data: uploads.get(file.sha).toString("utf8") }));
        return jsonResponse(200, { id: "dpl_1", readyState: "READY", url: "demo.vercel.app" });
      }
      if (url.includes("/v13/deployments/dpl_1")) return jsonResponse(200, { id: "dpl_1", readyState: "READY", url: "demo.vercel.app" });
      if (url.startsWith("https://demo.vercel.app")) return new Response("", { status: 200 });
      throw new Error(`Unexpected fetch call: ${init?.method ?? "GET"} ${url}`);
    }),
  );
  return () => posted;
}

describe("hosting plugin module contract (vercel)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("create() builds a target from the credential token and the config's teamId", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async (input, init) => {
      if (init?.method === "POST") return jsonResponse(200, { id: "dpl_1", readyState: "READY", url: "demo.vercel.app" });
      if (String(input).includes("/v13/deployments/dpl_1")) return jsonResponse(200, { id: "dpl_1", readyState: "READY", url: "demo.vercel.app" });
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const target = loaded.default.create({ credential: { token: "tok" }, config: { target: "vercel", teamId: "team_1" }, kit: createFakeDeployHostKit() });
    expect(target.id).toBe("vercel");
    const publishing = target.publish({ files: [], projectName: "demo" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await publishing).url).toBe("https://demo.vercel.app");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("teamId=team_1");
    const apiCalls = fetchSpy.mock.calls.filter(([url]) => String(url).startsWith("https://api.vercel.com/"));
    expect(apiCalls).toHaveLength(2);
    for (const [, init] of apiCalls) expect(new Headers((init).headers).get("Authorization")).toBe("Bearer tok");
  });

  it("validateConfig refuses a blank teamId with the exact legacy text, accepts none or a real one", () => {
    expect(loaded.default.validateConfig?.({ target: "vercel", teamId: "  " })).toBe("teamId must not be blank when provided");
    expect(loaded.default.validateConfig?.({ target: "vercel" })).toBeNull();
    expect(loaded.default.validateConfig?.({ target: "vercel", teamId: "team_1" })).toBeNull();
  });

  it("serves from the root", () => {
    expect(loaded.default.basePath?.({ target: "vercel" })).toBeUndefined();
  });

  it("verifyCredential authenticates the user probe and classifies failures without reading an account label", async () => {
    for (const status of [401, 403, 500]) {
      const fetchSpy = vi.fn(async () => jsonResponse(status, { user: { username: "must-not-be-used" } }));
      vi.stubGlobal("fetch", fetchSpy);
      expect(await loaded.default.verifyCredential({ credential: { token: "tok" }, kit: createFakeDeployHostKit() })).toEqual({
        ok: false, reason: status === 500 ? "unreachable" : "rejected", statusCode: status,
      });
      expect(fetchSpy.mock.calls).toHaveLength(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://api.vercel.com/v2/user");
      expect(new Headers((fetchSpy.mock.calls[0]?.[1]).headers).get("Authorization")).toBe("Bearer tok");
    }
  });

  it("verifyCredential takes its public account label only from user.username", async () => {
    for (const [body, accountLabel] of [
      [{ user: { username: "public-name", email: "private@example.com", name: "Private Name" }, username: "wrong-root" }, "public-name"],
      [{ user: { email: "private@example.com", name: "Private Name" }, username: "wrong-root" }, undefined],
      [{ user: { username: "" } }, undefined],
      [{ user: { username: 42 } }, undefined],
    ]) {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, body)));
      expect(await loaded.default.verifyCredential({ credential: { token: "tok" }, kit: createFakeDeployHostKit() })).toEqual({ ok: true, accountLabel });
    }
  });
});

describe("VercelDeployTarget.publish — responseHeaders", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const index = { file: "index.html", data: "<html></html>" };

  it("renders responseHeaders into a root vercel.json, replacing a site-supplied one", async () => {
    vi.useFakeTimers();
    const posted = stubVercelApi();
    const target = new VercelDeployTarget({ token: "tok" });
    const publishing = target.publish({
      files: [index, { file: "vercel.json", data: "{}" }],
      projectName: "demo",
      responseHeaders: { "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await publishing;

    expect(posted().map((f) => f.file)).toEqual(["index.html", "vercel.json"]);
    expect(posted()[1]?.data).toBe(
      `${JSON.stringify(
        { headers: [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Referrer-Policy", value: "no-referrer" }] }] },
        null,
        2,
      )}\n`,
    );
  });

  it("no responseHeaders (or an empty set) leaves the file set exactly as given", async () => {
    vi.useFakeTimers();
    const posted = stubVercelApi();
    const publishing = new VercelDeployTarget({ token: "tok" }).publish({ files: [index], projectName: "demo", responseHeaders: {} });
    await vi.advanceTimersByTimeAsync(2_000);
    await publishing;
    expect(posted().map((f) => f.file)).toEqual(["index.html"]);
  });
});

describe("VercelDeployTarget.publish — per-file uploads (/v2/files)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sha1 = (data) => createHash("sha1").update(data).digest("hex");
  const { VercelDeployTarget: NoWaitTarget } = loaded.bindVercel({ ...createFakeDeployHostKit(), sleep: async () => undefined });

  /** Records Vercel API calls against a remote hash store; explicit `create` answers override negotiation. */
  function recordVercelApi(options = {}) {
    const uploads = [];
    const creates = [];
    const create = [...(options.create ?? [])];
    const stored = new Set(options.stored ?? []);
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/v2/files")) {
        const headers = new Headers(init.headers);
        uploads.push({ url, headers, body: Buffer.from(init.body) });
        const sha = headers.get("x-vercel-digest") ?? "";
        const response = await (options.upload?.(sha) ?? jsonResponse(200, {}));
        if (response.ok) stored.add(sha);
        return response;
      }
      if (init?.method === "POST" && url.includes("/v13/deployments")) {
        creates.push({ url, body: String(init.body), bytes: Buffer.byteLength(String(init.body)) });
        const answer = create.shift();
        if (answer) return answer();
        const refs = JSON.parse(String(init.body)).files;
        const missing = [...new Set(refs.filter((file) => !stored.has(file.sha)).map((file) => file.sha))];
        if (missing.length) return jsonResponse(400, { error: { code: "missing_files", missing } });
        return jsonResponse(200, { id: "dpl_1", readyState: "READY", url: "demo.vercel.app" });
      }
      if (url.includes("/v13/deployments/dpl_1")) return jsonResponse(200, { id: "dpl_1", readyState: "READY", url: "demo.vercel.app" });
      return new Response("", { status: 200 });
    }));
    return { uploads, creates };
  }

  it("uploads each distinct file once with its SHA-1 digest and size, and the deployment references them by sha/size with no inline data", async () => {
    const api = recordVercelApi();
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
    await new NoWaitTarget({ token: "tok", teamId: "team_1" }).publish({
      files: [{ file: "index.html", data: "<html></html>" }, { file: "a/photo.jpg", data: photo }, { file: "b/copy.html", data: "<html></html>" }],
      projectName: "demo",
    });

    expect(api.uploads.map((u) => u.headers.get("x-vercel-digest")).sort()).toEqual([sha1("<html></html>"), sha1(photo)].sort());
    for (const upload of api.uploads) {
      expect(new URL(upload.url).pathname).toBe("/v2/files");
      expect(new URL(upload.url).searchParams.get("teamId")).toBe("team_1");
      expect(upload.headers.get("Authorization")).toBe("Bearer tok");
      expect(upload.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(upload.headers.get("Content-Length")).toBe(String(upload.body.length));
      expect(sha1(upload.body)).toBe(upload.headers.get("x-vercel-digest"));
    }
    expect(api.creates).toHaveLength(2);
    expect(JSON.parse(api.creates[0].body).files).toEqual([
      { file: "index.html", sha: sha1("<html></html>"), size: 13 },
      { file: "a/photo.jpg", sha: sha1(photo), size: 5 },
      { file: "b/copy.html", sha: sha1("<html></html>"), size: 13 },
    ]);
  });

  it("a site over 10 MB never goes in one request: every request body stays under Vercel's 10 MB cap", async () => {
    const api = recordVercelApi();
    const files = Array.from({ length: 4 }, (_, i) => ({ file: `photos/${i}.jpg`, data: Buffer.alloc(4 * 1024 * 1024, i + 1) }));
    await new NoWaitTarget({ token: "tok" }).publish({ files, projectName: "demo" });

    expect(api.uploads).toHaveLength(4);
    const limit = 10 * 1024 * 1024;
    for (const upload of api.uploads) expect(upload.body.length < limit).toBe(true);
    expect(api.creates[0].bytes < 10_000).toBe(true);
  });

  it("uploads exactly the missing hashes Vercel names once, then creates the deployment", async () => {
    const api = recordVercelApi({
      stored: [sha1("a")],
      create: [() => jsonResponse(400, { error: { code: "missing_files", message: "Missing files", missing: [sha1("b"), sha1("b"), "not-ours"] } })],
    });
    const result = await new NoWaitTarget({ token: "tok" }).publish({ files: [{ file: "a.html", data: "a" }, { file: "b.html", data: "b" }], projectName: "demo" });

    expect(result.url).toBe("https://demo.vercel.app");
    expect(api.creates).toHaveLength(2);
    expect(api.uploads.map((u) => u.headers.get("x-vercel-digest"))).toEqual([sha1("b")]);
  });

  it("a second missing_files answer fails the publish instead of looping", async () => {
    const missing = () => jsonResponse(400, { error: { code: "missing_files", message: "Missing files", missing: [sha1("a")] } });
    const api = recordVercelApi({ create: [missing, missing] });
    await expect(new NoWaitTarget({ token: "tok" }).publish({ files: [{ file: "a.html", data: "a" }], projectName: "demo" })).rejects.toThrow("Missing files");
    expect(api.creates).toHaveLength(2);
  });

  it("retries an upload Vercel answers with 429 or 5xx, and fails on a non-transient error without creating a deployment", async () => {
    const answers = [jsonResponse(429, {}), jsonResponse(503, {})];
    const retried = recordVercelApi({ upload: () => answers.shift() ?? jsonResponse(200, {}) });
    await new NoWaitTarget({ token: "tok" }).publish({ files: [{ file: "a.html", data: "a" }], projectName: "demo" });
    expect(retried.uploads).toHaveLength(3);
    expect(retried.creates).toHaveLength(2);

    const refused = recordVercelApi({ upload: () => jsonResponse(400, { error: { code: "bad_request", message: "Digest is not valid" } }) });
    await expect(new NoWaitTarget({ token: "tok" }).publish({ files: [{ file: "a.html", data: "a" }], projectName: "demo" })).rejects.toThrow("Digest is not valid");
    expect(refused.uploads).toHaveLength(1);
    expect(refused.creates).toHaveLength(1);
  });

  it("retries an upload whose connection drops, and names the transport cause once the tries run out", async () => {
    const dropped = () => Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) }));
    let drops = 1;
    const recovered = recordVercelApi({ upload: () => (drops-- > 0 ? (dropped()) : jsonResponse(200, {})) });
    await new NoWaitTarget({ token: "tok" }).publish({ files: [{ file: "a.html", data: "a" }], projectName: "demo" });
    expect(recovered.uploads).toHaveLength(2);
    expect(recovered.creates).toHaveLength(2);

    const api = recordVercelApi({ upload: () => dropped() });
    await expect(new NoWaitTarget({ token: "tok" }).publish({ files: [{ file: "a.html", data: "a" }], projectName: "demo" })).rejects.toThrow(
      "Vercel file upload failed: fetch failed (other side closed)",
    );
    expect(api.uploads).toHaveLength(3);
    expect(api.creates).toHaveLength(1);
  });

  it("does not retry an upload that hit the host-kit timeout", async () => {
    const calls = [];
    const kit = {
      ...createFakeDeployHostKit(),
      timeouts: { QUICK: 10, DEPLOY: 10, UPLOAD: 10 },
      fetch: async (url, init, options) => {
        calls.push({ url, timeoutMs: options.timeoutMs });
        if (url.includes("/v13/deployments")) {
          const missing = JSON.parse(String(init.body)).files.map((file) => file.sha);
          return jsonResponse(400, { error: { code: "missing_files", missing } });
        }
        throw new Error(`fetch timed out after ${options.timeoutMs}ms: ${url}`);
      },
    };
    let sleeps = 0;
    const { VercelDeployTarget: Bounded } = loaded.bindVercel({ ...kit, sleep: async () => { sleeps += 1; } });
    await expect(new Bounded({ token: "tok" }).publish({ files: [{ file: "a.html", data: "a" }], projectName: "demo" })).rejects.toThrow(
      "Vercel file upload failed: fetch timed out after 10ms",
    );
    expect(calls).toEqual([
      { url: "https://api.vercel.com/v13/deployments", timeoutMs: 10 },
      { url: "https://api.vercel.com/v2/files", timeoutMs: 10 },
    ]);
    expect(sleeps).toBe(0);
  });

  it("gives up on a file after three transient failures", async () => {
    const api = recordVercelApi({ upload: () => jsonResponse(502, { error: { message: "Bad gateway" } }) });
    await expect(new NoWaitTarget({ token: "tok" }).publish({ files: [{ file: "a.html", data: "a" }], projectName: "demo" })).rejects.toThrow("Bad gateway");
    expect(api.uploads).toHaveLength(3);
    expect(api.creates).toHaveLength(1);
  });
});

function jsonResponse(status, body, headers = {}) {
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

  it('refuses to follow a redirect on the create-deployment call, and requests redirect: manual', async () => {
    const fetchSpy = vi.fn(async (_input, init) => {
      expect(init?.redirect).toBe('manual');
      return new Response('', { status: 302, headers: { location: 'https://evil.example/steal-token' } });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const target = new VercelDeployTarget({ token: 'tok' });
    await expect(target.publish({ files: [{ file: 'index.html', data: 'hi' }], projectName: 'demo' })).rejects.toThrow(
      /attempted to redirect/
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('creates a deployment, polls until READY, and returns the reachable URL', async () => {
    const createBody = { id: 'dpl_1', readyState: 'QUEUED', url: 'demo-abc123.vercel.app' };
    const readyBody = { id: 'dpl_1', readyState: 'READY', url: 'demo-abc123.vercel.app' };

    const fetchSpy = vi.fn(async (input, init) => {
      if (init?.method === 'POST' && String(input).includes('/v13/deployments')) {
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

  it('bounds both the create-deployment call and the status-poll call with a timeout signal, so a stalled Vercel response cannot hang a publish forever', async (t) => {
    const deadlines = [];
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', (ms) => { deadlines.push(ms); return timeout(ms); });
    const createBody = { id: 'dpl_1', readyState: 'QUEUED', url: 'demo-abc123.vercel.app' };
    const readyBody = { id: 'dpl_1', readyState: 'READY', url: 'demo-abc123.vercel.app' };
    let createSignal;
    let pollSignal;

    const fetchSpy = vi.fn(async (input, init) => {
      if (init?.method === 'POST' && String(input).includes('/v13/deployments')) {
        createSignal = init?.signal;
        expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
        return jsonResponse(200, createBody);
      }
      if (String(input).includes('/v13/deployments/dpl_1')) {
        pollSignal = init?.signal;
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok');
        return jsonResponse(200, readyBody);
      }
      // Reachability probe against the deployment URL — a different, already-protected call site.
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new VercelDeployTarget({ token: 'tok' });
    await target.publish({ files: [{ file: 'index.html', data: '<html></html>' }], projectName: 'demo' });

    expect(createSignal).toBeInstanceOf(AbortSignal);
    expect(pollSignal).toBeInstanceOf(AbortSignal);
    // Vercel already has this file: create negotiates without uploading, then polls.
    expect(deadlines.slice(0, 2)).toEqual([120_000, 30_000]);
  });

  it('reports the injected host-kit deadline with deployment facts for create and poll requests', async () => {
    for (const stalled of ['create', 'poll']) {
      const calls = [];
      const kit = {
        ...createFakeDeployHostKit(),
        timeouts: { QUICK: 10, DEPLOY: 20, UPLOAD: 30 },
        fetch: async (url, init, options) => {
          calls.push({ url, timeoutMs: options.timeoutMs });
          if (stalled === 'poll' && init?.method === 'POST') {
            return jsonResponse(200, { id: 'dpl_stalled', readyState: 'QUEUED', url: 'demo-stalled.vercel.app' });
          }
          throw new Error(`fetch timed out after ${options.timeoutMs}ms: ${url}`);
        },
        sleep: async () => undefined,
      };
      const { VercelDeployTarget: BoundedTarget } = loaded.bindVercel(kit);
      const publishing = new BoundedTarget({ token: 'tok' }).publish({ files: [], projectName: 'demo' });
      if (stalled === 'create') {
        await expect(publishing).rejects.toThrow('fetch timed out after 30ms:');
        await expect(publishing).rejects.toThrow('Deployment: unknown. 0 of 0 distinct files uploaded this attempt; 0 already stored.');
        await expect(publishing).rejects.toThrow('Vercel dashboard');
        expect(calls).toEqual([{ url: 'https://api.vercel.com/v13/deployments', timeoutMs: 30 }]);
      } else {
        const result = await publishing;
        expect(result).toMatchObject({ status: 'link-delayed', deploymentId: 'dpl_stalled', url: 'https://demo-stalled.vercel.app' });
        expect(result.statusMessage).toContain('fetch timed out after 20ms:');
        expect(result.statusMessage).toContain('Deployment: created. 0 of 0 distinct files uploaded this attempt; 0 already stored.');
        expect(result.statusMessage).toContain('provider status: QUEUED');
        expect(result.statusMessage).toContain('Vercel dashboard');
        expect(calls).toEqual([
          { url: 'https://api.vercel.com/v13/deployments', timeoutMs: 30 },
          { url: 'https://api.vercel.com/v13/deployments/dpl_stalled', timeoutMs: 20 },
        ]);
      }
    }
  });

  it('rejects with DeployError when the Vercel build failed, retaining deployment facts', async () => {
    const createBody = { id: 'dpl_2', readyState: 'QUEUED', url: 'demo.vercel.app' };
    const errorBody = { id: 'dpl_2', readyState: 'ERROR', error: { message: 'Build failed' } };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        return jsonResponse(200, errorBody);
      }),
    );

    const target = new VercelDeployTarget({ token: 'tok' });
    const publishing = target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    await expect(publishing).rejects.toThrow(DeployError);
    for (const detail of ['Build failed', 'Deployment: created.', 'dpl_2', 'https://demo.vercel.app', 'provider status: ERROR', 'Vercel dashboard']) {
      await expect(publishing).rejects.toThrow(detail);
    }
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
    vi.stubGlobal('fetch', vi.fn(async (input) => String(input).includes('/v2/files') ? jsonResponse(200, {}) : jsonResponse(500, {})));
    const target = new VercelDeployTarget({ token: 'tok' });
    await expect(
      target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' }),
    ).rejects.toThrow('Vercel request failed (500).');
  });

  it('throws DeployError when Vercel responds with a non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
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
    const fetchSpy = vi.fn(async (input, init) => {
      if (init?.method === 'POST') return jsonResponse(200, createBody);
      if (String(input).includes('/v13/deployments/dpl_uid_only')) return jsonResponse(200, readyBody);
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(result.deploymentId).toBe('dpl_uid_only');
  });

  it('retains the deployment and falls back to "Vercel deployment failed" when terminal ERROR has no error object', async () => {
    const createBody = { id: 'dpl_noerr', readyState: 'QUEUED', url: 'demo.vercel.app' };
    const errorBody = { id: 'dpl_noerr', readyState: 'ERROR' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        return jsonResponse(200, errorBody);
      }),
    );
    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(result).toMatchObject({ status: 'failed', deploymentId: 'dpl_noerr', url: 'https://demo.vercel.app' });
    expect(result.statusMessage).toContain('Vercel deployment failed.');
    expect(result.statusMessage).toContain('provider status: ERROR');
  });

  it('retains the deployment and reports incomplete verification when the status poll receives a non-ok response', async () => {
    const createBody = { id: 'dpl_pollfail', readyState: 'QUEUED', url: 'demo.vercel.app' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        return jsonResponse(500, {});
      }),
    );
    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(result).toMatchObject({ status: 'link-delayed', deploymentId: 'dpl_pollfail', url: 'https://demo.vercel.app' });
    expect(result.statusMessage).toContain('Vercel request failed (500).');
    expect(result.statusMessage).toContain('Deployment: created.');
    expect(result.statusMessage).toContain('Vercel dashboard');
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
    const probed = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
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
    const probed = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
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
    const probed = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
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
    const fetchSpy = vi.fn(async () => jsonResponse(200, { readyState: 'READY' }));
    vi.stubGlobal('fetch', fetchSpy);
    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(result.url).toBe('');
    expect(result.status).toBe('link-delayed');
    expect(result.reachableAt).toBeUndefined();
    // Vercel already has the hash: one create, no upload or reachability probe with an empty URL.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('skips polling entirely when the create response carries neither an id nor a uid', async () => {
    // ready = created directly (no deploymentId): skip status polls and check only the READY link.
    const fetchSpy = vi.fn(async () => jsonResponse(200, { readyState: 'READY', url: 'demo.vercel.app' }));
    vi.stubGlobal('fetch', fetchSpy);

    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });

    expect(result.deploymentId).toBeUndefined();
    expect(result.url).toBe('https://demo.vercel.app');
    // Vercel already has the hash: one create, one reachability probe and the login-redirect HEAD, with no poll.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('collects deployment URL candidates from string aliases, and from aliases entries shaped as {domain} or {url} objects', async () => {
    const createBody = {
      id: 'dpl_3',
      readyState: 'READY',
      url: 'primary.vercel.app',
      alias: ['alias-one.vercel.app'],
      aliases: [{ domain: 'from-domain.example' }, { url: 'from-url.example' }, 42, { neither: true }],
    };
    const probed = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        if (init?.method === 'POST') return jsonResponse(200, createBody);
        if (String(input).includes('/v13/deployments/dpl_3')) return jsonResponse(200, createBody);
        probed.push(String(input));
        return new Response('', { status: String(input) === 'https://from-url.example/' ? 200 : 503 });
      }),
    );

    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });

    // Failed candidates get both HEAD and GET probes; aliases go before the per-deployment `url`, and
    // the reachable one gets one more HEAD for a login redirect.
    expect(probed).toEqual([
      'https://alias-one.vercel.app/', 'https://alias-one.vercel.app/',
      'https://from-domain.example/', 'https://from-domain.example/', 'https://from-url.example/', 'https://from-url.example',
    ]);
    expect(result.url).toBe('https://from-url.example');
  });

  it('returns each object alias when it is the only reachable production URL', async () => {
    for (const alias of [{ domain: 'domain-only.example' }, { url: 'url-only.example' }]) {
      const expected = 'https://' + ('domain' in alias ? alias.domain : alias.url);
      vi.stubGlobal('fetch', vi.fn(async (input, init) => {
        if (init?.method === 'POST') return jsonResponse(200, { readyState: 'READY', url: 'unreachable.vercel.app', aliases: [alias] });
        return new Response('', { status: String(input) === expected + '/' ? 200 : 503 });
      }));
      const result = await new VercelDeployTarget({ token: 'tok' }).publish({ files: [], projectName: 'demo' });
      expect(result.url).toBe(expected);
      expect(result.status).toBe('ready');
    }
  });

  it('keeps polling past a status-check response that fails to parse as JSON instead of treating it as a hard failure', async () => {
    // Regression for the same bug class fixed in github-pages.ts's pollGitHubPagesBuild
    // (2026-08-16): pollVercelDeployment had ZERO tolerance for any poll response that
    // failed to parse as JSON, worse than GitHub's pre-fix version (which at least
    // special-cased 404). The deployment already exists server-side by the time this loop
    // runs (the create call already succeeded), so a transient/edge/empty response mid-poll
    // must never be reported as a failed publish for a deployment that is actually live.
    const createBody = { id: 'dpl_flaky_poll', readyState: 'QUEUED', url: 'demo.vercel.app' };
    const readyBody = { id: 'dpl_flaky_poll', readyState: 'READY', url: 'demo.vercel.app' };
    let pollCount = 0;
    const fetchSpy = vi.fn(async (input, init) => {
      if (init?.method === 'POST') return jsonResponse(200, createBody);
      if (String(input).includes('/v13/deployments/dpl_flaky_poll')) {
        pollCount += 1;
        // 1st poll: a 200 with an empty body — no parseable status yet, but Vercel did not
        // signal that with a 404 or any other convention this file already special-cases.
        if (pollCount === 1) return new Response('', { status: 200 });
        return jsonResponse(200, readyBody);
      }
      // Reachability probe against the deployment URL.
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });

    expect(pollCount).toBe(2);
    expect(result.status).toBe('ready');
  });

  it('returns the last known deployment state once polling exhausts its 30-attempt budget without a terminal readyState', { timeout: 20_000 }, async () => {
    // pollVercelDeployment's attempt budget/backoff are fixed constants (~1s
    // for the first 5 attempts, 2s thereafter — ~55s total) with no
    // caller-facing override, so driving it to exhaustion for real would
    // cost ~55s of wall-clock time per run. The injected sleep port records the
    // same backoff without waiting for wall-clock time.
    const delays = [];
    const { VercelDeployTarget: PollingTarget } = loaded.bindVercel({
      ...createFakeDeployHostKit(), sleep: async ms => { delays.push(ms); },
    });
    const createBody = { id: 'dpl_never_ready', readyState: 'QUEUED', url: 'demo.vercel.app' };
    const pollingBody = { id: 'dpl_never_ready', readyState: 'BUILDING', url: 'demo.vercel.app' };
    let pollCount = 0;
    const probed = [];
    const fetchSpy = vi.fn(async (input, init) => {
      if (init?.method === 'POST') return jsonResponse(200, createBody);
      if (String(input).includes('/v13/deployments/dpl_never_ready')) {
        pollCount += 1;
        return jsonResponse(200, pollingBody);
      }
      // The previous deployment may still answer 200; it cannot prove this deployment is READY.
      probed.push(String(input));
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const target = new PollingTarget({ token: 'tok' });
    const publishPromise = target.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    // The recorded backoff must retain the full 55_000ms polling budget.
    const result = await publishPromise;

    expect(pollCount).toBe(30);
    expect(delays).toEqual([...Array(5).fill(1000), ...Array(25).fill(2000)]);
    expect(result.deploymentId).toBe('dpl_never_ready');
    expect(result.url).toBe('https://demo.vercel.app');
    expect(result.status).toBe('link-delayed');
    expect(result.reachableAt).toBeUndefined();
    expect(result.statusMessage).toContain('provider status: BUILDING');
    expect(result.statusMessage).toContain('Vercel dashboard');
    expect(probed).toEqual([]);
  });

  it('checkReachability probes the URL with the Vercel-protected-response detector wired in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    const target = new VercelDeployTarget({ token: 'tok' });
    const result = await target.checkReachability('https://demo.vercel.app');
    expect(result.reachable).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401, headers: { 'set-cookie': '_vercel_sso_nonce=dummy' } })));
    const protectedResult = await target.checkReachability('https://demo.vercel.app');
    expect(protectedResult.reachable).toBe(false);
    expect(protectedResult.status).toBe('protected');
  });

  it('publish reports a Deployment Protection auth wall as protected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => init?.method === 'POST'
      ? jsonResponse(200, { readyState: 'READY', url: 'protected.vercel.app' })
      : new Response('', { status: 401, headers: { 'set-cookie': '_vercel_sso_nonce=dummy' } })));
    const result = await new VercelDeployTarget({ token: 'tok' }).publish({ files: [], projectName: 'demo' });
    expect(result.status).toBe('protected');
    expect(result.url).toBe('https://protected.vercel.app');
  });

  it('creates a production deployment and reports the production alias, not the per-deployment URL', async () => {
    let createBody;
    const ready = { id: 'dpl_p', readyState: 'READY', url: 'plannie-leon-abc123-team.vercel.app', alias: ['plannie-leon.vercel.app'] };
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/v13/deployments')) {
        createBody = JSON.parse(String(init.body));
        return jsonResponse(200, { id: 'dpl_p', readyState: 'QUEUED', url: ready.url });
      }
      if (url.includes('/v13/deployments/dpl_p')) return jsonResponse(200, ready);
      // The per-deployment URL sits behind Deployment Protection; the production alias is public.
      if (url.startsWith('https://plannie-leon-abc123')) return new Response('', { status: 302, headers: { location: 'https://vercel.com/sso-api?url=x' } });
      return new Response('', { status: 200 });
    }));
    const result = await new VercelDeployTarget({ token: 'tok' }).publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'plannie-leon' });
    expect(createBody?.target).toBe('production');
    expect(result.url).toBe('https://plannie-leon.vercel.app');
    expect(result.status).toBe('ready');
  });

  it('tries the public <project>.vercel.app alias first even when Vercel lists the team-scoped alias before it', async () => {
    // 2026-10-11: the team alias answered `protected` first and the publish stopped there, though the
    // public alias served 200.
    const ready = { readyState: 'READY', url: 'plannie-leon-abc123-team.vercel.app', alias: ['plannie-leon-team.vercel.app', 'plannie-leon.vercel.app'] };
    const probed = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/v13/deployments')) return jsonResponse(200, ready);
      if (url.startsWith('https://api.vercel.com/')) return new Response('', { status: 200 });
      probed.push(url);
      return url.startsWith('https://plannie-leon.vercel.app')
        ? new Response('', { status: 200 })
        : new Response('', { status: 401, headers: { 'set-cookie': '_vercel_sso_nonce=dummy' } });
    }));
    const result = await new VercelDeployTarget({ token: 'tok' }).publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'plannie-leon' });
    expect(result.status).toBe('ready');
    expect(result.url).toBe('https://plannie-leon.vercel.app');
    expect(probed.some((url) => url.includes('-team'))).toBe(false);
  });

  it('reports a URL that redirects to Vercel login as protected, not ready', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => init?.method === 'POST'
      ? jsonResponse(200, { readyState: 'READY', url: 'demo-abc123.vercel.app' })
      : new Response('', { status: 302, headers: { location: 'https://vercel.com/sso-api?url=https%3A%2F%2Fdemo-abc123.vercel.app' } })));
    const result = await new VercelDeployTarget({ token: 'tok' }).publish({ files: [], projectName: 'demo' });
    expect(result.status).toBe('protected');
    expect(result.url).toBe('https://demo-abc123.vercel.app');
    expect(result.reachableAt).toBeUndefined();
  });

  it('includes teamId (preferred over teamSlug) or teamSlug in the query string when configured', async () => {
    const fetchSpy = vi.fn(async (_input, _init) => jsonResponse(200, { id: 'dpl_scoped', readyState: 'READY', url: 'demo.vercel.app' }));
    vi.stubGlobal('fetch', fetchSpy);

    const withTeamId = new VercelDeployTarget({ token: 'tok', teamId: 'team_1', teamSlug: 'ignored-slug' });
    await withTeamId.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('teamId=team_1');
    const teamIdQuery = new URL(String(fetchSpy.mock.calls[0]?.[0])).searchParams;
    expect(teamIdQuery.get('teamId')).toBe('team_1');
    expect(teamIdQuery.has('slug')).toBe(false);
    const idApiCalls = fetchSpy.mock.calls.filter(([url]) => String(url).startsWith('https://api.vercel.com/'));
    expect(idApiCalls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/v13/deployments', '/v13/deployments/dpl_scoped']);
    for (const [url] of idApiCalls) expect([...new URL(String(url)).searchParams]).toEqual([['teamId', 'team_1']]);

    fetchSpy.mockClear();
    const withTeamSlug = new VercelDeployTarget({ token: 'tok', teamSlug: 'my-team' });
    await withTeamSlug.publish({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo' });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('slug=my-team');
    const teamSlugQuery = new URL(String(fetchSpy.mock.calls[0]?.[0])).searchParams;
    expect(teamSlugQuery.get('slug')).toBe('my-team');
    expect(teamSlugQuery.has('teamId')).toBe(false);
    const slugApiCalls = fetchSpy.mock.calls.filter(([url]) => String(url).startsWith('https://api.vercel.com/'));
    expect(slugApiCalls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/v13/deployments', '/v13/deployments/dpl_scoped']);
    for (const [url] of slugApiCalls) expect([...new URL(String(url)).searchParams]).toEqual([['slug', 'my-team']]);
  });

  it('falls back to a random project name when the caller-supplied projectName sanitizes to nothing', async () => {
    const fetchSpy = vi.fn(async (input, init) => {
      if (init?.method === 'POST' && String(input).includes('/v13/deployments')) {
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

describe("VercelDeployTarget — edge answers (bodies that cannot be read, missing headers, unreadable polls)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const { VercelDeployTarget: NoWaitTarget } = loaded.bindVercel({ ...createFakeDeployHostKit(), sleep: async () => undefined });
  /** A response whose body stream fails mid-read, as a dropped connection does. */
  const brokenBody = (status) => new Response(new ReadableStream({ start(controller) { controller.error(new Error("socket reset")); } }), { status });

  it("verifyCredential reads no account label from a non-JSON body, a null body, or a non-object user", async () => {
    for (const make of [() => new Response("not json", { status: 200 }), () => jsonResponse(200, null), () => jsonResponse(200, { user: "public-name" })]) {
      vi.stubGlobal("fetch", vi.fn(async () => make()));
      expect(await loaded.default.verifyCredential({ credential: { token: "tok" }, kit: createFakeDeployHostKit() })).toEqual({ ok: true, accountLabel: undefined });
    }
  });

  it("an upload ack, a retried upload answer and the login-check HEAD whose bodies cannot be drained do not fail the publish", async () => {
    const uploads = [brokenBody(503), brokenBody(200)];
    let uploadCalls = 0;
    let acknowledged = false;
    const heads = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/v2/files")) {
        uploadCalls += 1;
        const response = uploads.shift() ?? jsonResponse(200, {});
        if (response.ok) acknowledged = true;
        return response;
      }
      if (init?.method === "POST" && url.includes("/v13/deployments")) {
        if (!acknowledged) {
          const missing = JSON.parse(String(init.body)).files.map((file) => file.sha);
          return jsonResponse(400, { error: { code: "missing_files", missing } });
        }
        return jsonResponse(200, { id: "dpl_1", readyState: "READY", url: "demo.vercel.app" });
      }
      if (url.includes("/v13/deployments/dpl_1")) return jsonResponse(200, { id: "dpl_1", readyState: "READY", url: "demo.vercel.app" });
      if (init?.method === "HEAD") { heads.push(url); return brokenBody(200); }
      return new Response("", { status: 200 });
    }));
    const result = await new NoWaitTarget({ token: "tok" }).publish({ files: [{ file: "a.html", data: "a" }], projectName: "demo" });
    expect(uploadCalls).toBe(2);
    // The kit's reachability probe HEADs first; the last HEAD is the login-wall check.
    expect(heads).toEqual(["https://demo.vercel.app/", "https://demo.vercel.app"]);
    expect(result.status).toBe("ready");
    expect(result.url).toBe("https://demo.vercel.app");
  });

  it("a redirect with no Location header is not Vercel's login wall", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => (init?.method === "POST"
      ? jsonResponse(200, { readyState: "READY", url: "demo-abc123.vercel.app" })
      : new Response("", { status: 302 }))));
    const result = await new NoWaitTarget({ token: "tok" }).publish({ files: [], projectName: "demo" });
    expect(result.status).toBe("ready");
    expect(result.url).toBe("https://demo-abc123.vercel.app");
  });

  it("a login-check HEAD that throws leaves the reachability result as it was", async () => {
    const heads = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") return jsonResponse(200, { readyState: "READY", url: "demo.vercel.app" });
      if (init?.method === "HEAD") {
        heads.push(url);
        // The kit's own probe asks for the root path ("/"); the login check asks for the bare URL.
        if (!url.endsWith("/")) throw new TypeError("fetch failed");
      }
      return new Response("", { status: 200 });
    }));
    const result = await new NoWaitTarget({ token: "tok" }).publish({ files: [], projectName: "demo" });
    expect(heads).toEqual(["https://demo.vercel.app/", "https://demo.vercel.app"]);
    expect(result.status).toBe("ready");
  });

  it("when no status poll is ever readable, the URL candidates come from the create answer alone", async () => {
    let polls = 0;
    const probed = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") return jsonResponse(200, { id: "dpl_q", readyState: "QUEUED", url: "demo-q.vercel.app" });
      if (url.includes("/v13/deployments/dpl_q")) { polls += 1; return new Response("not json", { status: 200 }); }
      probed.push(url);
      return new Response("", { status: 200 });
    }));
    const result = await new NoWaitTarget({ token: "tok" }).publish({ files: [], projectName: "demo" });
    expect(polls).toBe(30);
    expect(result.deploymentId).toBe("dpl_q");
    expect(result.url).toBe("https://demo-q.vercel.app");
    expect(result.status).toBe("link-delayed");
    expect(result.reachableAt).toBeUndefined();
    expect(result.statusMessage).toContain("provider status: QUEUED");
    expect(result.statusMessage).toContain("Vercel dashboard");
    expect(probed).toEqual([]);
  });
});
