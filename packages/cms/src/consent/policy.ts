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

/** Validate stored evidence at the trust boundary; invalid, stale, or future evidence is absent.
 * @complexity O(1); receipt size is bounded by storage/HTTP adapters. */
export function readConsentRecord({ value, policyVersion, nowMs }: { value: unknown; policyVersion: string; nowMs: number }, { maxAgeMs = CONSENT_MAX_AGE_MS }: { maxAgeMs?: number } = {}): ConsentRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ConsentRecord>;
  if (typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(record.id)) return null;
  if (record.policyVersion !== policyVersion || typeof record.timestamp !== 'string') return null;
  const time = Date.parse(record.timestamp);
  if (!Number.isFinite(time) || time > nowMs || nowMs - time > maxAgeMs) return null;
  if (record.regionMode !== 'opt-in' && record.regionMode !== 'opt-out') return null;
  if (typeof record.gpc !== 'boolean' || !['accept', 'reject', 'save', 'do-not-sell'].includes(record.action ?? '')) return null;
  const choices = record.choices;
  if (!choices || choices.necessary !== true || ['functional', 'analytics', 'marketing'].some(key => typeof choices[key as keyof ConsentChoices] !== 'boolean')) return null;
  return { id: record.id, timestamp: record.timestamp, policyVersion, regionMode: record.regionMode, gpc: record.gpc, action: record.action as ConsentAction, choices: resolveConsentChoices({ choices, gpc: record.gpc }) };
}

/** Parse form fields without truthy coercion; reject invalid actions and policy races.
 * @throws Error with an actionable input message. @complexity O(1). */
export function createConsentRecord({ fields, config, id, timestamp, regionMode, gpc }: { fields: Record<string, unknown>; config: ConsentConfig; id: string; timestamp: string; regionMode: ConsentRegionMode; gpc: boolean }, _options = {}): ConsentRecord {
  if (fields.policyVersion !== config.policyVersion) throw new Error('The privacy policy changed. Reload this page and choose again.');
  const action = fields.action;
  if (typeof action !== 'string' || !['accept', 'reject', 'save', 'do-not-sell'].includes(action)) throw new Error('Choose accept, reject, save, or do-not-sell.');
  let choices: ConsentChoices = { ...DENIED_CHOICES };
  if (action === 'accept') choices = { necessary: true, functional: true, analytics: true, marketing: true };
  if (action === 'do-not-sell') choices = { necessary: true, functional: fields.functional === 'on', analytics: false, marketing: false };
  if (action === 'save') choices = { necessary: true, functional: fields.functional === 'on', analytics: fields.analytics === 'on', marketing: fields.marketing === 'on' };
  return { id, timestamp, policyVersion: config.policyVersion, regionMode, gpc, action: action as ConsentAction, choices: resolveConsentChoices({ choices, gpc }) };
}

/** All v2 advertising signals map to marketing; this enqueues signals, never loads a Google tag.
 * @complexity O(1). */
export function googleConsentSignals({ choices }: { choices: ConsentChoices }, _options = {}) {
  const marketing = choices.marketing ? 'granted' : 'denied';
  return { ad_storage: marketing, ad_user_data: marketing, ad_personalization: marketing, analytics_storage: choices.analytics ? 'granted' : 'denied', functionality_storage: choices.functional ? 'granted' : 'denied', personalization_storage: marketing, security_storage: 'granted' };
}
