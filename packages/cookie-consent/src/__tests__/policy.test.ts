import { describe, expect, test } from 'vitest';
import type { StoredChoice } from '../contract.js';
import { choicesFor, clamp, DAY_MS, DENIED, effective, isFlags, parseStored, regionFrom } from '../policy.js';

const NOW = 1_800_000_000_000;
const choice = (over: Partial<StoredChoice> = {}): StoredChoice =>
  ({ v: 1, p: 'p1', c: { functional: true, analytics: true, marketing: true }, t: NOW - 1000, a: 'accept', ...over });
const base = { policy: 'p1', region: 'opt-in' as const, gpc: false, nowMs: NOW };

describe('region', () => {
  test('unknown region is strict (opt-in); only the literal hint "us" loosens', () => {
    expect(regionFrom({ configured: 'auto', hint: null })).toBe('opt-in');
    expect(regionFrom({ configured: 'auto', hint: 'US' })).toBe('opt-in');
    expect(regionFrom({ configured: 'auto', hint: 'strict' })).toBe('opt-in');
    expect(regionFrom({ configured: 'auto', hint: 'us' })).toBe('opt-out');
    expect(regionFrom({ configured: 'opt-in', hint: 'us' })).toBe('opt-in');
    expect(regionFrom({ configured: 'opt-out', hint: null })).toBe('opt-out');
  });

  test('no stored choice: strict denies everything, opt-out allows by default', () => {
    expect(effective({ ...base, stored: null }).allowed).toEqual(DENIED);
    const us = effective({ ...base, stored: null, region: 'opt-out' }, { durable: true });
    expect(us.status).toBe('pending');
    expect(us.allowed).toEqual({ necessary: true, functional: true, analytics: true, marketing: true });
    expect(us.receipt).toBe('none');
  });
});

describe('GPC', () => {
  test('GPC clamps analytics and marketing on stored grants, region defaults and new choices', () => {
    expect(clamp({ flags: choicesFor({ action: 'accept' }), gpc: true })).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
    const stored = effective({ ...base, gpc: true, stored: choice({ r: 'receipt-0000000001' }) });
    expect(stored.choices).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
    expect(stored.allowed).toEqual(stored.choices);
    expect(effective({ ...base, gpc: true, stored: null, region: 'opt-out' }).allowed.analytics).toBe(false);
  });
});

describe('choicesFor', () => {
  test('each action maps to fixed flags; picks need literal true', () => {
    expect(choicesFor({ action: 'reject', picked: { analytics: true } })).toEqual({ functional: false, analytics: false, marketing: false });
    expect(choicesFor({ action: 'withdraw' })).toEqual({ functional: false, analytics: false, marketing: false });
    expect(choicesFor({ action: 'save', picked: { analytics: true, marketing: 'yes' as unknown as boolean } })).toEqual({ functional: false, analytics: true, marketing: false });
    expect(choicesFor({ action: 'do-not-sell' })).toEqual({ functional: true, analytics: false, marketing: false });
    expect(choicesFor({ action: 'do-not-sell', picked: { functional: false } }).functional).toBe(false);
  });
});

describe('effective', () => {
  test('durable mode: an unconfirmed grant is shown but not allowed; a receipt allows it', () => {
    const waiting = effective({ ...base, stored: choice({ q: 1 }) }, { durable: true });
    expect(waiting.choices.analytics).toBe(true);
    expect(waiting.allowed).toEqual(DENIED);
    expect(waiting.receipt).toBe('pending');
    const stored = effective({ ...base, stored: choice({ r: 'receipt-0000000001' }) }, { durable: true });
    expect(stored.allowed.analytics).toBe(true);
    expect(stored.receipt).toBe('stored');
  });

  test('local mode allows a choice at once and labels it local', () => {
    const local = effective({ ...base, stored: choice() });
    expect(local.allowed.marketing).toBe(true);
    expect(local.receipt).toBe('local');
    expect(local.action).toBe('accept');
    expect(local.at).toBe(NOW - 1000);
  });

  test('another policy version, an expired choice and a future choice beyond skew are "no choice"', () => {
    expect(effective({ ...base, stored: choice({ p: 'p0' }) }).status).toBe('pending');
    expect(effective({ ...base, stored: choice({ t: NOW - 181 * DAY_MS }) }).status).toBe('pending');
    expect(effective({ ...base, stored: choice({ t: NOW - 2 * DAY_MS }) }, { maxAgeMs: DAY_MS }).status).toBe('pending');
    expect(effective({ ...base, stored: choice({ t: NOW + 30_000 }) }).status).toBe('set');      // clock skew allowed
    expect(effective({ ...base, stored: choice({ t: NOW + 120_000 }) }).status).toBe('pending');
  });
});

describe('parseStored', () => {
  test('malformed, oversized or wrongly typed cookies are no choice', () => {
    for (const raw of [null, '', '{', '[]', 'null', 'x'.repeat(1025), JSON.stringify({ ...choice(), v: 2 }),
      JSON.stringify({ ...choice(), a: 'grant' }), JSON.stringify({ ...choice(), c: { functional: 'true', analytics: true, marketing: true } }),
      JSON.stringify({ ...choice(), t: 'now' }), JSON.stringify({ ...choice(), p: 1 })]) {
      expect(parseStored({ raw })).toBeNull();
    }
  });

  test('only known fields survive; an invalid receipt id is dropped', () => {
    const parsed = parseStored({ raw: JSON.stringify({ ...choice({ r: '../../etc/passwd', q: 1 }), extra: 1, c: { functional: true, analytics: false, marketing: false, necessary: false } }) });
    expect(parsed).toEqual({ v: 1, p: 'p1', c: { functional: true, analytics: false, marketing: false }, t: NOW - 1000, a: 'accept', q: 1 });
    expect(parseStored({ raw: JSON.stringify(choice({ r: 'receipt-0000000001' })) })?.r).toBe('receipt-0000000001');
  });

  test('isFlags needs three own booleans', () => {
    expect(isFlags(null)).toBe(false);
    expect(isFlags({ functional: true, analytics: true })).toBe(false);
    expect(isFlags({ functional: false, analytics: false, marketing: false })).toBe(true);
  });
});
