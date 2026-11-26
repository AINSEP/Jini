import { handleReceipt, type ReceiptPorts } from "../server/receipt.js";
import { resolveRegion } from "../server/region.js";
import type { DocumentState } from "./document-state.js";
import { staticConsentLoaderScript } from "./document-assets.js";
import type { DeclaredScript, RegionResolver } from "@jini-ai/core/contracts/site/cookie-consent";
import type { ConsentAnalyticsProof, ConsentConfig, ConsentState } from '@jini-ai/core/contracts/site/cookie-consent';
import type { ConsentPluginContribution, ConsentPluginHttp } from '@jini-ai/core/contracts/headless/site-cookie-consent';
import { CONSENT_COOKIE, OPTIONAL, type Optional } from '../contract.js';
import { DEFAULT_MAX_AGE_MS, parseStored } from '../contracts/policy.js';
import { readConsent, type ConsentRecord } from '../server/receipt.js';
import { siteBannerMode } from './cookie-consent.js';

/** A dot segment or an encoded separator never reaches a plugin handler, whatever the plugin does with paths. */
const UNSAFE_PLUGIN_PATH = /(?:^|\/)\.\.?(?:\/|$)|%2e|%2f|%5c|\\/i;

/** The active plugin mounted over this path; none for a path with a dot segment or encoded separator. */
export function matchConsentPluginHttp({ plugins, full }: {
  plugins: (required: Record<string, never>) => readonly ConsentPluginContribution[]; full: string;
}, _optional = {}): (ConsentPluginContribution & { http: ConsentPluginHttp }) | undefined {
  if (UNSAFE_PLUGIN_PATH.test(full)) return undefined;
  return plugins({}).find((item): item is ConsentPluginContribution & { http: ConsentPluginHttp } => Boolean(item.http && full.startsWith(item.http.path + '/')));
}

/** Same-origin/category/rate decision plus the server-owned analytics level. Anonymous delivery needs
 * an adapter declaring support. A category that is not optional (even 'necessary') is read as marketing,
 * the strictest. @complexity O(cookie header) plus one policy read. */
export async function collectorDecision({ origin, siteOrigin, adapter, readState, rateAllowed }: {
  origin: string | undefined; siteOrigin: (required: Record<string, never>) => string;
  adapter: Readonly<Record<string, unknown>>;
  readState: (required: Record<string, never>) => Promise<ConsentState>;
  rateAllowed: (required: Record<string, never>) => Promise<boolean>;
}, _optional = {}): Promise<{ status: 403 | 429 | null; analyticsLevel: ConsentState['analyticsLevel'] }> {
  const denied = { status: 403, analyticsLevel: 'none' } as const;
  if (origin !== siteOrigin({})) return denied;
  const category: Optional = (OPTIONAL as readonly unknown[]).includes(adapter.category) ? adapter.category as Optional : 'marketing';
  const state = await readState({});
  const allowed = category === 'analytics' && state.analyticsLevel === 'anonymous' ? adapter.supportsAnonymous === true : state.allowed[category];
  if (!allowed) return denied;
  return { status: await rateAllowed({}) ? null : 429, analyticsLevel: state.analyticsLevel };
}

/** The server gate: what this visitor may run right now (GPC/DNT applied, durable rule: an
 * unconfirmed grant is not allowed). A failed policy read allows nothing. @complexity O(cookie header). */
export async function readVisitorConsent({ readSnapshot, snapshotUnavailable, readPolicy, facts }: {
  readSnapshot: (required: Record<string, never>) => Promise<ConsentConfig | null>;
  snapshotUnavailable: (required: { config: ConsentConfig | null }) => boolean;
  readPolicy: (required: Record<string, never>) => Promise<ConsentConfig>;
  facts: (required: Record<string, never>) => { cookieHeader: string | undefined; secGpc?: string | null; dnt?: string | null; nowMs: number };
}, _optional = {}): Promise<ConsentState> {
  try {
    const snapshot = await readSnapshot({});
    if (snapshotUnavailable({ config: snapshot })) return readConsent({ cookieHeader: '', policy: '', regionMode: 'opt-in' });
    if (snapshot && siteBannerMode({ config: snapshot }) === 'off') {
      const { secGpc, dnt, nowMs } = facts({});
      return readConsent({ cookieHeader: '', policy: snapshot.policyVersion, regionMode: 'opt-in' }, { secGpc, dnt, nowMs, anonymous: true } as Parameters<typeof readConsent>[1]);
    }
    const config = snapshot ?? await readPolicy({});
    const { cookieHeader, ...privacy } = facts({});
    return readConsent({ cookieHeader, policy: config.policyVersion, regionMode: config.regionMode === 'opt-in' ? 'opt-in' : 'auto' }, {
      ...privacy, anonymous: siteBannerMode({ config }) === 'off',
    });
  } catch {
    return readConsent({ cookieHeader: '', policy: '', regionMode: 'opt-in' });
  }
}

/** Detached delivery recheck, the old engine's rule: the receipt is still active (a later choice retires
 * it), names the current policy, grants analytics without GPC and is within the choice lifetime. A forged
 * or withdrawn receipt id never delivers. @complexity O(1): one policy read and one receipt read. */
export async function receiptAllowsAnalytics({ proof, readSnapshot, snapshotUnavailable, readPolicyVersion, readReceipt, nowMs }: {
  proof: ConsentAnalyticsProof;
  readSnapshot: (required: Record<string, never>) => Promise<ConsentConfig | null>;
  snapshotUnavailable: (required: { config: ConsentConfig | null }) => boolean;
  readPolicyVersion: (required: Record<string, never>) => Promise<string>;
  readReceipt: (required: { id: string }) => Promise<Partial<ConsentRecord> | null>;
  nowMs: (required: Record<string, never>) => number;
}, _optional = {}): Promise<boolean> {
  const snapshot = await readSnapshot({});
  if (snapshotUnavailable({ config: snapshot })) return false;
  if (snapshot && siteBannerMode({ config: snapshot }) === 'off') return false;
  const policy = snapshot?.policyVersion ?? await readPolicyVersion({});
  if (proof.policyVersion !== policy) return false;
  const record = await readReceipt({ id: proof.receiptId });
  return activeAnalyticsRecord({ record, policy, nowMs: nowMs({}) });
}

function activeAnalyticsRecord({ record, policy, nowMs }: { record: Partial<ConsentRecord> | null; policy: string; nowMs: number }, _optional = {}): boolean {
  if (!record || record.policyVersion !== policy || record.gpc !== false) return false;
  return record.choices?.analytics === true && nowMs - Date.parse(String(record.timestamp)) <= DEFAULT_MAX_AGE_MS;
}

/** The old engine's analytics proof shape (receipt id + policy), from the new cookie. Undefined unless
 * analytics is allowed and a server receipt exists. @complexity O(cookie header). */
export function analyticsProof(required: { state: ConsentState; cookieHeader: string | undefined }, _optional = {}): ConsentAnalyticsProof | undefined {
  const { state } = required;
  if (state.analyticsLevel !== 'full') return undefined;
  const { cookieHeader } = required;
  const raw = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=([^;]*)`))?.[1];
  let receiptId: string | undefined;
  try { receiptId = parseStored({ raw: raw === undefined ? null : decodeURIComponent(raw) })?.r; } catch { receiptId = undefined; }
  return receiptId ? { receiptId, policyVersion: state.policy } : undefined;
}

function loadClient(input: { endpoint: string; load: () => Uint8Array; hash: (body: Uint8Array) => string; diagnosticUnavailable: string; formatError: (error: unknown) => string; warn: (diagnostic: string) => void }, _optional = {}) {
      try {
        const body = input.load();
        const hash = input.hash(body).slice(0, 12);
        return { body, src: `${input.endpoint}/client-${hash}.min.js` };
      } catch (error) {
        let errorDiagnostic = input.diagnosticUnavailable;
        try { errorDiagnostic = input.formatError(error); } catch { /* Keep the original failure path if diagnostics fail. */ }
        input.warn(errorDiagnostic);
        return undefined;
      }
    }

async function mountPluginHttp({ pluginBase, facts, plugins, siteOrigin, readState, rateAllowed, writer, next }: {
      pluginBase: string; facts: { method: string; path: string; body: Uint8Array; contentType: string | undefined; origin: string | undefined };
      plugins: Parameters<typeof matchConsentPluginHttp>[0]['plugins']; siteOrigin: () => string;
      readState: () => Promise<ConsentState>; rateAllowed: () => Promise<boolean>;
      writer: { setHeader: (name: string, value: string) => void; status: (code: number) => void; end: (body?: string | Uint8Array) => void }; next: () => void;
    }, _optional = {}): Promise<void> {
      const full = pluginBase + facts.path;
      const plugin = matchConsentPluginHttp({ plugins, full });
      if (!plugin) { next(); return; }
      try {
        const decision = facts.method === 'GET' ? undefined : await collectorDecision({ origin: facts.origin, siteOrigin, adapter: plugin.adapter, readState, rateAllowed });
        if (decision?.status) { writer.status(decision.status); writer.end(); return; }
        const result = await plugin.http.handle({ method: facts.method, path: full.slice(plugin.http.path.length), body: facts.body,
          contentType: facts.contentType ?? 'application/octet-stream', ...(decision && { analyticsLevel: decision.analyticsLevel }) });
        if (result.contentType) writer.setHeader('Content-Type', result.contentType);
        writer.setHeader('Cache-Control', facts.method === 'GET' && result.cacheControl ? result.cacheControl : 'private, no-store');
        writer.status(result.status); writer.end(result.body);
      } catch { writer.status(502); writer.end(); }
    }

async function mountReceipts(input: {
      readPolicy: () => Promise<ConsentConfig>; request: () => Request; store: ReceiptPorts['store'];
      now: ReceiptPorts['now']; ids: ReceiptPorts['ids']; allow: () => Promise<boolean>;
      write: (required: { status: number; headers: Record<string, string>; body: string }) => void;
      failure: { report: (error: unknown) => { errorId?: string }; diagnosticFailure: () => void; write: (errorId: string | undefined) => void };
    }, _optional = {}): Promise<void> {
      try {
        const config = await input.readPolicy();
        const response = await handleReceipt({ request: input.request(), ports: {
          store: input.store, policy: () => config.policyVersion, now: input.now,
          // Receipt ids must be unguessable; the site's time-ordered id generator is not.
          ids: input.ids,
        } }, { regionMode: config.regionMode === 'opt-in' ? 'opt-in' : 'auto', allow: input.allow });
        input.write({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      } catch (error) {
        let errorId: string | undefined;
        try { ({ errorId } = input.failure.report(error)); } catch { input.failure.diagnosticFailure(); }
        input.failure.write(errorId);
      }
    }

async function mountContext(input: {
      readPolicy: () => Promise<ConsentConfig | null>; resolvers: () => Promise<readonly RegionResolver[]>;
      request: Parameters<typeof resolveRegion>[0]['request']; setRegionCookie: (hint: 'us' | 'strict') => void; clearLegacyCookie: () => void;
      setCache: (value: string) => void; json: (body: unknown) => void; failure: { report: (error: unknown) => { errorId?: string }; diagnosticFailure: () => void; write: (errorId: string | undefined) => void }; unavailable: () => Error;
    }, _optional = {}): Promise<void> {
      input.setCache('private, no-store');
      try {
        const config = await input.readPolicy();
        if (!config) throw input.unavailable();
        const enabled = siteBannerMode({ config }) !== 'off';
        if (enabled) {
          const hint = await resolveRegion({ resolvers: await input.resolvers(), request: input.request });
          input.setRegionCookie(hint);
          input.clearLegacyCookie();
        }
        input.json({ enabled, policy: config.policyVersion, regionMode: config.regionMode === 'opt-in' ? 'opt-in' : 'auto' });
      } catch (error) {
        let errorId: string | undefined;
        try { ({ errorId } = input.failure.report(error)); } catch { input.failure.diagnosticFailure(); }
        input.failure.write(errorId);
      }
    }

async function mountStaticThemeLoader(input: {
      readThemeId: (() => Promise<string>) | undefined;
      resolveTheme: (required: { activeThemeId: string }) => { manifest: { scripts?: readonly DeclaredScript[] } } | string | null;
      noThemeId: string;
      assets: (scripts: readonly DeclaredScript[]) => Promise<{ head: string; body: string }>;
      exporting: () => boolean; write: (body: string) => void; failure: { report: (error: unknown) => { errorId?: string }; diagnosticFailure: () => void; write: (errorId: string | undefined) => void };
    }, _optional = {}): Promise<void> {
      try {
        const theme = input.readThemeId ? input.resolveTheme({ activeThemeId: await input.readThemeId() }) : null;
        const scripts = theme && theme !== input.noThemeId ? (theme as { manifest: { scripts?: readonly DeclaredScript[] } }).manifest.scripts ?? [] : [];
        const assets = await input.assets(scripts);
        input.write(staticConsentLoaderScript({ ...assets, exporting: input.exporting() }));
      } catch (error) {
        let errorId: string | undefined;
        try { ({ errorId } = input.failure.report(error)); } catch { input.failure.diagnosticFailure(); }
        input.failure.write(errorId);
      }
    }

function applySiteCookieConsent(input: {
      install: () => DocumentState; mountReadiness: () => void;
      mountClient: (client: NonNullable<DocumentState['client']>) => void;
      loadExtension: () => Uint8Array; mountExtension: (bytes: Uint8Array) => void; extensionFailure: { diagnosticUnavailable: string; formatError: (error: unknown) => string; warn: (diagnostic: string) => void };
      mountStaticThemeLoader: () => void; mountDiagnostics: () => void; mountContext: () => void;
      openReceiptStore: () => ReceiptPorts['store'];
      createReceiptLimiter: () => { check: (required: { key: string }) => Promise<{ allowed: boolean }> };
      createCollectorLimiter: () => { check: (required: { key: string }) => Promise<{ allowed: boolean }> };
      receiptBodyLimit: string; pluginBodyLimit: string;
      mountReceipts: (required: { store: ReceiptPorts['store']; limiter: { check: (required: { key: string }) => Promise<{ allowed: boolean }> }; bodyLimit: string }) => void;
      mountPluginHttp: (required: { limiter: { check: (required: { key: string }) => Promise<{ allowed: boolean }> }; bodyLimit: string }) => void;
    }, _optional = {}): void {
      const { client } = input.install();
      input.mountReadiness();
      if (client) input.mountClient(client);
      try { input.mountExtension(input.loadExtension()); } catch (error) {
        let errorDiagnostic = input.extensionFailure.diagnosticUnavailable;
        try { errorDiagnostic = input.extensionFailure.formatError(error); } catch { /* Keep the original failure path if diagnostics fail. */ }
        input.extensionFailure.warn(errorDiagnostic);
      }
      input.mountStaticThemeLoader();
      input.mountDiagnostics();
      input.mountContext();
      const receiptLimiter = input.createReceiptLimiter();
      const store = input.openReceiptStore();
      input.mountReceipts({ store, limiter: receiptLimiter, bodyLimit: input.receiptBodyLimit });
      const collectorLimiter = input.createCollectorLimiter();
      input.mountPluginHttp({ limiter: collectorLimiter, bodyLimit: input.pluginBodyLimit });
    }

export function createSiteConsentHttp(required: { endpoint: string; pluginBase: string; regionCookieName: string; legacyCookieName: string }, _optional = {}) {
  return {
    readVisitorConsent, receiptAllowsAnalytics, toWebRequest,
    beforeRender: async (input: { readPolicy: () => Promise<ConsentConfig | null>; attachAssets: () => void; next: () => void }) => {
      // Resolve the cached publication before widget rendering; consent-off pages have no activation runtime.
      await input.readPolicy();
      input.attachAssets();
      input.next();
    },
    setRegionCookie: (input: Omit<Parameters<typeof setRegionCookie>[0], 'name'>) => setRegionCookie({ ...input, name: required.regionCookieName }),
    clearLegacyCookie: (input: Omit<Parameters<typeof clearLegacyCookie>[0], 'name'>) => clearLegacyCookie({ ...input, name: required.legacyCookieName }),
    readAnalyticsProof: async (input: { readState: () => Promise<ConsentState>; cookieHeader: () => string | undefined }) =>
      analyticsProof({ state: await input.readState(), get cookieHeader() { return input.cookieHeader(); } }),
    loadClient: (input: Omit<Parameters<typeof loadClient>[0], 'endpoint'>) => loadClient({ ...input, endpoint: required.endpoint }),
    pluginHttp: (input: Omit<Parameters<typeof mountPluginHttp>[0], 'pluginBase'>) => mountPluginHttp({ ...input, pluginBase: required.pluginBase }),
    diagnostics: async (input: { enabled: () => Promise<boolean>; setCache: (cache: string) => void; missing: () => void; send: () => void }) => {
      input.setCache('private, no-store');
      if (!(await input.enabled())) { input.missing(); return; }
      input.send();
    },
    receipts: mountReceipts, context: mountContext, staticThemeLoader: mountStaticThemeLoader, applySiteCookieConsent,
  };
}

function toWebRequest(required: {
  header: (name: string) => string | undefined; originalUrl: string; origin: string; method: string; body: Uint8Array;
}, _optional = {}): Request {
  const headers = new Headers();
  for (const name of ['origin', 'content-type', 'content-length', 'cookie', 'sec-gpc', 'dnt']) {
    const value = required.header(name);
    if (value !== undefined) headers.set(name, value);
  }
  return new Request(new URL(required.originalUrl, required.origin), { method: required.method, headers, body: new Uint8Array(required.body) });
}

/** Region persistence is only reached for an enabled consent banner, never anonymous analytics. */
function setRegionCookie(required: {
  name: string; cookieHeader: string | undefined; secure: boolean; origin: string; hint: 'us' | 'strict';
  cookie: (name: string, value: string, options: { path: string; sameSite: 'lax'; secure: boolean; maxAge: number }) => void;
  clearCookie: (name: string, options: { path: string }) => void;
}, _optional = {}): void {
  const current = required.cookieHeader?.match(new RegExp(`(?:^|;\\s*)${required.name}=([^;]*)`))?.[1];
  const secure = required.secure || required.origin.startsWith('https:');
  if (required.hint === 'us' && current !== 'us') required.cookie(required.name, 'us', { path: '/', sameSite: 'lax', secure, maxAge: 86_400_000 });
  if (required.hint === 'strict' && current !== undefined) required.clearCookie(required.name, { path: '/' });
}

/** Only this engine retires the old host-only HttpOnly cookie; its receipt id proves no new categories. */
function clearLegacyCookie(required: {
  name: string; cookieHeader: string | undefined;
  clearCookie: (name: string, options: { path: string; httpOnly: true; sameSite: 'lax' }) => void;
}, _optional = {}): void {
  if (new RegExp(`(?:^|;\\s*)${required.name}=`).test(required.cookieHeader ?? '')) required.clearCookie(required.name, { path: '/', httpOnly: true, sameSite: 'lax' });
}
