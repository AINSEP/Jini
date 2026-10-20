import { CONSENT_MAX_AGE_MS, DENIED_CHOICES, type ConsentChoices, type ConsentConfig, type ConsentRecord, type ConsentRegionMode, type ConsentAction } from './types.js';

/** Only California has opt-out defaults; missing/unrecognized regions use opt-in.
 * The host supplies a trusted header value, never a paid geo dependency. @complexity O(1). */
export function resolveConsentRegion({ configuredMode, region }: { configuredMode: ConsentConfig['regionMode']; region: string | null }, _options = {}): ConsentRegionMode {
  if (configuredMode !== 'auto') return configuredMode;
  return region?.trim().toUpperCase() === 'US-CA' ? 'opt-out' : 'opt-in';
}

/** GPC wins over stored or new grants. Conservative analytics denial covers tags that share data.
 * Opt-out regions allow optional categories until refusal; GPC still takes precedence. @complexity O(1). */
export function resolveConsentChoices({ choices, gpc, regionMode = 'opt-in' }: { choices?: ConsentChoices | undefined; gpc: boolean; regionMode?: ConsentRegionMode }, _options = {}): ConsentChoices {
  const effective = { ...(choices ?? (regionMode === 'opt-out' ? { necessary: true, functional: true, analytics: true, marketing: true } : DENIED_CHOICES)), necessary: true };
  if (gpc) return { ...effective, analytics: false, marketing: false };
  return effective;
}

const CONSENT_ACTIONS = ['accept', 'reject', 'save', 'do-not-sell'];
type Evidence = Pick<ConsentRecord, 'regionMode' | 'gpc' | 'action' | 'choices'>;

/** @complexity O(1). */
function isReceiptId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(id);
}

/** Unparseable, future and expired timestamps are all stale. @complexity O(1). */
function isFresh({ timestamp, nowMs, maxAgeMs }: { timestamp: string; nowMs: number; maxAgeMs: number }): boolean {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time <= nowMs && nowMs - time <= maxAgeMs;
}

/** @complexity O(1). */
function isEvidence(record: Partial<ConsentRecord>): record is Partial<ConsentRecord> & Evidence {
  if (record.regionMode !== 'opt-in' && record.regionMode !== 'opt-out') return false;
  if (typeof record.gpc !== 'boolean' || !CONSENT_ACTIONS.includes(record.action ?? '')) return false;
  const choices = record.choices;
  return !!choices && choices.necessary === true && (['functional', 'analytics', 'marketing'] as const).every(key => typeof choices[key] === 'boolean');
}

/** Validate stored evidence at the trust boundary; invalid, stale, or future evidence is absent.
 * @complexity O(1); receipt size is bounded by storage/HTTP adapters. */
export function readConsentRecord({ value, policyVersion, nowMs }: { value: unknown; policyVersion: string; nowMs: number }, { maxAgeMs = CONSENT_MAX_AGE_MS }: { maxAgeMs?: number } = {}): ConsentRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ConsentRecord>;
  if (!isReceiptId(record.id)) return null;
  if (record.policyVersion !== policyVersion || typeof record.timestamp !== 'string') return null;
  if (!isFresh({ timestamp: record.timestamp, nowMs, maxAgeMs }) || !isEvidence(record)) return null;
  return { id: record.id, timestamp: record.timestamp, policyVersion, regionMode: record.regionMode, gpc: record.gpc, action: record.action as ConsentAction, choices: resolveConsentChoices({ choices: record.choices, gpc: record.gpc }) };
}

/** Parse form fields without truthy coercion; reject invalid actions and policy races.
 * @throws Error with an actionable input message. @complexity O(1). */
export function createConsentRecord({ fields, config, id, timestamp, regionMode, gpc }: { fields: Record<string, unknown>; config: ConsentConfig; id: string; timestamp: string; regionMode: ConsentRegionMode; gpc: boolean }, _options = {}): ConsentRecord {
  if (fields.policyVersion !== config.policyVersion) throw new Error('The privacy policy changed. Reload this page and choose again.');
  const action = fields.action;
  if (typeof action !== 'string' || !CONSENT_ACTIONS.includes(action)) throw new Error('Choose accept, reject, save, or do-not-sell.');
  let choices: ConsentChoices = { ...DENIED_CHOICES };
  if (action === 'accept') choices = { necessary: true, functional: true, analytics: true, marketing: true };
  if (action === 'do-not-sell') choices = { necessary: true, functional: fields.functional === 'on', analytics: false, marketing: false };
  if (action === 'save') choices = { necessary: true, functional: fields.functional === 'on', analytics: fields.analytics === 'on', marketing: fields.marketing === 'on' };
  return { id, timestamp, policyVersion: config.policyVersion, regionMode, gpc, action: action as ConsentAction, choices: resolveConsentChoices({ choices, gpc }) };
}

/** Each Consent Mode v2 signal follows one category; all advertising signals map to marketing.
 * The browser runtime receives this table so a locally reduced choice signals the same way. */
export const GOOGLE_CONSENT_SIGNAL_CATEGORIES = Object.freeze({ ad_storage: 'marketing', ad_user_data: 'marketing', ad_personalization: 'marketing', analytics_storage: 'analytics', functionality_storage: 'functional', personalization_storage: 'marketing', security_storage: 'necessary' } as const);
/** Keep the original string-valued API for consumers that annotate or update signal payloads. */
export type GoogleConsentSignals = Record<keyof typeof GOOGLE_CONSENT_SIGNAL_CATEGORIES, string>;

/** This enqueues signals, never loads a Google tag. @complexity O(1). */
export function googleConsentSignals({ choices }: { choices: ConsentChoices }, _options = {}): GoogleConsentSignals {
  return Object.fromEntries(Object.entries(GOOGLE_CONSENT_SIGNAL_CATEGORIES).map(([signal, category]) => [signal, category === 'necessary' || choices[category] ? 'granted' : 'denied'])) as GoogleConsentSignals;
}
