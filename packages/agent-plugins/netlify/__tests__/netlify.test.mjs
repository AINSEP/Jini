// Moved from Tovu's apps/website/src/features/agent-plugins/__tests__/unit/bundled-deploy-netlify.unit.test.ts (types stripped), then with the plugin into Jini
// (2026-11-02): the host kit is now `./fake-deploy-host-kit.mjs`, a test double over the same devops helpers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { } from "node:test";

import { DeployError } from "@jini-ai/devops/deploy";

import { createFakeDeployHostKit } from "./fake-deploy-host-kit.mjs";

/**
 * @file The bundled `netlify` plugin's module (`targets/netlify.mjs`).
 *
 * PORTED, not re-authored, from `@jini-ai/devops` `src/deploy/__tests__/netlify.test.ts` (0.3.1,
 * vitest) — one case per original case, same fixtures and assertions. What changed is only the seam:
 * the module gets its network through the injected host kit instead of `@jini-ai/platform`, so
 * `vi.stubGlobal('fetch')` becomes a stubbed global `fetch` behind the fake kit (the reachability
 * probes still go through devops' real `checkDeploymentUrl`), "bounded by a timeout signal" becomes
 * "every kit.fetch call names a timeout class", and the poll delay is a no-op `sleep` instead of
 * fake timers. The `responseHeaders` cases at the end are new: they are the reason the port exists.
 */

const MODULE_PATH = path.resolve(import.meta.dirname, "../targets/netlify.mjs");


async function loadModule() {
  return ((await import(pathToFileURL(MODULE_PATH).href))).default;
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function sha1(data) {
  return createHash("sha1").update(Buffer.from(data)).digest("hex");
}

/** The fake kit, with global `fetch` stubbed for this test only, `sleep` a no-op, and every
 *  `kit.fetch` call recorded with the timeout it named. */
function stubKit(t, handler, overrides = {}, token = "tok") {
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), new URL(url).origin === "https://api.netlify.com" ? `Bearer ${token}` : null);
    return handler(url, init);
  });
  const real = createFakeDeployHostKit();
  const calls = [];
  const kit = {
    ...real,
    fetch: (url, init, options) => {
      calls.push({ method: init.method ?? "GET", url, timeoutMs: options.timeoutMs });
      return real.fetch(url, init, options);
    },
    sleep: async () => undefined,
    ...overrides,
  };
  return { kit, calls };
}

async function netlifyTarget(kit, token = "tok") {
  return (await loadModule()).create({ credential: { token }, config: {}, kit });
}

async function publish(kit, input, token = "tok") {
  return (await netlifyTarget(kit, token)).publish(input);
}

test("throws DeployError without making a network call when token is missing", async (t) => {
  const { kit, calls } = stubKit(t, () => {
    throw new Error("no network expected");
  });
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }, ""), { name: "DeployError", message: "Netlify token is required." });
  assert.equal(calls.length, 0);
});

test("throws DeployError without making a network call when a site name cannot be derived", async (t) => {
  const { kit, calls } = stubKit(t, () => {
    throw new Error("no network expected");
  }, { safeDnsLabel: () => "" });
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), { name: "DeployError", message: "Netlify site name could not be generated." });
  assert.equal(calls.length, 0);
});

test("finds an existing site, uploads only required files, polls to ready, and returns the reachable URL", async (t) => {
  const fileHash = sha1("<html></html>");
  const { kit, calls } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) {
      assert.ok(url.includes("name=jini-my-demo-site"));
      return jsonResponse(200, [{ id: "site_1", name: "jini-my-demo-site", ssl_url: "https://jini-my-demo-site.netlify.app" }]);
    }
    if (method === "POST" && url.endsWith("/sites/site_1/deploys")) {
      const parsed = JSON.parse(String(init.body));
      assert.equal(parsed.async, true);
      assert.deepEqual(parsed.files, { "/index.html": fileHash });
      return jsonResponse(200, { id: "deploy_1", state: "preparing", required: [fileHash] });
    }
    if (method === "PUT" && url.includes("/deploys/deploy_1/files/index.html")) {
      assert.equal(new Headers(init.headers).get("Content-Type"), "text/html");
      assert.deepEqual(init.body, Buffer.from("<html></html>"));
      assert.equal(createHash("sha1").update(init.body).digest("hex"), fileHash);
      return jsonResponse(200, { id: "f1", path: "/index.html", sha: fileHash, size: 13 });
    }
    if (method === "GET" && url.endsWith("/deploys/deploy_1")) {
      return jsonResponse(200, { id: "deploy_1", state: "ready", ssl_url: "https://jini-my-demo-site.netlify.app" });
    }
    return new Response("", { status: 200 }); // reachability probe
  });

  const result = await publish(kit, { files: [{ file: "index.html", data: "<html></html>", contentType: "text/html" }], projectName: "My Demo Site!!" });

  assert.equal(result.targetId, "netlify");
  assert.equal(result.deploymentId, "deploy_1");
  assert.equal(result.status, "ready");
  assert.equal(result.url, "https://jini-my-demo-site.netlify.app");
  assert.deepEqual(result.providerMetadata, { siteId: "site_1", siteName: "jini-my-demo-site" });
  assert.equal(calls.filter((call) => call.method === "PUT").length, 1);
});

test("bounds the site-lookup, deploy-creation, file-upload, and status-poll calls with a timeout each", async (t) => {
  const fileHash = sha1("<html></html>");
  const { kit, calls } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-my-demo-site", ssl_url: "https://jini-my-demo-site.netlify.app" }]);
    if (method === "POST" && url.endsWith("/sites/site_1/deploys")) return jsonResponse(200, { id: "deploy_1", state: "preparing", required: [fileHash] });
    if (method === "PUT") return jsonResponse(200, {});
    if (method === "GET" && url.endsWith("/deploys/deploy_1")) return jsonResponse(200, { id: "deploy_1", state: "ready", ssl_url: "https://jini-my-demo-site.netlify.app" });
    return new Response("", { status: 200 });
  });

  await publish(kit, { files: [{ file: "index.html", data: "<html></html>", contentType: "text/html" }], projectName: "My Demo Site!!" });

  assert.deepEqual(
    calls.map((call) => [call.method, call.timeoutMs]),
    [
      ["GET", kit.timeouts.QUICK],
      ["POST", kit.timeouts.DEPLOY],
      ["PUT", kit.timeouts.UPLOAD],
      ["GET", kit.timeouts.DEPLOY],
    ],
  );
});

test("creates a new site when none exists yet", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, []);
    if (method === "POST" && url.endsWith("/sites")) {
      assert.equal(JSON.parse(String(init.body)).name, "jini-demo");
      return jsonResponse(200, { id: "site_new", name: "jini-demo", ssl_url: "https://jini-demo.netlify.app" });
    }
    if (method === "POST" && url.endsWith("/sites/site_new/deploys")) return jsonResponse(200, { id: "deploy_new", state: "ready", required: [] });
    if (method === "GET" && url.endsWith("/deploys/deploy_new")) return jsonResponse(200, { id: "deploy_new", state: "ready", ssl_url: "https://jini-demo.netlify.app" });
    return new Response("", { status: 200 });
  });
  const result = await publish(kit, { files: [], projectName: "demo" });
  assert.deepEqual(result.providerMetadata, { siteId: "site_new", siteName: "jini-demo" });
});

test("bounds the site-creation call with a timeout too", async (t) => {
  const { kit, calls } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, []);
    if (method === "POST" && url.endsWith("/sites")) return jsonResponse(200, { id: "site_new", name: "jini-demo", ssl_url: "https://jini-demo.netlify.app" });
    if (method === "POST" && url.endsWith("/sites/site_new/deploys")) return jsonResponse(200, { id: "deploy_new", state: "ready", required: [] });
    if (method === "GET" && url.endsWith("/deploys/deploy_new")) return jsonResponse(200, { id: "deploy_new", state: "ready", ssl_url: "https://jini-demo.netlify.app" });
    return new Response("", { status: 200 });
  });
  await publish(kit, { files: [], projectName: "demo" });
  const createSite = calls.find((call) => call.method === "POST" && call.url.endsWith("/sites"));
  assert.equal(createSite?.timeoutMs, kit.timeouts.DEPLOY);
});

test("recovers from a site-creation conflict by re-listing and using the now-existing site", async (t) => {
  let listCount = 0;
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) {
      listCount += 1;
      return listCount === 1 ? jsonResponse(200, []) : jsonResponse(200, [{ id: "site_race", name: "jini-demo" }]);
    }
    if (method === "POST" && url.endsWith("/sites")) return jsonResponse(422, { code: 422, message: "Name has already been taken" });
    if (method === "POST" && url.endsWith("/sites/site_race/deploys")) return jsonResponse(200, { id: "deploy_race", state: "ready", required: [] });
    if (method === "GET" && url.endsWith("/deploys/deploy_race")) return jsonResponse(200, { id: "deploy_race", state: "ready", url: "jini-demo.netlify.app" });
    return new Response("", { status: 200 });
  });
  const result = await publish(kit, { files: [], projectName: "demo" });
  assert.deepEqual(result.providerMetadata, { siteId: "site_race", siteName: "jini-demo" });
  assert.equal(listCount, 2);
});

test("throws the original creation error when the site truly cannot be found after a failed create", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, []);
    if (method === "POST" && url.endsWith("/sites")) return jsonResponse(422, { code: 422, message: "Name has already been taken" });
    return new Response("", { status: 200 });
  });
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), { message: "Name has already been taken" });
});

test("throws DeployError when Netlify reports a terminal error state, surfacing error_message", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_err", state: "preparing", required: [] });
    if (method === "GET" && url.endsWith("/deploys/deploy_err")) return jsonResponse(200, { id: "deploy_err", state: "error", error_message: "Build script failed" });
    return new Response("", { status: 200 });
  });
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), { name: "DeployError", message: "Build script failed" });
});

test("throws DeployError with a generic message when a terminal failure state carries no error_message", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_rej", state: "preparing", required: [] });
    if (method === "GET" && url.endsWith("/deploys/deploy_rej")) return jsonResponse(200, { id: "deploy_rej", state: "rejected" });
    return new Response("", { status: 200 });
  });
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), { message: "Netlify deployment rejected." });
});

test("throws DeployError with the message field when site lookup fails", async (t) => {
  const { kit } = stubKit(t, () => jsonResponse(401, { code: 401, message: "Invalid token" }), {}, "bad");
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }, "bad"), { message: "Invalid token" });
});

test("falls back to a generic message when an error body has no message field", async (t) => {
  const { kit } = stubKit(t, () => jsonResponse(500, {}));
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), { message: "Netlify site lookup failed." });
});

test("throws DeployError when a response body is not valid JSON", async (t) => {
  const { kit } = stubKit(t, () => new Response("not json", { status: 200 }));
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), (error) => error instanceof DeployError);
});

test("throws DeployError when the site response has no id", async (t) => {
  const { kit } = stubKit(t, () => jsonResponse(200, { name: "jini-demo" }));
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), { message: "Netlify site response did not include an id." });
});

test("throws DeployError when the deploy response has no id", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { state: "preparing", required: [] });
    return new Response("", { status: 200 });
  });
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), { message: "Netlify deploy response did not include an id." });
});

test("throws DeployError when a required file upload fails", async (t) => {
  const fileHash = sha1("x");
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_1", state: "preparing", required: [fileHash] });
    if (method === "PUT") return jsonResponse(413, { code: 413, message: "Payload too large" });
    return new Response("", { status: 200 });
  });
  await assert.rejects(publish(kit, { files: [{ file: "big.bin", data: "x" }], projectName: "demo" }), { message: "Payload too large" });
});

test("a failed file upload whose body is not JSON still fails with the upload step's own message", async (t) => {
  const fileHash = sha1("x");
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_1", state: "preparing", required: [fileHash] });
    if (method === "PUT") return new Response("<html>bad gateway</html>", { status: 502 });
    return new Response("", { status: 200 });
  });
  await assert.rejects(publish(kit, { files: [{ file: "big.bin", data: "x" }], projectName: "demo" }), { message: 'Netlify file upload failed for "big.bin".' });
});

test("when no status poll is ever readable the URL comes from the site alone", async (t) => {
  let polls = 0;
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo", ssl_url: "https://jini-demo.netlify.app" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_q", state: "preparing", required: [] });
    if (method === "GET" && url.endsWith("/deploys/deploy_q")) { polls += 1; return new Response("not json", { status: 200 }); }
    return new Response("", { status: 200 });
  });
  const result = await publish(kit, { files: [], projectName: "demo" });
  assert.equal(polls, 30);
  assert.equal(result.url, "https://jini-demo.netlify.app");
});

test("skips uploading a hash Netlify reports as required but that is not in the sent manifest", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_1", state: "preparing", required: ["unknown-hash-not-in-manifest"] });
    if (method === "PUT") throw new Error("should never upload an unknown hash");
    if (method === "GET" && url.endsWith("/deploys/deploy_1")) return jsonResponse(200, { id: "deploy_1", state: "ready", url: "demo.netlify.app" });
    return new Response("", { status: 200 });
  });
  const result = await publish(kit, { files: [{ file: "a.txt", data: "a" }], projectName: "demo" });
  assert.equal(result.status, "ready");
});

test("URL-encodes nested file paths for the upload endpoint and treats duplicate-content files as one upload", async (t) => {
  const shared = sha1("same-content");
  const paths = [];
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) {
      assert.deepEqual(JSON.parse(String(init.body)).files, { "/assets/a b.txt": shared, "/assets/c.txt": shared });
      return jsonResponse(200, { id: "deploy_1", state: "preparing", required: [shared] });
    }
    if (method === "PUT") {
      paths.push(url);
      return jsonResponse(200, {});
    }
    if (method === "GET" && url.endsWith("/deploys/deploy_1")) return jsonResponse(200, { id: "deploy_1", state: "ready", url: "demo.netlify.app" });
    return new Response("", { status: 200 });
  });
  await publish(kit, {
    files: [
      { file: "assets/a b.txt", data: "same-content" },
      { file: "assets/c.txt", data: "same-content" },
    ],
    projectName: "demo",
  });
  assert.equal(paths.length, 1);
  assert.ok(paths[0].includes("/deploys/deploy_1/files/assets/a%20b.txt"));
});

test("keeps polling past a deploy status-check response that fails to parse as JSON instead of treating it as a hard failure", async (t) => {
  let pollCount = 0;
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_flaky_poll", state: "preparing", required: [] });
    if (method === "GET" && url.endsWith("/deploys/deploy_flaky_poll")) {
      pollCount += 1;
      if (pollCount === 1) return new Response("", { status: 200 });
      return jsonResponse(200, { id: "deploy_flaky_poll", state: "ready", url: "demo.netlify.app" });
    }
    return new Response("", { status: 200 });
  });
  const result = await publish(kit, { files: [], projectName: "demo" });
  assert.equal(pollCount, 2);
  assert.equal(result.status, "ready");
});

test("returns the last known deploy state once polling exhausts its 30-attempt budget without a terminal state", async (t) => {
  let pollCount = 0;
  const delays = [];
  const { kit } = stubKit(
    t,
    (url, init) => {
      const method = init.method ?? "GET";
      if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
      if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_stuck", state: "preparing", required: [] });
      if (method === "GET" && url.endsWith("/deploys/deploy_stuck")) {
        pollCount += 1;
        return jsonResponse(200, { id: "deploy_stuck", state: "processing", url: "demo.netlify.app" });
      }
      return new Response("", { status: 200 });
    },
    { sleep: async (ms) => void delays.push(ms) },
  );
  const result = await publish(kit, { files: [], projectName: "demo" });
  assert.equal(pollCount, 30);
  assert.equal(result.deploymentId, "deploy_stuck");
  assert.equal(result.url, "https://demo.netlify.app");
  assert.deepEqual(delays.slice(0, 6), [1000, 1000, 1000, 1000, 1000, 2000], "~1s for the first 5 attempts, 2s thereafter");
});

test("checkReachability probes the URL without any protected-response detection", async (t) => {
  const { kit } = stubKit(t, () => new Response("", { status: 200 }));
  const result = await (await netlifyTarget(kit)).checkReachability("https://demo.netlify.app");
  assert.equal(result.reachable, true);
});

for (const failure of ["503", "network error"]) {
  test(`checkReachability reports unreachable on ${failure}`, async (t) => {
    let probes = 0;
    const { kit } = stubKit(t, (url) => {
      probes += 1;
      assert.equal(url, "https://demo.netlify.app/");
      if (failure === "network error") throw new TypeError("connection refused");
      return new Response("Unavailable", { status: 503 });
    });
    const result = await (await netlifyTarget(kit)).checkReachability("https://demo.netlify.app");
    assert.equal(result.reachable, false);
    assert.ok(probes > 0, "must actually probe the public URL");
  });
}

test("skips the required-uploads loop entirely when the deploy-creation response omits a `required` array", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_1", state: "preparing" });
    if (method === "PUT") throw new Error("should never upload when the deploy response has no required array");
    if (method === "GET" && url.endsWith("/deploys/deploy_1")) return jsonResponse(200, { id: "deploy_1", state: "ready", url: "demo.netlify.app" });
    return new Response("", { status: 200 });
  });
  const result = await publish(kit, { files: [{ file: "a.txt", data: "a" }], projectName: "demo" });
  assert.equal(result.status, "ready");
});

test("falls back to an empty URL and omits reachableAt when no response provides a candidate deployment URL", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_1", state: "preparing", required: [] });
    if (method === "GET" && url.endsWith("/deploys/deploy_1")) return jsonResponse(200, { id: "deploy_1", state: "ready" });
    throw new Error(`unexpected reachability probe: ${method} ${url}`);
  });
  const result = await publish(kit, { files: [], projectName: "demo" });
  assert.equal(result.url, "");
  assert.equal(result.status, "link-delayed");
  assert.equal("reachableAt" in result, false);
});

test("falls back to deploy_ssl_url / deploy_url when neither response carries ssl_url or url", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo", deploy_url: "demo.netlify.app" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_1", state: "preparing", required: [] });
    if (method === "GET" && url.endsWith("/deploys/deploy_1")) return jsonResponse(200, { id: "deploy_1", state: "ready", deploy_ssl_url: "deploy-preview--demo.netlify.app" });
    return new Response("", { status: 200 });
  });
  const result = await publish(kit, { files: [], projectName: "demo" });
  assert.equal(result.url, "https://deploy-preview--demo.netlify.app");
});

test("handles a non-object (array) error body from a failed site lookup by falling back to a generic message", async (t) => {
  const { kit } = stubKit(t, () => jsonResponse(500, ["unexpected", "array", "body"]));
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), { message: "Netlify site lookup failed." });
});

test("falls back to HTTP 502 when a non-JSON response carries no HTTP status of its own", async (t) => {
  const { kit } = stubKit(t, () => Response.error());
  const error = await publish(kit, { files: [], projectName: "demo" }).catch((caught) => caught);
  assert.ok(error instanceof DeployError);
  assert.equal(error.message, "Netlify returned a non-JSON response.");
  assert.equal(error.status, 502);
});

test("throws DeployError with the message field when deploy creation itself fails", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(422, { code: 422, message: "Too many files in one deploy" });
    return new Response("", { status: 200 });
  });
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), { message: "Too many files in one deploy" });
});

test("throws DeployError when a deploy status check fails mid-poll", async (t) => {
  const { kit } = stubKit(t, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo" }]);
    if (method === "POST" && url.endsWith("/deploys")) return jsonResponse(200, { id: "deploy_1", state: "preparing", required: [] });
    if (method === "GET" && url.endsWith("/deploys/deploy_1")) return jsonResponse(503, { code: 503, message: "Service unavailable" });
    return new Response("", { status: 200 });
  });
  await assert.rejects(publish(kit, { files: [], projectName: "demo" }), { message: "Service unavailable" });
});

// ---- New with the plugin port: security headers arrive as data, and the module renders them. ----

/** A deploy that records the manifest it was sent and the body of every uploaded file. */
function recordingNetlify(t) {
  const uploads = new Map();
  let manifest = {};
  const { kit } = stubKit(t, async (url, init) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.includes("/sites?")) return jsonResponse(200, [{ id: "site_1", name: "jini-demo", ssl_url: "https://jini-demo.netlify.app" }]);
    if (method === "POST" && url.endsWith("/deploys")) {
      manifest = JSON.parse(String(init.body)).files;
      return jsonResponse(200, { id: "deploy_1", state: "preparing", required: [...new Set(Object.values(manifest))] });
    }
    if (method === "PUT") {
      uploads.set(decodeURIComponent(url.split("/files/")[1]), Buffer.from(init.body).toString("utf8"));
      return jsonResponse(200, {});
    }
    if (method === "GET" && url.endsWith("/deploys/deploy_1")) return jsonResponse(200, { id: "deploy_1", state: "ready", ssl_url: "https://jini-demo.netlify.app" });
    return new Response("", { status: 200 });
  });
  return { kit, uploads, manifest: () => manifest };
}

test("renders responseHeaders into a root _headers file in Netlify's format", async (t) => {
  const { kit, uploads, manifest } = recordingNetlify(t);
  await publish(kit, {
    files: [{ file: "index.html", data: "<html></html>" }],
    projectName: "demo",
    responseHeaders: { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" },
  });
  assert.deepEqual(Object.keys(manifest()).sort(), ["/_headers", "/index.html"]);
  assert.equal(uploads.get("_headers"), "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n");
});

test("the rendered _headers replaces a site-supplied one (the header set is the host's, not the export's)", async (t) => {
  const { kit, uploads } = recordingNetlify(t);
  await publish(kit, {
    files: [{ file: "_headers", data: "/*\n  X-Stale: yes\n" }],
    projectName: "demo",
    responseHeaders: { "X-Content-Type-Options": "nosniff" },
  });
  assert.equal(uploads.get("_headers"), "/*\n  X-Content-Type-Options: nosniff\n");
});

test("no responseHeaders (or an empty set) means no _headers file is added", async (t) => {
  const { kit, manifest } = recordingNetlify(t);
  await publish(kit, { files: [{ file: "index.html", data: "<html></html>" }], projectName: "demo", responseHeaders: {} });
  assert.deepEqual(Object.keys(manifest()), ["/index.html"]);
});

test("the module accepts any config (Netlify needs no config fields) and serves from the root", async () => {
  const netlify = await loadModule();
  assert.equal(netlify.validateConfig?.({}), null);
  assert.equal(netlify.basePath?.({}), undefined);
});

for (const status of [200, 204, 401, 403, 429, 503]) {
  test(`verifyCredential classifies HTTP ${status} using the authenticated user endpoint`, async (t) => {
    const { kit, calls } = stubKit(t, (url, init) => {
      assert.equal(url, "https://api.netlify.com/api/v1/user");
      assert.equal(init.method ?? "GET", "GET");
      const response = new Response(null, { status });
      t.mock.method(response, "json", () => { throw new Error("must not read private identity fields"); });
      return response;
    });
    const result = await (await loadModule()).verifyCredential({ credential: { token: "tok" }, kit });
    assert.deepEqual(result, status < 300 ? { ok: true } : {
      ok: false,
      reason: status === 401 || status === 403 ? "rejected" : "unreachable",
      statusCode: status,
    });
    assert.deepEqual(calls, [{ method: "GET", url: "https://api.netlify.com/api/v1/user", timeoutMs: kit.timeouts.QUICK }]);
  });
}
