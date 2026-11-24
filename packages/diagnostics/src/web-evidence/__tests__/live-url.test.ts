/** t08: SSRF, redirect, credential and read-only contracts. No sockets or real DNS. */
import assert from "node:assert/strict";
import { onTestFinished, test, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { OriginNotVerifiedError } from "@jini-ai/core/contracts/server/verified-origin";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { fetchLiveUrl, listKnownLiveOrigins, type FetchLiveUrlDeps, type LiveOriginPolicy, type LiveOriginSourceDeps } from "../live-url.js";
import { egressRefusal, isEgressRefusal, reservedSegments, selectConnectedDestination } from "./live-url-fixtures.js";

const origin = 'https://site.example';
function fake(urls = [origin], responses: HttpResponse[] = [{ status: 200, headers: {}, bodyText: 'hello' }]) {
  const calls: HttpRequest[] = [];
  const deps: FetchLiveUrlDeps = { reservedSegments, isEgressRefusal, listKnownOrigins: async () => urls, httpClient: { send: async req => {
    calls.push(req);
    assert.equal(req.method, 'GET'); assert.deepEqual(req.headers, {}); assert.equal(req.body, undefined);
    const timeoutMs = req.timeoutMs ?? 0; assert.equal(timeoutMs <= 15000 && timeoutMs > 0, true);
    const response = responses.shift(); assert.notEqual(response, undefined, 'unexpected extra request'); return response!;
  } } };
  return { deps, calls };
}
test("one known origin is selected and the page shape removes cookie values", async () => {
  const { deps, calls } = fake([origin], [{ status: 200, headers: { 'X-Test': 'yes', 'set-cookie': 'sid=SECRET' }, setCookies: ['sid=SECRET; Secure; HttpOnly', 'prefs=VALUE; Path=/'], bodyText: 'hello' }]);
  assert.deepEqual(await fetchLiveUrl(deps, { path: '/about' }), { path: '/about', url: origin + '/about', origin, redirects: [], status: 200, ok: true, headers: { 'x-test': 'yes' }, cookies: [{ name: 'sid', attributes: ['Secure', 'HttpOnly'] }, { name: 'prefs', attributes: ['Path=/'] }], body: 'hello', bodyBytes: 5, truncated: false, untrusted: true });
  assert.equal(calls.length, 1);
});
test("none, several, or an unknown origin have exact actionable errors", async () => {
  for (const [urls, supplied, message] of [
    [[], undefined, 'fetch_live_url: this site has no known live address yet. Publish it first, or use fetch_published_page to check the local render.'],
    [[origin, 'https://other.example'], undefined, 'fetch_live_url: several live origins are known. Pass origin as one of: https://other.example, https://site.example.'],
    [[origin], 'https://evil.example', 'fetch_live_url: origin is not a known live address. Pass one of: https://site.example.'],
  ] as const) {
    const { deps, calls } = fake([...urls]);
    await assert.rejects(fetchLiveUrl(deps, { path: '/', ...(supplied ? { origin: supplied } : {}) }), { message });
    assert.deepEqual(calls, []);
  }
});
test("origins require HTTPS/443 and inputs cannot escape onto admin or API", async () => {
  for (const url of ['http://site.example', 'https://site.example:8443', 'https://user:secret@site.example']) {
    const { deps, calls } = fake([url]);
    await assert.rejects(fetchLiveUrl(deps, { path: '/' }), { message: 'fetch_live_url: live origins must use HTTPS on port 443 without credentials.' });
    assert.deepEqual(calls, []);
  }
  for (const path of ['//evil.example', '/api/data', '/%61dmin', '/a/../b']) {
    const { deps, calls } = fake(); await assert.rejects(fetchLiveUrl(deps, { path })); assert.deepEqual(calls, []);
  }
});
test("live path refusals remain model-visible validation errors", async () => {
  const { deps, calls } = fake();
  await assert.rejects(fetchLiveUrl(deps, { path: '/api/data' }), {
    constructor: ToolInputError,
    message: "fetch_live_url: path must not target '/api' — that is the authenticated admin/API surface, not a published page.",
  });
  assert.deepEqual(calls, []);
});
test("explicit known origins select one destination and preserve the query; 404 is evidence", async () => {
  const { deps, calls } = fake(['https://other.example', origin], [{ status: 404, headers: {}, bodyText: 'Missing' }]);
  assert.deepEqual(await fetchLiveUrl(deps, { path: '/missing?lang=en', origin }), {
    path: '/missing?lang=en', status: 404, ok: false, headers: {}, cookies: [], body: 'Missing',
    bodyBytes: 7, truncated: false, url: origin + '/missing?lang=en', origin, redirects: [], untrusted: true,
  });
  assert.deepEqual(calls.map(call => call.url), [origin + '/missing?lang=en']);
});
test("same-origin redirects follow at most three; cross-origin is a result", async () => {
  const { deps, calls } = fake([origin], [{ status: 302, headers: { location: '/next', 'set-cookie': 'session=secret' }, bodyText: '' }, { status: 302, headers: { location: 'https://evil.example/' }, bodyText: 'moved' }]);
  const result = await fetchLiveUrl(deps, { path: '/' });
  assert.equal(result.status, 302); assert.equal(result.location, 'https://evil.example/'); assert.deepEqual(result.redirects, [origin + '/next']);
  assert.deepEqual(calls.map(x => x.url), [origin + '/', origin + '/next']);
  const chain = fake([origin], Array.from({ length: 4 }, (_, i) => ({ status: 302, headers: { location: '/hop' + i }, bodyText: '' })));
  const stopped = await fetchLiveUrl(chain.deps, { path: '/' });
  assert.equal(stopped.status, 302); assert.deepEqual(stopped.redirects, [origin + '/hop0', origin + '/hop1', origin + '/hop2']); assert.equal(chain.calls.length, 4);
});
test("redirects to API or credential URLs are never connected", async () => {
  for (const location of ['/api/private', origin.replace('https://', 'https://user:pass@') + '/']) {
    const { deps, calls } = fake([origin], [{ status: 302, headers: { location }, bodyText: 'stop' }]);
    await assert.rejects(fetchLiveUrl(deps, { path: '/' })); assert.equal(calls.length, 1);
  }
});
test("redirect traversal is refused before URL normalization removes mixed encoded dot segments", async () => {
  for (const location of [origin + '/a/.%2e/b', origin + '/a/%2e./b', 'a/.%2e/b', 'a/%2e./b']) {
    const { deps, calls } = fake([origin], [{ status: 302, headers: { location }, bodyText: '' }]);
    const rawPath = location.startsWith(origin) ? location.slice(origin.length) : '/' + location;
    await assert.rejects(fetchLiveUrl(deps, { path: '/' }), {
      constructor: ToolInputError,
      message: `fetch_live_url: path must not contain a '..' segment (encoded or not): '${rawPath}'.`,
    });
    assert.equal(calls.length, 1);
  }
});
test("a successful same-origin redirect never replays response cookies as request credentials", async () => {
  const { deps, calls } = fake([origin], [
    { status: 302, headers: { location: '/next?fresh=1' }, setCookies: ['session=SECRET'], bodyText: '' },
    { status: 200, headers: {}, bodyText: 'Ready' },
  ]);
  const result = await fetchLiveUrl(deps, { path: '/' });
  assert.equal(result.body, 'Ready');
  assert.deepEqual(result.redirects, [origin + '/next?fresh=1']);
  assert.deepEqual(calls.map(call => ({ method: call.method, headers: call.headers, body: call.body })), [
    { method: 'GET', headers: {}, body: undefined }, { method: 'GET', headers: {}, body: undefined },
  ]);
});
test("body shaping is bounded and textOnly precedes the requested output cap", async () => {
  const { deps } = fake([origin], [{ status: 200, headers: {}, bodyText: '<style>' + 'x'.repeat(300) + '</style><p>Hello there</p>' }]);
  assert.equal((await fetchLiveUrl(deps, { path: '/', textOnly: true, maxBytes: 5 })).body, 'Hello');
  const capped = fake([origin], [{ status: 200, headers: {}, bodyText: 'x'.repeat(200001) }]);
  const result = await fetchLiveUrl(capped.deps, { path: '/' }); assert.equal(result.bodyBytes, 20000); assert.equal(result.truncated, true); assert.equal(result.body?.length, 20000);
});
test("live find counts only available text and reports the upstream raw-read ceiling", async () => {
  const { deps, calls } = fake([origin], [{ status: 200, headers: {}, bodyText: '<script>needle</script><p>Needle</p>', bodyTruncated: true }]);
  assert.deepEqual(await fetchLiveUrl(deps, { path: '/', textOnly: true, find: 'needle' }), {
    path: '/', url: origin + '/', origin, redirects: [], status: 200, ok: true, headers: {}, cookies: [],
    matches: [{ offset: 0, snippet: 'Needle' }], matchCount: 1, bodyBytes: 6, truncated: true, untrusted: true,
  });
  assert.equal(calls[0]!.maxResponseBytes, 1000000);
});
test("absent and development origin evidence supplies no live address", async () => {
  assert.deepEqual(await listKnownLiveOrigins({ selectConnectedDestination, workspaceId: 'w' }), []);
  assert.deepEqual(await listKnownLiveOrigins({ selectConnectedDestination, workspaceId: 'w', originRegistry: {
    canonicalOrigin: async required => {
      assert.deepEqual(required, { workspaceId: 'w' });
      return { scheme: 'http', host: 'localhost', port: 3000, source: 'dev-capability', verifiedAt: '' };
    },
  } }), []);
});
test("configured origin port formatting preserves absent, zero, default and refused ports", async () => {
  for (const port of [undefined, 0, 443]) {
    const deps: LiveOriginSourceDeps & LiveOriginPolicy = { selectConnectedDestination, workspaceId: 'w', originRegistry: {
      canonicalOrigin: async () => ({ scheme: 'https', host: 'configured.example', source: 'workspace-setting', verifiedAt: '', ...(port === undefined ? {} : { port }) }),
    } };
    assert.deepEqual(await listKnownLiveOrigins(deps), ['https://configured.example']);
  }
  await assert.rejects(listKnownLiveOrigins({ selectConnectedDestination, workspaceId: 'w', originRegistry: {
    canonicalOrigin: async () => ({ scheme: 'https', host: 'configured.example', port: 8443, source: 'workspace-setting', verifiedAt: '' }),
  } }), { constructor: ToolInputError, message: 'fetch_live_url: live origins must use HTTPS on port 443 without credentials.' });
});
test("only missing origin verification is ignored; other registry failures retain their identity", async () => {
  assert.deepEqual(await listKnownLiveOrigins({ selectConnectedDestination, workspaceId: 'w', originRegistry: {
    canonicalOrigin: async () => { throw new OriginNotVerifiedError({ message: 'not configured' }); },
  } }), []);
  for (const error of [new Error('registry unavailable'), { code: 'registry failure' }]) {
    await assert.rejects(listKnownLiveOrigins({ selectConnectedDestination, workspaceId: 'w', originRegistry: {
      canonicalOrigin: async () => { throw error; },
    } }), caught => caught === error);
  }
});
test("one absolute deadline bounds stalled origin reads and stalled HTTP reads", async () => {
  for (const stalled of ['origins', 'http'] as const) {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { assert.equal(ms, 15000); return controller.signal; });
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const deps: FetchLiveUrlDeps = {
      reservedSegments, isEgressRefusal,
      listKnownOrigins: async () => stalled === 'origins' ? new Promise(() => { started(); }) : [origin],
      httpClient: { send: async request => {
        assert.equal(stalled, 'http'); assert.equal(request.signal, controller.signal);
        return new Promise((_resolve, reject) => {
          request.signal!.addEventListener('abort', () => reject(request.signal!.reason), { once: true });
          started();
        });
      } },
    };
    const work = fetchLiveUrl(deps, { path: '/' });
    await ready;
    controller.abort(new DOMException('deadline', 'TimeoutError'));
    await assert.rejects(work, { constructor: ToolInputError, message: 'fetch_live_url: fetching the live page exceeded 15000ms. Check the hosting service before retrying.' });
    timeout.mockRestore();
  }
});
test("deadline expiry between redirect hops is also a model-visible timeout", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => controller.signal);
  onTestFinished(() => timeout.mockRestore());
  let requests = 0;
  const deps: FetchLiveUrlDeps = {
    reservedSegments, isEgressRefusal,
    listKnownOrigins: async () => [origin],
    httpClient: { send: async () => {
      requests++;
      controller.abort(new DOMException('deadline', 'TimeoutError'));
      return { status: 302, headers: { location: '/next' }, bodyText: '' };
    } },
  };
  await assert.rejects(fetchLiveUrl(deps, { path: '/' }), { constructor: ToolInputError, message: 'fetch_live_url: fetching the live page exceeded 15000ms. Check the hosting service before retrying.' });
  assert.equal(requests, 1);
});
test("an injected egress refusal is projected as its caller-safe text and observed as refused", async () => {
  const events: string[] = [];
  const deps: FetchLiveUrlDeps = { reservedSegments, isEgressRefusal, listKnownOrigins: async () => [origin],
    httpClient: { send: async () => { throw egressRefusal({ callerSafeMessage: "egress to 'site.example' rejected: resolved address is private" }); } },
    observeFetch: event => { events.push(event.outcome); } };
  await assert.rejects(fetchLiveUrl(deps, { path: '/' }), { constructor: ToolInputError, message: "fetch_live_url: egress to 'site.example' rejected: resolved address is private" });
  assert.deepEqual(events, ['refused']);
  const other = new Error('socket reset');
  await assert.rejects(fetchLiveUrl({ ...deps, httpClient: { send: async () => { throw other; } } }, { path: '/' }), caught => caught === other);
  assert.deepEqual(events, ['refused', 'failed']);
});
test("the injected reserved segments are the only refused first segments", async () => {
  const { deps, calls } = fake([origin], [{ status: 200, headers: {}, bodyText: 'ok' }]);
  await assert.rejects(fetchLiveUrl({ ...deps, reservedSegments: new Set(['private']) }, { path: '/private/x' }), { constructor: ToolInputError });
  assert.equal((await fetchLiveUrl({ ...deps, reservedSegments: new Set(['private']) }, { path: '/api/data' })).status, 200);
  assert.deepEqual(calls.map(call => call.url), [origin + '/api/data']);
});
test("the connected peer is the row the injected rule returns, compared by identity", async () => {
  const twin = { baseUrl: 'https://twin.example', sealed: null };
  const chosen = { baseUrl: 'https://chosen.example', sealed: null };
  const rows = [twin, chosen, { baseUrl: 'https://keyed.example', sealed: {} }];
  const seen: unknown[] = [];
  const deps: LiveOriginSourceDeps & LiveOriginPolicy = { workspaceId: 'w', publishContentPeerRepo: { listByWorkspace: async () => rows },
    selectConnectedDestination: required => { seen.push(required.rows); return chosen; } };
  assert.deepEqual(await listKnownLiveOrigins(deps), ['https://chosen.example', 'https://keyed.example']);
  assert.deepEqual(seen, [rows]);
  assert.deepEqual(await listKnownLiveOrigins({ ...deps, selectConnectedDestination: () => ({ ...chosen }) }), ['https://keyed.example']);
});
