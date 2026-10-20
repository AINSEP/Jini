/**
 * Exhaustive truth-table pin for `userActionAllowed`. The decision decides which destructive
 * buttons a portable admin UI reveals and which mutations the memory fake accepts, so every
 * combination of the inputs it reads is enumerated and compared against an independent,
 * clause-by-clause restatement of the documented rules below.
 */
import { describe, expect, it } from 'vitest';
import { userActionAllowed } from '../people.rules.js';
import type { AdminOperator, CallerInfo, UserAction } from '../models.js';
import type { UsersSafetyPort } from '../ports.js';

const ME = 'p-me', OTHER = 'p-other', SEEDED = 'p-seeded';
const ACTIONS: readonly UserAction[] = ['email', 'grants', 'disable', 'enable', 'reset', 'delete'];
const GRANTS = ['*', 'user.manage', 'role.manage', 'member.manage'] as const;
type Ownership = 'owner' | 'operator' | 'unknown' | 'throws';

interface Case {
  action: UserAction; permissions: readonly string[]; caller: CallerInfo | null; ownership: Ownership;
  target: string; status: AdminOperator['status']; seeded: string | null;
}

function subsets(items: readonly string[]): string[][] {
  return items.reduce<string[][]>((all, item) => [...all, ...all.map(s => [...s, item])], [[]]);
}

const CALLERS: readonly (CallerInfo | null)[] = [null,
  { user: { id: ME, username: 'me' } },
  { user: { id: ME, username: 'me' }, canManageUserTrash: false },
  { user: { id: ME, username: 'me' }, canManageUserTrash: true }];
const OWNERSHIPS: readonly Ownership[] = ['owner', 'operator', 'unknown', 'throws'];
const STATUSES: readonly AdminOperator['status'][] = ['active', 'disabled'];

function cases(): Case[] {
  return ACTIONS.flatMap(action => subsets(GRANTS).flatMap(permissions => CALLERS.flatMap(caller => OWNERSHIPS.flatMap(ownership =>
    [ME, OTHER, SEEDED].flatMap(target => STATUSES.flatMap(status => [SEEDED, ME, null].map(seeded =>
      ({ action, permissions, caller, ownership, target, status, seeded }))))))));
}

/** The gates shared by every action: a known caller, known ownership, and the wildcard over owners. */
function gatesPass(c: Case): c is Case & { caller: CallerInfo } {
  if (c.caller === null) return false;
  if (c.ownership === 'owner') return c.permissions.includes('*');
  return c.ownership === 'operator';
}

interface Facts { has: (p: string) => boolean; self: boolean; seededKnown: boolean; targetIsSeeded: boolean; trash: boolean; status: AdminOperator['status'] }
/** Independent statement of the per-action rules (see the doc comment on `userActionAllowed`). */
const EXPECTED: Record<UserAction, (f: Facts) => boolean> = {
  delete: f => f.has('user.manage') && f.trash && !f.self && f.seededKnown && !f.targetIsSeeded,
  disable: f => f.status === 'active' && f.seededKnown && !f.targetIsSeeded && f.has('user.manage'),
  enable: f => f.status === 'disabled' && f.has('user.manage'),
  reset: f => f.seededKnown && (!f.targetIsSeeded || f.self) && f.has('user.manage'),
  grants: f => f.has('role.manage'),
  email: f => (f.self && f.has('member.manage')) || f.has('user.manage'),
};

function expected(c: Case): boolean {
  if (!gatesPass(c)) return false;
  return EXPECTED[c.action]({
    has: p => c.permissions.includes('*') || c.permissions.includes(p),
    self: c.caller.user.id === c.target, seededKnown: c.seeded !== null, targetIsSeeded: c.seeded !== null && c.target === c.seeded,
    trash: c.caller.canManageUserTrash === true, status: c.status,
  });
}

function run(c: Case, calls: { count: number } = { count: 0 }): boolean {
  const user: AdminOperator = { principalId: c.target, workspaceId: 'w', username: 'u', status: c.status, createdAt: '2026-01-01', roleIds: [], policyIds: [] };
  const safety: UsersSafetyPort = {
    seededOwnerPrincipalId: c.seeded,
    ownerStatus: ({ principalId }) => {
      calls.count++;
      expect(principalId).toBe(c.target);
      if (c.ownership === 'throws') throw new Error('ownership store offline');
      return c.ownership;
    },
  };
  return userActionAllowed({ user, action: c.action, permissions: c.permissions, caller: c.caller, safety });
}

describe('userActionAllowed truth table (pin)', () => {
  it('matches the documented rules for every enumerated combination', () => {
    const all = cases();
    expect(all).toHaveLength(6 * 16 * 4 * 4 * 3 * 2 * 3);
    const mismatches = all.filter(c => run(c) !== expected(c));
    expect(mismatches).toEqual([]);
  });

  it('allows a meaningful share of combinations, so the table is not trivially all-deny', () => {
    const allowedCount = cases().filter(c => run(c)).length;
    expect(allowedCount).toBe(cases().filter(expected).length);
    expect(allowedCount).toBeGreaterThan(1000);
  });

  it('consults ownership exactly once when a caller exists and never without one', () => {
    for (const c of cases()) {
      const calls = { count: 0 };
      run(c, calls);
      expect(calls.count).toBe(c.caller === null ? 0 : 1);
    }
  });

  it('returns a real boolean for every combination', () => {
    for (const c of cases()) expect(typeof run(c)).toBe('boolean');
  });

  it('treats an action outside the UserAction union as needing user.manage', () => {
    // Malformed input: a runtime string outside the typed union, including an Object.prototype key.
    const base: Case = { action: 'email', permissions: ['user.manage'], caller: { user: { id: ME, username: 'me' } }, ownership: 'operator', target: OTHER, status: 'active', seeded: SEEDED };
    for (const action of ['rename', 'constructor', 'toString', '__proto__'] as unknown as UserAction[]) {
      expect(run({ ...base, action })).toBe(true);
      expect(run({ ...base, action, permissions: ['member.manage', 'role.manage'] })).toBe(false);
    }
  });

  it('propagates a caller with no user object as a TypeError once ownership allows it', () => {
    // Malformed input: CallerInfo without `user`, which the type forbids.
    const broken = {} as unknown as CallerInfo;
    const c: Case = { action: 'email', permissions: ['*'], caller: broken, ownership: 'operator', target: OTHER, status: 'active', seeded: SEEDED };
    expect(() => run(c)).toThrow(new TypeError("Cannot read properties of undefined (reading 'id')"));
    expect(run({ ...c, ownership: 'unknown' })).toBe(false);
  });
});
