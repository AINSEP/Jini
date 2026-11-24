/** L131 characterization of live-origin sources and live response projection. */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  OriginNotVerifiedError,
  type VerifiedOrigin,
} from "@jini-ai/core/contracts/server/verified-origin";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { fetchLiveUrl, listKnownLiveOrigins, type FetchLiveUrlDeps } from "../live-url.js";
import { isEgressRefusal, reservedSegments, selectConnectedDestination } from "./live-url-fixtures.js";

const origin = "https://site.example";

function peer(required: { baseUrl: string; updatedAt: string; keyed: boolean }, _optional = {}) {
  return { baseUrl: required.baseUrl, sealed: required.keyed ? { keyId: "test" } : null, updatedAt: required.updatedAt };
}

test("L131: origin sources retain keyed peers and latest connected peer, normalize, sort and deduplicate", async () => {
  const rows = [peer({ baseUrl: "https://old.example", updatedAt: "a", keyed: false }), peer({ baseUrl: origin + "/path", updatedAt: "b", keyed: false }), peer({ baseUrl: "https://keyed.example", updatedAt: "a", keyed: true })];
  assert.deepEqual(await listKnownLiveOrigins({ selectConnectedDestination, workspaceId: "w" }), []);
  assert.deepEqual(await listKnownLiveOrigins({ selectConnectedDestination, workspaceId: "w", publishContentPeerRepo: { listByWorkspace: async input => { assert.equal(input.workspaceId, "w"); return rows; } }, publishHistoryStore: { listLiveUrls: async input => { assert.equal(input.workspaceId, "w"); return [origin, "https://history.example/page"]; } } }), ["https://history.example", "https://keyed.example", origin]);
  assert.deepEqual(await listKnownLiveOrigins({ selectConnectedDestination, workspaceId: "w", publishHistoryStore: { listLiveUrls: async () => Array.from({ length: 200 }, () => origin) } }), [origin]);
  await assert.rejects(listKnownLiveOrigins({ selectConnectedDestination, workspaceId: "w", publishHistoryStore: { listLiveUrls: async () => Array.from({ length: 201 }, () => origin) } }), { message: "fetch_live_url: more than 200 distinct live addresses are recorded. Review the publish history before fetching." });
});

test("L131: configured origins include only workspace settings and suppress only missing verification", async () => {
  const configured: VerifiedOrigin = { scheme: "https", host: "configured.example", source: "workspace-setting", verifiedAt: "2026-01-01" };
  for (const port of [undefined, 443]) {
    assert.deepEqual(await listKnownLiveOrigins({ selectConnectedDestination, workspaceId: "w", originRegistry: { canonicalOrigin: async input => { assert.equal(input.workspaceId, "w"); return { ...configured, ...(port === undefined ? {} : { port }) }; } } }), ["https://configured.example"]);
  }
  assert.deepEqual(await listKnownLiveOrigins({ selectConnectedDestination, workspaceId: "w", originRegistry: { canonicalOrigin: async () => ({ ...configured, source: "dev-capability" }) } }), []);
  assert.deepEqual(await listKnownLiveOrigins({ selectConnectedDestination, workspaceId: "w", originRegistry: { canonicalOrigin: async () => { throw new OriginNotVerifiedError({ message: "missing" }); } } }), []);
  const failure = new Error("registry failed");
  await assert.rejects(listKnownLiveOrigins({ selectConnectedDestination, workspaceId: "w", originRegistry: { canonicalOrigin: async () => { throw failure; } } }), error => error === failure);
  for (const saved of ["invalid", "http://site.example", "https://site.example:8443", "https://user:pass@site.example"]) {
    await assert.rejects(listKnownLiveOrigins({ selectConnectedDestination, workspaceId: "w", publishHistoryStore: { listLiveUrls: async () => [saved] } }), { message: saved === "invalid" ? "fetch_live_url: a saved live address is invalid. Correct the publishing address and retry." : "fetch_live_url: live origins must use HTTPS on port 443 without credentials." });
  }
});

function liveFixture(responses: HttpResponse[]) {
  const calls: HttpRequest[] = [];
  const deps: FetchLiveUrlDeps = { reservedSegments, isEgressRefusal, listKnownOrigins: async () => [origin], httpClient: { send: async request => {
    calls.push(request);
    const response = responses.shift();
    assert.ok(response, "unexpected request");
    return response;
  } } };
  return { deps, calls };
}

test("L131: live response projection preserves status edges, headers, cookie shapes and read caps", async () => {
  for (const status of [199, 200, 299, 300, 302, 404]) {
    const { deps, calls } = liveFixture([{ status, headers: { "X-Test": "kept", "Set-Cookie": "sid=value", Location: "/next" }, setCookies: ["sid=value; Secure; Path=/"], bodyText: "hello" }]);
    // Nonredirect statuses retain a Location header but expose no separate location property.
    if (status === 302) deps.httpClient.send = async request => { calls.push(request); return { status, headers: { Location: "https://elsewhere.example/" }, bodyText: "hello" }; };
    const result = await fetchLiveUrl(deps, { path: "/about?q=1", maxBytes: 3 });
    assert.equal(result.ok, status >= 200 && status < 300);
    assert.equal(result.path, "/about?q=1");
    assert.equal(result.body, "hel"); assert.equal(result.truncated, true);
    assert.equal(calls[0]!.maxResponseBytes, 3);
    assert.equal(result.location, status === 302 ? "https://elsewhere.example/" : undefined);
    if (status !== 302) {
      assert.deepEqual(result.headers, { "x-test": "kept", location: "/next" });
      assert.deepEqual(result.cookies, [{ name: "sid", attributes: ["Secure", "Path=/"] }]);
    }
  }
  const emptyRedirect = liveFixture([{ status: 302, headers: { location: "" }, bodyText: "" }]);
  assert.equal((await fetchLiveUrl(emptyRedirect.deps, { path: "/" })).location, undefined);
  assert.equal(emptyRedirect.calls[0]!.maxResponseBytes, 20_000);
  for (const options of [{ textOnly: true }, { find: "x" }]) {
    const f = liveFixture([{ status: 200, headers: {}, bodyText: "x", bodyTruncated: true }]);
    assert.equal((await fetchLiveUrl(f.deps, { path: "/", ...options })).truncated, true);
    assert.equal(f.calls[0]!.maxResponseBytes, 1_000_000);
  }
  const oversized = liveFixture([{ status: 200, headers: {}, bodyText: "x".repeat(1_000_001) }]);
  const capped = await fetchLiveUrl(oversized.deps, { path: "/", maxBytes: 1_000_000 });
  assert.equal(capped.bodyBytes, 1_000_000); assert.equal(capped.truncated, true);
});

test("L131: live redirect loop stops at three hops or off-origin and returns final evidence", async () => {
  const chain = liveFixture(Array.from({ length: 4 }, (_, i) => ({ status: 302, headers: { location: "/hop" + i }, bodyText: "moved" })));
  const stopped = await fetchLiveUrl(chain.deps, { path: "/" });
  assert.deepEqual(stopped.redirects, [origin + "/hop0", origin + "/hop1", origin + "/hop2"]);
  assert.equal(stopped.url, origin + "/hop2"); assert.equal(stopped.location, "/hop3"); assert.equal(chain.calls.length, 4);
  const cross = liveFixture([{ status: 301, headers: { location: "https://elsewhere.example/" }, bodyText: "moved" }]);
  assert.deepEqual((await fetchLiveUrl(cross.deps, { path: "/" })).redirects, []);
  assert.equal(cross.calls.length, 1);
});
