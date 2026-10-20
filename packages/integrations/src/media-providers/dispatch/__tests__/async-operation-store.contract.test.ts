/**
 * Characterization pins shared by both `AsyncOperationStore` implementations — the in-memory
 * reference and the sqlite adapter (on a `:memory:` database). Every branch of create validation,
 * the update fence/merge, claim and reconcile is pinned against BOTH, so a shared helper extracted
 * from one cannot silently diverge from the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertNoCredentialMaterial,
  assertTransition,
  createInMemoryAsyncOperationStore,
  CREDENTIAL_IN_STATE_MESSAGE,
  hydrateAsyncOperationRecord,
} from '../async-operation-store.js';
import type { AsyncOperationPatch, AsyncOperationStatus, AsyncOperationStore } from '../async-operation-store.js';
import { createSqliteAsyncOperationStore } from '../sqlite-async-operation-store.js';

const BASE = { id: 'op-1', providerId: 'p', routeKey: 'video', ownerRef: 'run-1', maxAttempts: 5, deadlineAt: 10_000 } as const;
const NOW = 1_000;

type Made = { store: AsyncOperationStore; close(): Promise<void> };
const factories: Array<[string, () => Promise<Made>]> = [
  ['in-memory', async () => ({ store: createInMemoryAsyncOperationStore(), close: async () => undefined })],
  ['sqlite', async () => {
    const store = await createSqliteAsyncOperationStore({ dbPath: ':memory:' });
    return { store, close: () => store.close() };
  }],
];

describe.each(factories)('%s store contract pins', (_name, make) => {
  let made: Made;
  let store: AsyncOperationStore;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    made = await make();
    store = made.store;
  });
  afterEach(async () => {
    await made.close();
    vi.useRealTimers();
  });

  describe('create', () => {
    it('defaults status, attempts, nextPollAt, lease, state, result and error', async () => {
      const row = await store.create(BASE);
      expect(row).toEqual({ ...BASE, schemaVersion: 1, status: 'submitted', attempts: 0, nextPollAt: NOW,
        leaseOwner: null, leaseExpiresAt: null, state: null, result: null, error: null, createdAt: NOW, updatedAt: NOW });
    });

    it('honours an explicit status, nextPollAt and state', async () => {
      const row = await store.create(BASE, { status: 'polling', nextPollAt: 50, state: { jobId: 'j1' } });
      expect(row).toMatchObject({ status: 'polling', nextPollAt: 50, state: { jobId: 'j1' } });
    });

    it('stores an explicit null state as null', async () => {
      expect((await store.create(BASE, { state: null })).state).toBeNull();
    });

    it('refuses a duplicate id', async () => {
      await store.create(BASE);
      await expect(store.create(BASE)).rejects.toThrow(new Error('async operation "op-1" already exists'));
    });

    it.each([0, 0.5, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses maxAttempts %s', async (maxAttempts) => {
      await expect(store.create({ ...BASE, maxAttempts }))
        .rejects.toThrow(new RangeError(`Invalid maxAttempts: ${maxAttempts} must be a finite number >= 1`));
    });

    it('accepts a fractional maxAttempts >= 1 (no integer check)', async () => {
      expect((await store.create({ ...BASE, maxAttempts: 1.5 })).maxAttempts).toBe(1.5);
    });

    it.each([Number.NaN, Number.NEGATIVE_INFINITY])('refuses deadlineAt %s', async (deadlineAt) => {
      await expect(store.create({ ...BASE, deadlineAt }))
        .rejects.toThrow(new RangeError(`Invalid deadlineAt: ${deadlineAt} must be a finite epoch-ms timestamp`));
    });

    it('checks the duplicate id before maxAttempts, and maxAttempts before deadlineAt and state', async () => {
      await store.create(BASE);
      await expect(store.create({ ...BASE, maxAttempts: 0 })).rejects.toThrow('already exists');
      await expect(store.create({ ...BASE, id: 'op-2', maxAttempts: 0, deadlineAt: Number.NaN }, { state: { apiKey: 'x' } }))
        .rejects.toThrow('Invalid maxAttempts');
      await expect(store.create({ ...BASE, id: 'op-2', deadlineAt: Number.NaN }, { state: { apiKey: 'x' } }))
        .rejects.toThrow('Invalid deadlineAt');
    });

    it('refuses credential material in the initial state and persists nothing', async () => {
      await expect(store.create(BASE, { state: { apiKey: 'x' } })).rejects.toThrow(CREDENTIAL_IN_STATE_MESSAGE);
      expect(await store.get({ id: 'op-1' })).toBeNull();
    });
  });

  describe('get', () => {
    it('returns null for an unknown id', async () => {
      expect(await store.get({ id: 'missing' })).toBeNull();
    });

    it('returns a copy the caller cannot mutate into the store', async () => {
      await store.create(BASE, { state: { jobId: 'j1' } });
      const first = await store.get({ id: 'op-1' });
      (first!.state as Record<string, unknown>).jobId = 'mutated';
      expect((await store.get({ id: 'op-1' }))?.state).toEqual({ jobId: 'j1' });
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await store.create(BASE, { state: { jobId: 'j1' } });
      await store.update({ id: 'op-1', patch: { result: { bytesBase64: 'QQ==', providerNote: 'n' }, error: { message: 'e', code: 'C' },
        leaseOwner: 'w1', leaseExpiresAt: 900 } });
      vi.setSystemTime(NOW + 5);
    });

    it('returns null for an unknown id', async () => {
      expect(await store.update({ id: 'missing', patch: { attempts: 1 } })).toBeNull();
    });

    it('an empty patch keeps every field and bumps updatedAt', async () => {
      const row = await store.update({ id: 'op-1', patch: {} });
      expect(row).toMatchObject({ status: 'submitted', attempts: 0, nextPollAt: NOW, state: { jobId: 'j1' },
        result: { bytesBase64: 'QQ==', providerNote: 'n' }, error: { message: 'e', code: 'C' }, leaseOwner: 'w1', leaseExpiresAt: 900,
        createdAt: NOW, updatedAt: NOW + 5, schemaVersion: 1 });
    });

    it('applies status, attempts and nextPollAt', async () => {
      expect(await store.update({ id: 'op-1', patch: { status: 'polling', attempts: 3, nextPollAt: 77 } }))
        .toMatchObject({ status: 'polling', attempts: 3, nextPollAt: 77 });
    });

    it('replaces state, result, error and the lease when given values', async () => {
      const row = await store.update({ id: 'op-1', patch: { state: { jobId: 'j2' }, result: { bytesBase64: 'Qg==', providerNote: 'm', suggestedExt: 'mp4' },
        error: { message: 'f', status: 500 }, leaseOwner: 'w2', leaseExpiresAt: 1234 } });
      expect(row).toMatchObject({ state: { jobId: 'j2' }, result: { bytesBase64: 'Qg==', providerNote: 'm', suggestedExt: 'mp4' },
        error: { message: 'f', status: 500 }, leaseOwner: 'w2', leaseExpiresAt: 1234 });
    });

    it('clears state, result, error and the lease when given null', async () => {
      const row = await store.update({ id: 'op-1', patch: { state: null, result: null, error: null, leaseOwner: null, leaseExpiresAt: null } });
      expect(row).toMatchObject({ state: null, result: null, error: null, leaseOwner: null, leaseExpiresAt: null });
    });

    it('clears state, result, error and the lease when the key is present but undefined', async () => {
      // Malformed-input fixture: exactOptionalPropertyTypes forbids present-but-undefined keys, but a
      // JS caller can still send them; the `'key' in patch` merge treats them as a clear.
      const patch = { state: undefined, result: undefined, error: undefined, leaseOwner: undefined, leaseExpiresAt: undefined } as unknown as AsyncOperationPatch;
      const row = await store.update({ id: 'op-1', patch });
      expect(row).toMatchObject({ state: null, result: null, error: null, leaseOwner: null, leaseExpiresAt: null });
    });

    it('refuses credential material in a patched state and leaves the row unchanged', async () => {
      await expect(store.update({ id: 'op-1', patch: { state: { token: 'x' } } })).rejects.toThrow(CREDENTIAL_IN_STATE_MESSAGE);
      expect((await store.get({ id: 'op-1' }))?.state).toEqual({ jobId: 'j1' });
    });

    it('checks credential material before the transition', async () => {
      await store.update({ id: 'op-1', patch: { status: 'failed' } });
      await expect(store.update({ id: 'op-1', patch: { status: 'polling', state: { token: 'x' } } })).rejects.toThrow(CREDENTIAL_IN_STATE_MESSAGE);
    });

    it('refuses an illegal transition out of a terminal status', async () => {
      await store.update({ id: 'op-1', patch: { status: 'succeeded' } });
      await expect(store.update({ id: 'op-1', patch: { status: 'polling' } }))
        .rejects.toThrow(new RangeError('Invalid async operation transition: "succeeded" -> "polling"'));
    });

    it('refuses polling -> submitted', async () => {
      await store.update({ id: 'op-1', patch: { status: 'polling' } });
      await expect(store.update({ id: 'op-1', patch: { status: 'submitted' } }))
        .rejects.toThrow(new RangeError('Invalid async operation transition: "polling" -> "submitted"'));
    });

    it('applies a write fenced by the current lease owner', async () => {
      expect((await store.update({ id: 'op-1', patch: { attempts: 2 } }, { options: { leaseOwner: 'w1' } }))?.attempts).toBe(2);
    });

    it('returns the row unchanged, without validating, when the fence names another owner', async () => {
      const row = await store.update({ id: 'op-1', patch: { attempts: 9, state: { token: 'x' }, status: 'submitted' } }, { options: { leaseOwner: 'w2' } });
      expect(row).toMatchObject({ attempts: 0, state: { jobId: 'j1' }, updatedAt: NOW });
    });

    it('applies unconditionally when options carry no leaseOwner', async () => {
      expect((await store.update({ id: 'op-1', patch: { attempts: 4 } }, { options: {} }))?.attempts).toBe(4);
    });
  });

  describe('listByOwner', () => {
    it('returns only that owner rows, oldest first', async () => {
      vi.setSystemTime(NOW + 10);
      await store.create({ ...BASE, id: 'b' });
      vi.setSystemTime(NOW);
      await store.create({ ...BASE, id: 'a' });
      await store.create({ ...BASE, id: 'c', ownerRef: 'other' });
      expect((await store.listByOwner({ ownerRef: 'run-1' })).map((row) => row.id)).toEqual(['a', 'b']);
    });
  });

  describe('claimDue', () => {
    it('claims due live rows in nextPollAt order up to the default limit of 10', async () => {
      for (let i = 0; i < 12; i++) await store.create({ ...BASE, id: `op-${i}` }, { nextPollAt: 100 - i });
      const claimed = await store.claimDue({ now: 200, leaseOwner: 'w', leaseMs: 30 });
      // Selection follows nextPollAt; the RETURNED order is not part of the contract (sqlite's
      // UPDATE ... RETURNING yields rowid order), so compare as a set.
      expect(claimed.map((row) => row.id).sort()).toEqual(['op-10', 'op-11', 'op-2', 'op-3', 'op-4', 'op-5', 'op-6', 'op-7', 'op-8', 'op-9']);
      expect(claimed.find((row) => row.id === 'op-11')).toMatchObject({ leaseOwner: 'w', leaseExpiresAt: 230, updatedAt: 200 });
    });

    it('honours an explicit limit', async () => {
      await store.create({ ...BASE, id: 'a' }, { nextPollAt: 0 });
      await store.create({ ...BASE, id: 'b' }, { nextPollAt: 1 });
      expect((await store.claimDue({ now: 5, leaseOwner: 'w', leaseMs: 1 }, { limit: 1 })).map((row) => row.id)).toEqual(['a']);
    });

    it('skips terminal, not-yet-due and live-leased rows, but claims a row whose lease expired exactly now', async () => {
      await store.create({ ...BASE, id: 'terminal' }, { nextPollAt: 0, status: 'failed' });
      await store.create({ ...BASE, id: 'future' }, { nextPollAt: 51 });
      await store.create({ ...BASE, id: 'due-now' }, { nextPollAt: 50 });
      await store.create({ ...BASE, id: 'leased' }, { nextPollAt: 0 });
      await store.create({ ...BASE, id: 'expired' }, { nextPollAt: 1 });
      await store.update({ id: 'leased', patch: { leaseOwner: 'x', leaseExpiresAt: 51 } });
      await store.update({ id: 'expired', patch: { leaseOwner: 'x', leaseExpiresAt: 50 } });
      expect((await store.claimDue({ now: 50, leaseOwner: 'w', leaseMs: 1 })).map((row) => row.id).sort()).toEqual(['due-now', 'expired']);
    });
  });

  describe('releaseLease', () => {
    it('is a no-op for an unknown id', async () => {
      await expect(store.releaseLease({ id: 'missing', leaseOwner: 'w' })).resolves.toBeUndefined();
    });

    it('clears the lease for its owner and bumps updatedAt', async () => {
      await store.create(BASE, { nextPollAt: 0 });
      await store.claimDue({ now: 1, leaseOwner: 'w', leaseMs: 100 });
      vi.setSystemTime(NOW + 7);
      await store.releaseLease({ id: 'op-1', leaseOwner: 'w' });
      expect(await store.get({ id: 'op-1' })).toMatchObject({ leaseOwner: null, leaseExpiresAt: null, updatedAt: NOW + 7 });
    });
  });

  describe('reconcileOnBoot', () => {
    it('expires live rows at or past the deadline to unknown, releases dead leases, and skips terminal rows', async () => {
      await store.create({ ...BASE, id: 'deadline-equal', deadlineAt: 100 });
      await store.create({ ...BASE, id: 'deadline-leased', deadlineAt: 50 });
      await store.update({ id: 'deadline-leased', patch: { leaseOwner: 'x', leaseExpiresAt: 999 } });
      await store.create({ ...BASE, id: 'terminal', deadlineAt: 0 }, { status: 'succeeded' });
      await store.create({ ...BASE, id: 'null-expiry' });
      await store.update({ id: 'null-expiry', patch: { leaseOwner: 'x', leaseExpiresAt: null } });
      await store.create({ ...BASE, id: 'expired-lease' });
      await store.update({ id: 'expired-lease', patch: { leaseOwner: 'x', leaseExpiresAt: 100 } });
      await store.create({ ...BASE, id: 'live-lease' });
      await store.update({ id: 'live-lease', patch: { leaseOwner: 'x', leaseExpiresAt: 101 } });
      await store.create({ ...BASE, id: 'orphan-expiry' });
      await store.update({ id: 'orphan-expiry', patch: { leaseExpiresAt: 5 } });

      expect(await store.reconcileOnBoot({ now: 100 })).toEqual({ leasesReleased: 2, deadlineExpired: 2 });
      const byId = async (id: string) => store.get({ id });
      expect(await byId('deadline-equal')).toMatchObject({ status: 'unknown', updatedAt: 100,
        error: { message: 'async operation passed its absolute deadline while unattended — vendor-side effect is undetermined', code: 'DEADLINE_EXPIRED' } });
      expect(await byId('deadline-leased')).toMatchObject({ status: 'unknown', leaseOwner: null, leaseExpiresAt: null });
      expect(await byId('terminal')).toMatchObject({ status: 'succeeded', error: null });
      expect(await byId('null-expiry')).toMatchObject({ status: 'submitted', leaseOwner: null, leaseExpiresAt: null, updatedAt: 100 });
      expect(await byId('expired-lease')).toMatchObject({ leaseOwner: null, leaseExpiresAt: null });
      expect(await byId('live-lease')).toMatchObject({ leaseOwner: 'x', leaseExpiresAt: 101 });
      expect(await byId('orphan-expiry')).toMatchObject({ leaseOwner: null, leaseExpiresAt: 5 });
    });
  });
});

describe('hydrateAsyncOperationRecord pins', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('fills every default for a sparse legacy row and stringifies identity fields', () => {
    expect(hydrateAsyncOperationRecord({ raw: { id: 7, maxAttempts: '3', deadlineAt: '9' } })).toEqual({
      schemaVersion: 1, id: '7', providerId: 'undefined', routeKey: 'undefined', ownerRef: 'undefined', status: 'submitted',
      attempts: 0, maxAttempts: 3, deadlineAt: 9, nextPollAt: NOW, leaseOwner: null, leaseExpiresAt: null, state: null,
      result: null, error: null, createdAt: NOW, updatedAt: NOW,
    });
  });

  it('keeps every supplied value', () => {
    const raw = { schemaVersion: 1, id: 'a', providerId: 'p', routeKey: 'r', ownerRef: 'o', status: 'polling', attempts: 2,
      maxAttempts: 4, deadlineAt: 50, nextPollAt: 10, leaseOwner: 'w', leaseExpiresAt: 20, state: { jobId: 'j' },
      result: { bytesBase64: 'QQ==', providerNote: 'n' }, error: { message: 'e' }, createdAt: 1, updatedAt: 2 };
    expect(hydrateAsyncOperationRecord({ raw })).toEqual(raw);
  });

  it('treats a non-number schemaVersion as v0 and non-number counters/timestamps as absent', () => {
    expect(hydrateAsyncOperationRecord({ raw: { schemaVersion: '9', attempts: '2', nextPollAt: '3', createdAt: null, updatedAt: '4' } }))
      .toMatchObject({ schemaVersion: 1, attempts: 0, nextPollAt: NOW, createdAt: NOW, updatedAt: NOW });
  });

  it('accepts the current version exactly and refuses the next one', () => {
    expect(hydrateAsyncOperationRecord({ raw: { schemaVersion: 1 } }).schemaVersion).toBe(1);
    expect(() => hydrateAsyncOperationRecord({ raw: { schemaVersion: 2 } }))
      .toThrow(new Error('async operation row was written at schema version 2, newer than this build understands (1) — upgrade rather than risk misreading it'));
  });

  it('passes an unrecognised status string through verbatim (reported, not fixed)', () => {
    // Fail-open parse: a corrupt/foreign status is not validated on read. The in-memory store would
    // then treat it as live in claimDue; update() later throws on it via assertTransition.
    expect(hydrateAsyncOperationRecord({ raw: { status: 'bogus' } }).status).toBe('bogus');
  });
});

describe('assertTransition pins', () => {
  it('refuses an unknown from-status with a RangeError', () => {
    // Malformed-input fixture: a status outside the union, as a corrupt row would carry.
    expect(() => assertTransition('bogus' as AsyncOperationStatus, 'polling')).toThrow(new RangeError('Invalid async operation status: "bogus"'));
  });

  it('throws a TypeError, not the RangeError, for an Object.prototype key as from-status (reported, not fixed)', () => {
    // Malformed-input fixture: the transition table is a plain object, so "toString" resolves via the prototype.
    expect(() => assertTransition('toString' as AsyncOperationStatus, 'polling')).toThrow(TypeError);
  });

  it('allows every self-transition', () => {
    for (const status of ['submitted', 'polling', 'succeeded', 'failed', 'unknown'] as const) {
      expect(() => assertTransition(status, status)).not.toThrow();
    }
  });
});

describe('assertNoCredentialMaterial pins', () => {
  it('accepts null, undefined, and allowlisted keys holding primitives', () => {
    expect(() => assertNoCredentialMaterial({ state: null })).not.toThrow();
    expect(() => assertNoCredentialMaterial({ state: undefined })).not.toThrow();
    expect(() => assertNoCredentialMaterial({ state: { jobId: 'j' } })).not.toThrow();
  });

  it('walks arrays and rejects a disallowed key inside one, naming it', () => {
    expect(() => assertNoCredentialMaterial({ state: { jobId: [{ jobId: 'a' }, { password: 'p' }] } }))
      .toThrow(`${CREDENTIAL_IN_STATE_MESSAGE} (key "password" is not in the resumption-handle allowlist — add it there if it is genuinely not credential material)`);
  });

  it('tolerates a cycle and a shared reference', () => {
    const shared: Record<string, unknown> = {};
    const state: Record<string, unknown> = { jobId: [shared, shared] };
    shared.jobId = state;
    expect(() => assertNoCredentialMaterial({ state })).not.toThrow();
  });

  it('lets a Map nested under an allowlisted key carry any keys (reported, not fixed)', () => {
    // Fail-open: Object.entries(Map) is empty, so the allowlist never sees the Map's keys, and the
    // in-memory store's structuredClone keeps them. The value here is a non-secret placeholder.
    const state = { jobId: new Map([['apiKey', 'placeholder']]) };
    expect(() => assertNoCredentialMaterial({ state })).not.toThrow();
  });
});
