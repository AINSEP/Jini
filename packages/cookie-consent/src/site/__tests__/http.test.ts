import { createSiteConsentDocumentOwner } from "../document-state.js";
import { DEFAULT_MAX_AGE_MS } from "../../contracts/policy.js";
import type { ConsentRecord } from "../../server/receipt.js";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { createSiteConsentHttp, analyticsProof, collectorDecision, matchConsentPluginHttp, readVisitorConsent, receiptAllowsAnalytics } from "../http.js";
import { readConsent } from "../../server/index.js";
import { CONSENT_COOKIE } from "../../contract.js";
import type { ConsentConfig } from "@jini-ai/core/contracts/site/cookie-consent";

const config: ConsentConfig = { enabled: true, regionMode: "opt-in", policyVersion: "p", privacyPolicyUrl: "/privacy", title: "", message: "", acceptLabel: "", rejectLabel: "", preferencesLabel: "" };

it("refuses a collector before rate or handler work and refuses a retired receipt at delivery", async () => {
  const rateAllowed = vi.fn(async () => true);
  const state = readConsent({ cookieHeader: "", policy: "p", regionMode: "opt-in" });
  expect(await collectorDecision({ origin: "https://site", siteOrigin: () => "https://site", adapter: { category: "analytics" }, readState: async () => state, rateAllowed })).toEqual({ status: 403, analyticsLevel: "none" });
  expect(rateAllowed).not.toHaveBeenCalled();
  const readReceipt = vi.fn(async () => null);
  expect(await receiptAllowsAnalytics({ proof: { receiptId: "retired", policyVersion: "p" }, readSnapshot: async () => config, snapshotUnavailable: () => false, readPolicyVersion: async () => "p", readReceipt, nowMs: () => 1000 })).toBe(false);
  expect(readReceipt).toHaveBeenCalledWith({ id: "retired" });
});

it("requires anonymous support when the published banner is off without reading fallback policy", async () => {
  const readPolicy = vi.fn(async () => config);
  const state = await readVisitorConsent({ readSnapshot: async () => ({ ...config, enabled: false }), snapshotUnavailable: () => false, readPolicy, facts: () => ({ cookieHeader: "bad", nowMs: 1000 }) });
  expect(state.analyticsLevel).toBe("anonymous");
  expect(readPolicy).not.toHaveBeenCalled();
  for (const supportsAnonymous of [false, true]) {
    expect((await collectorDecision({ origin: "site", siteOrigin: () => "site", adapter: { category: "analytics", supportsAnonymous }, readState: async () => state, rateAllowed: async () => true })).status).toBe(supportsAnonymous ? null : 403);
  }
  expect((await collectorDecision({ origin: "site", siteOrigin: () => "site", adapter: { category: "necessary" }, readState: async () => state, rateAllowed: async () => true })).status).toBe(403);
});

it("rejects invalid cookie encoding and stale policy before receipt I/O", async () => {
  const state = { ...readConsent({ cookieHeader: "", policy: "p", regionMode: "opt-in" }), analyticsLevel: "full" as const };
  expect(analyticsProof({ state, cookieHeader: `${CONSENT_COOKIE}=%E0%A4%A` })).toBeUndefined();
  const readReceipt = vi.fn(async () => null);
  expect(await receiptAllowsAnalytics({ proof: { receiptId: "id", policyVersion: "old" }, readSnapshot: async () => config, snapshotUnavailable: () => false, readPolicyVersion: async () => "p", readReceipt, nowMs: () => 0 })).toBe(false);
  expect(readReceipt).not.toHaveBeenCalled();
});

it("rejects unsafe plugin paths without adapter enumeration", () => {
  const plugins = vi.fn(() => []);
  for (const full of ["/_consent/p/../x", "/_consent/p/%2f", "/_consent/p/\\x"]) expect(matchConsentPluginHttp({ full, plugins })).toBeUndefined();
  expect(plugins).not.toHaveBeenCalled();
});

it("shares one publication owner across mounts, isolates another site and retains last good state", async () => {
  const owner = createSiteConsentDocumentOwner({ schedule: () => () => {}, exportUnavailableWarning: "unpublished" });
  const consent: import("@jini-ai/core/contracts/headless/site-cookie-consent").SiteCookieConsentDeps = { regionResolvers: async () => [] };
  const readPolicy = vi.fn(async () => config);
  const readDeclarations = vi.fn(async () => ({ scripts: [{ src: "/plugin.js" }] }));
  const input = { now: () => 0, consent, client: () => undefined, readPolicy, readDeclarations,
    policyFailure: vi.fn(), declarationFailure: vi.fn(), exportAssets: async () => [] };
  const first = owner.siteDocumentState(input);
  expect(owner.siteDocumentState(input)).toBe(first);
  await consent.refresh?.();
  expect(readPolicy).toHaveBeenCalledOnce();
  readPolicy.mockRejectedValueOnce(new Error("offline"));
  readDeclarations.mockRejectedValueOnce(new Error("declarations"));
  await expect(consent.refresh?.()).rejects.toThrow("offline");
  expect(await owner.documentPolicy({ consent })).toBe(config);
  expect(await owner.documentDeclarations({ consent })).toEqual([{ src: "/plugin.js" }]);
  const separate: import("@jini-ai/core/contracts/headless/site-cookie-consent").SiteCookieConsentDeps = { regionResolvers: async () => [] };
  owner.siteDocumentState({ ...input, consent: separate, readPolicy: async () => { throw new Error("unpublished"); } });
  await Promise.resolve();
  expect(await separate.exportWarning?.()).toBe("unpublished");
  expect(await owner.documentDeclarations({ consent: separate })).toEqual([{ src: "/plugin.js" }]);
  expect(owner.unavailableDocumentPolicy({ consent: separate, config: await owner.documentPolicy({ consent: separate }) })).toBe(true);
  expect(owner.unavailableDocumentPolicy({ consent: { regionResolvers: async () => [] }, config: null })).toBe(false);
});

it("falls through unknown collectors and strips the mounted prefix without visitor headers", async () => {
  const http = createSiteConsentHttp({ endpoint: "/consent", pluginBase: "/consent/p", regionCookieName: "region", legacyCookieName: "legacy" });
  const handle = vi.fn(async () => ({ status: 200, body: "asset", cacheControl: "public, max-age=60" }));
  const writer = { setHeader: vi.fn(), status: vi.fn(), end: vi.fn() };
  const next = vi.fn();
  const facts = { method: "GET", path: "/missing", body: new Uint8Array(), contentType: undefined, origin: undefined };
  await http.pluginHttp({ facts, plugins: () => [], siteOrigin: () => "site", readState: vi.fn(), rateAllowed: vi.fn(), writer, next });
  expect(next).toHaveBeenCalledOnce();
  await http.pluginHttp({ facts: { ...facts, path: "/adapter/sdk" }, plugins: () => [{ adapter: { id: "adapter", kind: "analytics" }, http: { path: "/consent/p/adapter", handle } }], siteOrigin: () => "site", readState: vi.fn(), rateAllowed: vi.fn(), writer, next });
  expect(handle).toHaveBeenCalledWith({ method: "GET", path: "/sdk", body: new Uint8Array(), contentType: "application/octet-stream" });
  expect(writer.setHeader).toHaveBeenLastCalledWith("Cache-Control", "public, max-age=60");
});

it("mounts readiness before assets, preserves asset failure ordering and keeps receipt stores mount-scoped", async () => {
  const http = createSiteConsentHttp({ endpoint: '/consent', pluginBase: '/consent/p', regionCookieName: 'region', legacyCookieName: 'legacy' });
  const order: string[] = [];
  const store = { save: vi.fn() };
  await http.beforeRender({ readPolicy: async () => { order.push('policy'); return config; }, attachAssets: () => { order.push('attach'); }, next: () => { order.push('next'); } });
  expect(order).toEqual(['policy', 'attach', 'next']);
  order.length = 0;
  http.applySiteCookieConsent({ install: () => ({ client: { body: new Uint8Array(), src: '/client' }, scripts: Promise.resolve([]), nextReadAt: Infinity, now: () => 0, schedule: () => () => {} }),
    mountReadiness: () => { order.push('ready'); }, mountClient: () => { order.push('client'); }, loadExtension: () => { order.push('extension'); throw new Error('missing'); },
    mountExtension: () => { order.push('unexpected-extension'); }, extensionFailure: { diagnosticUnavailable: 'unavailable', formatError: () => { order.push('format'); throw new Error('diagnostics'); }, warn: value => { order.push(value); } },
    mountStaticThemeLoader: () => { order.push('loader'); }, mountDiagnostics: () => { order.push('diagnostics'); }, mountContext: () => { order.push('context'); },
    createReceiptLimiter: () => { order.push('receipt-limit'); return { check: vi.fn() }; }, openReceiptStore: () => { order.push('store'); return store; },
    receiptBodyLimit: '4kb', pluginBodyLimit: '256kb', mountReceipts: input => { expect(input.store).toBe(store); expect(input.bodyLimit).toBe('4kb'); order.push('receipts'); },
    createCollectorLimiter: () => { order.push('collector-limit'); return { check: vi.fn() }; }, mountPluginHttp: input => { expect(input.bodyLimit).toBe('256kb'); order.push('plugins'); } });
  expect(order).toEqual(['ready', 'client', 'extension', 'format', 'unavailable', 'loader', 'diagnostics', 'context', 'receipt-limit', 'store', 'receipts', 'collector-limit', 'plugins']);
});

it("reports a receipt failure before writing the refusal even if the reporter fails", async () => {
  const http = createSiteConsentHttp({ endpoint: '/consent', pluginBase: '/consent/p', regionCookieName: 'region', legacyCookieName: 'legacy' });
  const order: unknown[] = [];
  await http.receipts({ readPolicy: async () => { throw new Error('store'); }, request: vi.fn(), store: { save: vi.fn() }, now: vi.fn(), ids: vi.fn(), allow: vi.fn(), write: vi.fn(),
    failure: { report: error => { order.push(error); throw new Error('diagnostics'); }, diagnosticFailure: () => { order.push('diagnostic'); }, write: id => { order.push(['refusal', id]); } } });
  expect(order).toEqual([expect.objectContaining({ message: 'store' }), 'diagnostic', ['refusal', undefined]]);
});

it('refreshes an expired document snapshot while continuing to serve its last good policy', async () => {
  let now = 10;
  let resolvePolicy!: (value: ConsentConfig) => void;
  const delayed = new Promise<ConsentConfig>((resolve) => { resolvePolicy = resolve; });
  const owner = createSiteConsentDocumentOwner({ schedule: () => () => {}, exportUnavailableWarning: 'unpublished' });
  const consent: import('@jini-ai/core/contracts/headless/site-cookie-consent').SiteCookieConsentDeps = { regionResolvers: async () => [] };
  const readPolicy = vi.fn(async () => config).mockImplementationOnce(async () => config).mockReturnValueOnce(delayed);
  owner.siteDocumentState({ now: () => now, consent, client: () => undefined, readPolicy, readDeclarations: async () => ({ scripts: [] }),
    policyFailure: vi.fn(), declarationFailure: vi.fn(), exportAssets: async () => [] });
  await consent.refresh?.();
  now = 60_009;
  expect(await owner.documentPolicy({ consent })).toBe(config);
  expect(readPolicy).toHaveBeenCalledTimes(1);
  now = 60_010;
  expect(await owner.documentPolicy({ consent })).toBe(config);
  expect(readPolicy).toHaveBeenCalledTimes(2);
  resolvePolicy({ ...config, policyVersion: 'new-publication' });
  await consent.refresh?.();
  expect((await owner.documentPolicy({ consent }))?.policyVersion).toBe('new-publication');
  expect(readPolicy).toHaveBeenCalledTimes(2);
});

const http = createSiteConsentHttp({ endpoint: '/consent', pluginBase: '/consent/p', regionCookieName: 'region', legacyCookieName: 'legacy' });

it('serves a resumed live analytics proof only when its receipt matches current policy and lifetime', async () => {
  const now = Date.parse('2026-11-24T00:00:00.000Z');
  const record: ConsentRecord = { id: 'receipt-active-123', timestamp: new Date(now - DEFAULT_MAX_AGE_MS).toISOString(), policyVersion: 'p',
    choices: { necessary: true, functional: false, analytics: true, marketing: false }, gpc: false, action: 'save', regionMode: 'opt-in' };
  const readReceipt = vi.fn(async ({ id }: { id: string }) => id === record.id ? record : null);
  const readPolicyVersion = vi.fn(async () => 'p');
  const proof = { receiptId: record.id, policyVersion: 'p' };
  const input = { proof, readSnapshot: async () => null, snapshotUnavailable: () => false, readPolicyVersion, readReceipt, nowMs: () => now };
  expect(await receiptAllowsAnalytics(input)).toBe(true);
  expect(readPolicyVersion.mock.calls).toEqual([[{}]]);
  expect(readReceipt.mock.calls).toEqual([[{ id: 'receipt-active-123' }]]);
  expect(await receiptAllowsAnalytics({ ...input, nowMs: () => now + 1 })).toBe(false);
  expect(await receiptAllowsAnalytics({ ...input, readReceipt: async () => ({ ...record, gpc: true }) })).toBe(false);
  expect(await receiptAllowsAnalytics({ ...input, readReceipt: async () => ({ ...record, policyVersion: 'p-old' }) })).toBe(false);
  expect(await receiptAllowsAnalytics({ ...input, readReceipt: async () => ({ ...record, choices: { ...record.choices, analytics: false } }) })).toBe(false);

  readReceipt.mockClear();
  expect(await receiptAllowsAnalytics({ ...input, snapshotUnavailable: () => true })).toBe(false);
  expect(await receiptAllowsAnalytics({ ...input, readSnapshot: async () => ({ ...config, enabled: false }) })).toBe(false);
  expect(readReceipt).not.toHaveBeenCalled();
});

it('writes a consent receipt from the public request and never forwards unrelated request headers', async () => {
  const now = Date.parse('2026-11-24T00:00:00.000Z');
  const headerValues: Record<string, string> = { origin: 'https://site.example', 'content-type': 'application/json', 'sec-gpc': '1',
    cookie: 'other=abc', authorization: 'host-only' };
  const req = http.toWebRequest({ header: (key) => headerValues[key], originalUrl: '/consent?from=page', origin: 'https://site.example',
    method: 'POST', body: new TextEncoder().encode(JSON.stringify({ policy: 'p', action: 'accept' })) });
  expect(req.url).toBe('https://site.example/consent?from=page');
  expect(Object.fromEntries(req.headers)).toEqual({ 'content-type': 'application/json', cookie: 'other=abc', origin: 'https://site.example', 'sec-gpc': '1' });
  const saved = new Map<string, ConsentRecord>();
  const receiptId = 'receipt-created-123';
  const write = vi.fn();
  const failure = { report: vi.fn(), diagnosticFailure: vi.fn(), write: vi.fn() };
  await http.receipts({ readPolicy: async () => config, request: () => req,
    store: { save: async ({ record }) => { saved.set(record.id, record); } },
    now: () => now, ids: () => receiptId, allow: async () => true, write, failure });
  expect(write.mock.calls).toEqual([[{ status: 201, headers: { 'cache-control': 'no-store', 'content-type': 'application/json' }, body: '{"id":"receipt-created-123"}' }]]);
  expect(saved.get(receiptId)).toEqual({
    id: receiptId, timestamp: '2026-11-24T00:00:00.000Z', policyVersion: 'p', regionMode: 'opt-in', action: 'accept', gpc: true,
    choices: { necessary: true, functional: true, analytics: false, marketing: false },
  });
  expect(failure.write).not.toHaveBeenCalled();
});

it('sets context cookies only for an enabled policy and passes a correlated failure for missing policy', async () => {
  let current: ConsentConfig | null = { ...config, regionMode: 'auto' };
  const unavailable = new Error('no published policy');
  const failure = { report: vi.fn(() => ({ errorId: 'incident-7' })), diagnosticFailure: vi.fn(), write: vi.fn() };
  const resolvers = vi.fn(async () => [{ id: 'trusted-edge', kind: 'region-resolver' as const, resolve: () => 'us' as const }]);
  const response = { setRegionCookie: vi.fn(), clearLegacyCookie: vi.fn(), setCache: vi.fn(), json: vi.fn() };
  const input = { readPolicy: async () => current, resolvers, request: { header: () => null, ip: null }, unavailable: () => unavailable, ...response, failure };
  await http.context(input);
  expect(response.setCache.mock.calls).toEqual([['private, no-store']]);
  expect(response.setRegionCookie.mock.calls).toEqual([['us']]);
  expect(response.clearLegacyCookie.mock.calls).toEqual([[]]);
  expect(response.json.mock.calls).toEqual([[{ enabled: true, policy: 'p', regionMode: 'auto' }]]);
  current = { ...config, enabled: false };
  await http.context(input);
  expect(response.json).toHaveBeenLastCalledWith({ enabled: false, policy: 'p', regionMode: 'opt-in' });
  expect(resolvers).toHaveBeenCalledTimes(1);
  expect(response.setRegionCookie).toHaveBeenCalledTimes(1);
  expect(response.clearLegacyCookie).toHaveBeenCalledTimes(1);
  current = null;
  await http.context(input);
  expect(response.json).toHaveBeenCalledTimes(2);
  expect(failure.report.mock.calls).toEqual([[unavailable]]);
  expect(failure.write.mock.calls).toEqual([['incident-7']]);
});

it('does not rewrite an unchanged US cookie and clears only cookies owned by consent when strict', () => {
  const cookie = vi.fn();
  const clearCookie = vi.fn();
  const input = { secure: false, origin: 'https://site.example', cookieHeader: 'other=us', cookie, clearCookie };
  http.setRegionCookie({ ...input, hint: 'us' });
  expect(cookie.mock.calls).toEqual([['region', 'us', { path: '/', sameSite: 'lax', secure: true, maxAge: 86_400_000 }]]);
  http.setRegionCookie({ ...input, hint: 'us', cookieHeader: 'other=us; region=us' });
  expect(cookie).toHaveBeenCalledTimes(1);
  http.setRegionCookie({ ...input, hint: 'strict' });
  http.clearLegacyCookie({ ...input, cookieHeader: 'other=legacy' });
  expect(clearCookie).not.toHaveBeenCalled();
  http.setRegionCookie({ ...input, hint: 'strict', cookieHeader: 'other=us; region=us' });
  http.clearLegacyCookie({ ...input, cookieHeader: 'other=us; legacy=old' });
  expect(clearCookie.mock.calls).toEqual([['region', { path: '/' }], ['legacy', { path: '/', httpOnly: true, sameSite: 'lax' }]]);
});

it('hashes successful client assets and reports load failure without returning a broken asset', () => {
  const bytes = new Uint8Array([9, 7, 5]);
  const problem = new Error('asset not found');
  const hash = vi.fn(() => '0123456789abcdef');
  const warn = vi.fn();
  const formatError = vi.fn(() => 'client unavailable');
  const ports = { hash, warn, formatError, diagnosticUnavailable: 'fallback diagnostic' };
  expect(http.loadClient({ ...ports, load: () => bytes })).toEqual({ body: bytes, src: '/consent/client-0123456789ab.min.js' });
  expect(hash.mock.calls).toEqual([[bytes]]);
  expect(warn).not.toHaveBeenCalled();
  expect(http.loadClient({ ...ports, load: () => { throw problem; } })).toBeUndefined();
  expect(formatError.mock.calls).toEqual([[problem]]);
  expect(warn.mock.calls).toEqual([['client unavailable']]);
});

it('forwards theme declarations into the loader and returns no script on a correlated render failure', async () => {
  const decl = [{ src: '/theme.js' }];
  const resolveTheme = vi.fn((input: { activeThemeId: string }) => input.activeThemeId === 'current' ? { manifest: { scripts: decl } } : 'none');
  const assets = vi.fn(async () => ({ head: '', body: '<a data-consent-open href="/privacy">Settings</a>' }));
  const write = vi.fn();
  const failure = { report: vi.fn(() => ({ errorId: 'loader-7' })), diagnosticFailure: vi.fn(), write: vi.fn() };
  const input = { readThemeId: async () => 'current', resolveTheme, noThemeId: 'none', assets, exporting: () => false, write, failure };
  await http.staticThemeLoader(input);
  expect(resolveTheme.mock.calls).toEqual([[{ activeThemeId: 'current' }]]);
  expect(assets.mock.calls).toEqual([[decl]]);
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  try {
    dom.window.eval(write.mock.calls[0]?.[0]);
    expect(dom.window.document.querySelector('[data-consent-open]')?.textContent).toBe('Settings');
  } finally { dom.window.close(); }
  await http.staticThemeLoader({ ...input, readThemeId: undefined });
  expect(assets).toHaveBeenLastCalledWith([]);
  const problem = new Error('render failed');
  await http.staticThemeLoader({ ...input, assets: async () => { throw problem; } });
  expect(write).toHaveBeenCalledTimes(2);
  expect(failure.report.mock.calls).toEqual([[problem]]);
  expect(failure.write.mock.calls).toEqual([['loader-7']]);
});
