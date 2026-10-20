import { describe, expect, it } from 'vitest';
import { createConsentRecord, googleConsentSignals, readConsentRecord, resolveConsentChoices, resolveConsentRegion } from '../policy.js';
import { CONSENT_MAX_AGE_MS, DENIED_CHOICES } from '../types.js';
import { accepted, config, now } from './fixtures.js';

describe('consent decisions', () => {
  it('uses opt-in for unknown/EU/UK and opt-out only for California; explicit modes win', () => {
    for (const region of [null, 'DE', 'GB', 'EU', 'US', 'CA', 'attacker']) expect(resolveConsentRegion({ configuredMode: 'auto', region })).toBe('opt-in');
    expect(resolveConsentRegion({ configuredMode: 'auto', region: ' us-ca ' })).toBe('opt-out');
    expect(resolveConsentRegion({ configuredMode: 'opt-in', region: 'US-CA' })).toBe('opt-in');
    expect(resolveConsentRegion({ configuredMode: 'opt-out', region: 'DE' })).toBe('opt-out');
    expect(resolveConsentChoices({ gpc: false })).toEqual(DENIED_CHOICES);
    expect(resolveConsentChoices({ gpc: false, regionMode: 'opt-out' })).toEqual(accepted.choices);
    expect(resolveConsentChoices({ choices: { ...DENIED_CHOICES }, gpc: false, regionMode: 'opt-out' })).toEqual(DENIED_CHOICES);
  });
  it('GPC denies analytics/marketing over a previous accept without mutating evidence', () => {
    expect(resolveConsentChoices({ choices: accepted.choices, gpc: true })).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
    expect(accepted.choices.marketing).toBe(true);
  });
  it('reads valid proof and rejects policy races, future/expired evidence and malformed categories', () => {
    const input = { value: accepted, policyVersion: '1', nowMs: Date.parse(now) };
    expect(readConsentRecord(input)).toEqual(accepted);
    expect(readConsentRecord(input, { maxAgeMs: 0 })).toEqual(accepted);
    for (const value of [null, {}, { ...accepted, id: '../outside' }, { ...accepted, timestamp: 'invalid' }, { ...accepted, timestamp: '2026-10-10T12:00:00.000Z' }, { ...accepted, gpc: 'false' }, { ...accepted, action: 'unknown' }, { ...accepted, regionMode: 'auto' }, { ...accepted, choices: { ...accepted.choices, necessary: false } }, { ...accepted, choices: { ...accepted.choices, analytics: 'true' } }, 'receipt', { ...accepted, id: 1234567890123456 }, { ...accepted, timestamp: 0 }, { ...accepted, action: undefined }, { ...accepted, choices: undefined }]) expect(readConsentRecord({ ...input, value })).toBeNull();
    expect(readConsentRecord({ ...input, policyVersion: '2' })).toBeNull();
    expect(readConsentRecord({ ...input, nowMs: Date.parse(now) + CONSENT_MAX_AGE_MS + 1 })).toBeNull();
    expect(readConsentRecord({ ...input, value: { ...accepted, gpc: true } })?.choices).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
  });
  it('reject/no-sale persist denial without a functional selection; category saves accept only exact on strings; GPC overrides all', () => {
    const make = (fields: Record<string, unknown>, gpc = false) => createConsentRecord({ fields: { policyVersion: '1', ...fields }, config, id: accepted.id, timestamp: now, regionMode: 'opt-in', gpc });
    expect(make({ action: 'accept' })).toEqual(accepted);
    expect(make({ action: 'reject' }).choices).toEqual(DENIED_CHOICES);
    expect(make({ action: 'do-not-sell' }).choices).toEqual(DENIED_CHOICES);
    expect(make({ action: 'do-not-sell', functional: 'on', analytics: 'on', marketing: 'on' }).choices).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
    expect(make({ action: 'save', functional: 'on', analytics: true, marketing: ['on'] }).choices).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
    expect(make({ action: 'accept' }, true).choices).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
    expect(() => make({ action: ['accept'] })).toThrow('Choose accept, reject, save, or do-not-sell.');
    expect(() => make({ action: 'accept', policyVersion: '2' })).toThrow('The privacy policy changed. Reload this page and choose again.');
  });
  it('maps all v2 advertising signals to marketing and analytics to its own choice', () => {
    expect(googleConsentSignals({ choices: DENIED_CHOICES })).toEqual({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', functionality_storage: 'denied', personalization_storage: 'denied', security_storage: 'granted' });
    expect(googleConsentSignals({ choices: accepted.choices })).toEqual({ ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted', functionality_storage: 'granted', personalization_storage: 'granted', security_storage: 'granted' });
  });
});


it('always grants security_storage even when a caller supplies necessary=false', () => {
  const signals = googleConsentSignals({ choices: { necessary: false, functional: false, analytics: false, marketing: false } });
  expect(signals).toEqual({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', functionality_storage: 'denied', personalization_storage: 'denied', security_storage: 'granted' });
});
