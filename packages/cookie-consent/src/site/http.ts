import type { ConsentAnalyticsProof, ConsentConfig, ConsentState } from '@jini-ai/core/contracts/site/cookie-consent';
import type { ConsentPluginContribution, ConsentPluginHttp } from '@jini-ai/core/contracts/headless/site-cookie-consent';
import { CONSENT_COOKIE, OPTIONAL, type Optional } from '../contract.js';
import { DEFAULT_MAX_AGE_MS, parseStored } from '../policy.js';
import { readConsent, type ConsentRecord } from '../server/index.js';
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
  adapter: { category?: unknown; supportsAnonymous?: unknown };
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
export function analyticsProof({ state, cookieHeader }: { state: ConsentState; cookieHeader: string | undefined }, _optional = {}): ConsentAnalyticsProof | undefined {
  if (state.analyticsLevel !== 'full') return undefined;
  const raw = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=([^;]*)`))?.[1];
  let receiptId: string | undefined;
  try { receiptId = parseStored({ raw: raw === undefined ? null : decodeURIComponent(raw) })?.r; } catch { receiptId = undefined; }
  return receiptId ? { receiptId, policyVersion: state.policy } : undefined;
}
