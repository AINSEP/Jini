import { createSiteConsentDocumentOwner } from "../document-state.js";
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
