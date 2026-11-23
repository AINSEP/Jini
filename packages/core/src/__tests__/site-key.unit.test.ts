import { describe, expect, it } from 'vitest';
import type {
  AdminGeneratedSiteKey,
  AdminImportedSiteKey,
  AdminRevealedSiteKey,
  AdminSiteKeyGenerateOutcome,
  AdminSiteKeyRuntimeMode,
  AdminSiteKeyStartFreshPreview,
  AdminSiteKeyState,
  AdminSiteKeyStatus,
  AdminStartedFreshSiteKey,
} from '../contracts/site/site-key.js';

/**
 * Compile fixture for the site-key wire shapes. Each `Record<Union, …>` below is exhaustive in
 * both directions: dropping a variant from the contract turns its key into an excess property,
 * and adding one leaves a required key missing — either way `tsc` goes red. The runtime
 * assertions pin the literal spellings so a rename cannot slip through as "still compiles".
 */

const base = { keyFilePath: '/keys/site.key', runtimeMode: 'production' } as const;

const statusByState: Record<AdminSiteKeyState, AdminSiteKeyStatus> = {
  active: { ...base, active: true, source: 'file', fingerprint: 'ab12', state: 'active' },
  missing: { ...base, active: false, source: 'none', state: 'missing' },
  'missing-with-data': { ...base, active: false, source: 'none', state: 'missing-with-data' },
  mismatch: { ...base, active: true, source: 'env', envVarName: 'SITE_KEY', fingerprint: 'cd34', state: 'mismatch' },
  invalid: { ...base, active: false, source: 'env', envVarName: 'SITE_KEY', invalid: true, reason: 'not-hex', state: 'invalid' },
};

const statusBySource: Record<AdminSiteKeyStatus['source'], AdminSiteKeyStatus> = {
  env: statusByState.mismatch,
  file: statusByState.active,
  none: statusByState.missing,
};

const statusByReason: Record<NonNullable<AdminSiteKeyStatus['reason']>, AdminSiteKeyStatus> = {
  empty: { ...statusByState.invalid, reason: 'empty' },
  'not-hex': statusByState.invalid,
  'odd-length': { ...statusByState.invalid, reason: 'odd-length' },
  'too-short': { ...statusByState.invalid, reason: 'too-short' },
};

const modes: Record<AdminSiteKeyRuntimeMode, true> = { production: true, local: true };

const generatedByOutcome: Record<AdminSiteKeyGenerateOutcome, AdminGeneratedSiteKey> = {
  'already-active': { ...base, outcome: 'already-active', fingerprint: 'ab12' },
  recovered: { ...base, outcome: 'recovered', fingerprint: 'ab12' },
  created: { ...base, runtimeMode: 'local', outcome: 'created', fingerprint: 'ef56' },
};

const imported: AdminImportedSiteKey = { ...base, outcome: 'unlocked', fingerprint: 'ab12', resealed: 3 };

const preview: AdminSiteKeyStartFreshPreview = {
  removes: 2,
  affectedWebhooks: [{ label: 'Deploy hook', targetUrl: 'https://example.test/hook' }],
  detail: 'Starting fresh removes 2 saved credentials.',
  runtimeMode: 'production',
};

const startedFresh: AdminStartedFreshSiteKey = {
  ...base,
  outcome: 'started-fresh',
  fingerprint: 'ef56',
  discarded: 2,
  kept: 1,
  restorePointId: 'rp-1',
  affectedWebhooks: preview.affectedWebhooks,
};

const revealedActive: AdminRevealedSiteKey = { ...statusByState.active, hex: 'ab'.repeat(32) };
const revealedInactive: AdminRevealedSiteKey = statusByState.missing;

/** `true` only when `'hex'` is not a key of `T`; `keyof` includes optional keys, so a
 *  `hex?: string` added to any non-reveal response turns its slot below into `false` and fails
 *  `tsc`. The runtime `'hex' in …` checks cannot see an optional field the fixture never sets. */
type LacksHex<T> = 'hex' extends keyof T ? false : true;

const nonRevealResponsesLackHex: [
  status: LacksHex<AdminSiteKeyStatus>,
  generated: LacksHex<AdminGeneratedSiteKey>,
  imported: LacksHex<AdminImportedSiteKey>,
  startFreshPreview: LacksHex<AdminSiteKeyStartFreshPreview>,
  startedFresh: LacksHex<AdminStartedFreshSiteKey>,
] = [true, true, true, true, true];

/** Control for `LacksHex`: the reveal shape does carry `hex`, so the helper is not vacuous. */
const revealCarriesHex: LacksHex<AdminRevealedSiteKey> = false;

describe('site-key contract fixture', () => {
  it('covers every AdminSiteKeyState with a status carrying that state', () => {
    expect(Object.keys(statusByState)).toEqual(['active', 'missing', 'missing-with-data', 'mismatch', 'invalid']);
    for (const [state, status] of Object.entries(statusByState)) expect(status.state).toBe(state);
  });

  it('covers every AdminSiteKeyStatus source and reason variant', () => {
    expect(Object.keys(statusBySource)).toEqual(['env', 'file', 'none']);
    for (const [source, status] of Object.entries(statusBySource)) expect(status.source).toBe(source);
    expect(Object.keys(statusByReason)).toEqual(['empty', 'not-hex', 'odd-length', 'too-short']);
    for (const [reason, status] of Object.entries(statusByReason)) expect(status.reason).toBe(reason);
  });

  it('covers every runtime mode and generate outcome', () => {
    expect(Object.keys(modes)).toEqual(['production', 'local']);
    expect(Object.keys(generatedByOutcome)).toEqual(['already-active', 'recovered', 'created']);
    for (const [outcome, result] of Object.entries(generatedByOutcome)) expect(result.outcome).toBe(outcome);
  });

  it('keeps the raw key only on the reveal shape', () => {
    expect('hex' in generatedByOutcome.created).toBe(false);
    expect('hex' in startedFresh).toBe(false);
    expect(nonRevealResponsesLackHex).toEqual([true, true, true, true, true]);
    expect(revealCarriesHex).toBe(false);
    expect(revealedActive.hex).toHaveLength(64);
    expect(revealedInactive.hex).toBeUndefined();
    expect(imported.outcome).toBe('unlocked');
    expect(startedFresh.affectedWebhooks).toEqual(preview.affectedWebhooks);
  });
});
