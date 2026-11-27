/** ST-2b.J retirement ledger: bound proofs, CAS transitions, terminal states, corruption, pruning. */
import { describe, expect, it } from 'vitest';
import { createRetirementLedger } from '../index.js';
import type { ErasedRetirementCandidate, RetirementState } from '../index.js';
import { MemoryDurableJson } from './pass-fakes.js';

const PROFILE = '/profile';
const DAY = 86_400_000;

function candidate(overrides: Partial<ErasedRetirementCandidate> = {}): ErasedRetirementCandidate {
  return {
    basis: 'erased', profile: PROFILE, sessionRoot: '/profile/session/Partitions',
    partition: 'site-0123456789abcdef0123456789abcdef', subjectId: 'opaque-1', subjectDir: '/sites/a',
    dirIdentity: { dev: 7, ino: 42, birthtimeMs: 1234 }, parentDir: '/sites', parentDev: 7,
    eraseVersion: '1.2.3', erasedAt: '2026-11-01T00:00:00.000Z', ...overrides,
  };
}

function ledger(store = new MemoryDurableJson()) {
  const clock = { ms: 1_800_000_000_000, now() { return this.ms; } };
  let n = 0;
  return { store, clock, ledger: createRetirementLedger({ profile: PROFILE, durableJson: store, clock, id: () => `r${++n}` }) };
}

describe('retirement ledger', () => {
  it('T-2b.4 record carries profile, sessionRoot, dirIdentity, parentDev', () => {
    const { ledger: l, store } = ledger();
    const record = l.append({ candidate: candidate() }, {});
    expect(record).toMatchObject({
      id: 'r1', state: 'pending', attempts: 0, profile: PROFILE, sessionRoot: '/profile/session/Partitions',
      dirIdentity: { dev: 7, ino: 42, birthtimeMs: 1234 }, parentDir: '/sites', parentDev: 7,
      subjectId: 'opaque-1', subjectDir: '/sites/a', eraseVersion: '1.2.3', erasedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(store.value).toMatchObject({ v: 1, profile: PROFILE, records: [{ id: 'r1', parentDev: 7 }] });
    expect(l.readStrict({}, {})).toEqual({ state: 'ok', records: [record] });
    expect(() => l.append({ candidate: candidate({ profile: '/other' }) }, {})).toThrow(TypeError);
  });

  it('T-2b.5 invalidated record never returns to pending', () => {
    const states: RetirementState[] = ['pending', 'removed', 'invalidated'];
    let seed = 12345;
    const rand = (k: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % k; };
    for (let round = 0; round < 200; round += 1) {
      const { ledger: l } = ledger();
      const { id } = l.append({ candidate: candidate() }, {});
      let terminal: RetirementState | null = null;
      for (let step = 0; step < 8; step += 1) {
        const from = states[rand(3)]!, to = states[rand(3)]!;
        const result = l.transition({ id, from, to, reason: 'busy', asideIdentity: 'site-0123456789abcdef0123456789abcdef.ab' }, {});
        const current = (l.readStrict({}, {}) as { records: Array<{ state: RetirementState }> }).records[0]!.state;
        if (terminal !== null) {
          expect(result.state).not.toBe('ok');
          expect(current).toBe(terminal);
        } else if (current !== 'pending') terminal = current;
      }
    }
    const { ledger: l } = ledger();
    const { id } = l.append({ candidate: candidate() }, {});
    expect(l.invalidate({ partition: candidate().partition, reason: 'reacquired' }, {})).toEqual({ invalidated: 1 });
    expect(l.transition({ id, from: 'invalidated', to: 'pending' }, {})).toEqual({ state: 'illegal', from: 'invalidated', to: 'pending' });
    expect(l.transition({ id, from: 'pending', to: 'removed', asideIdentity: 'x' }, {})).toMatchObject({ state: 'conflict' });
  });

  it('commits removal only for the exact aside identity recorded before the rename', () => {
    const { ledger: l } = ledger();
    const { id } = l.append({ candidate: candidate() }, {});
    expect(l.transition({ id, from: 'pending', to: 'removed', asideIdentity: 'a.1' }, {})).toMatchObject({ state: 'conflict', current: 'aside-mismatch' });
    expect(l.transition({ id, from: 'pending', to: 'pending', reason: 'renaming', asideIdentity: 'a.1' }, {})).toMatchObject({ state: 'ok', record: { attempts: 1 } });
    expect(l.transition({ id, from: 'pending', to: 'removed', asideIdentity: 'a.2' }, {})).toMatchObject({ state: 'conflict' });
    expect(l.transition({ id, from: 'pending', to: 'removed', asideIdentity: 'a.1' }, {})).toMatchObject({ state: 'ok', record: { state: 'removed' } });
    expect(l.transition({ id: 'nope', from: 'pending', to: 'removed' }, {})).toMatchObject({ state: 'conflict', current: 'missing' });
  });

  it('a newer erase of the same partition supersedes the older pending record', () => {
    const { ledger: l } = ledger();
    l.append({ candidate: candidate() }, {});
    l.append({ candidate: candidate({ subjectId: 'opaque-2' }) }, {});
    const read = l.readStrict({}, {});
    expect(read.state === 'ok' && read.records.map(r => [r.id, r.state, r.lastReason])).toEqual([
      ['r1', 'invalidated', 'superseded'], ['r2', 'pending', undefined],
    ]);
  });

  it('a corrupt or foreign ledger grants no removal authority', () => {
    const corrupt = new MemoryDurableJson();
    corrupt.raw = { state: 'unreadable', text: '{"v":1,' };
    const { ledger: l } = ledger(corrupt);
    expect(l.readStrict({}, {})).toMatchObject({ state: 'unknown' });
    expect(l.transition({ id: 'r1', from: 'pending', to: 'removed', asideIdentity: 'x' }, {})).toMatchObject({ state: 'unknown' });
    expect(l.invalidate({ partition: 'p', reason: 'reacquired' }, {})).toEqual({ invalidated: 0 });
    l.append({ candidate: candidate() }, {});
    expect(corrupt.quarantined).toBe(1);
    expect(l.readStrict({}, {})).toMatchObject({ state: 'ok', records: [{ id: 'r1' }] });

    const foreign = new MemoryDurableJson();
    foreign.value = { v: 1, profile: '/elsewhere', records: [] };
    expect(ledger(foreign).ledger.readStrict({}, {})).toMatchObject({ state: 'unknown' });
    const badRecord = new MemoryDurableJson();
    badRecord.value = { v: 1, profile: PROFILE, records: [{ id: 'r1', state: 'pending' }] };
    expect(ledger(badRecord).ledger.readStrict({}, {})).toMatchObject({ state: 'unknown' });
    const stuck = new MemoryDurableJson();
    stuck.raw = { state: 'unreadable' };
    stuck.quarantineResult = false;
    expect(() => ledger(stuck).ledger.append({ candidate: candidate() }, {})).toThrow(/could not be moved aside/);
  });

  it('refuses retirement records with invalid optional metadata, basis, or erased-directory identity', () => {
    const store = new MemoryDurableJson();
    const { ledger: l } = ledger(store);
    const original = l.append({ candidate: candidate() }, {});
    expect(l.readStrict({}, {})).toEqual({ state: 'ok', records: [original] });
    for (const record of [
      { ...original, asideIdentity: 17 },
      { ...original, basis: 'unsupported-basis' },
      { ...original, dirIdentity: { ...candidate().dirIdentity, ino: '42' } },
    ]) {
      store.value = { v: 1, profile: PROFILE, records: [record] };
      expect(l.readStrict({}, {})).toEqual({ state: 'unknown', reason: 'ledger record malformed' });
    }
  });

  it('prunes old terminal records except those whose aside folder is still on disk', () => {
    const { ledger: l, clock } = ledger();
    const a = l.append({ candidate: candidate({ partition: 'site-a' }) }, {});
    const b = l.append({ candidate: candidate({ partition: 'site-b' }) }, {});
    const c = l.append({ candidate: candidate({ partition: 'site-c' }) }, {});
    for (const [rec, aside] of [[a, 'site-a.1'], [b, 'site-b.1']] as const) {
      l.transition({ id: rec.id, from: 'pending', to: 'pending', asideIdentity: aside }, {});
      l.transition({ id: rec.id, from: 'pending', to: 'removed', asideIdentity: aside }, {});
    }
    clock.ms += 89 * DAY;
    expect(l.pruneTerminal({ unresolvedAsideIds: [] }, {})).toEqual({ pruned: 0 });
    clock.ms += 2 * DAY;
    expect(l.pruneTerminal({ unresolvedAsideIds: ['site-b.1'] }, {})).toEqual({ pruned: 1 });
    const read = l.readStrict({}, {});
    expect(read.state === 'ok' && read.records.map(r => r.id)).toEqual([b.id, c.id]);
  });
});
