/**
 * Direct decision-table tests for the portable People rules. The controllers and memory adapter
 * consume these, but no test pinned each guard on its own: dropping any one clause of
 * `userActionAllowed` would surface a destructive action button over the wrong operator.
 */
import { describe, expect, it } from 'vitest';
import { describePeopleError, grantLabel, hasAdminGrant, userActionAllowed } from '../people.rules.js';
import type { AdminOperator, CallerInfo, UserAction } from '../models.js';
import type { UsersSafetyPort } from '../ports.js';

const SEEDED = 'p-seeded';
const ME = 'p-me';

function operator(overrides: Partial<AdminOperator> = {}): AdminOperator {
  return { principalId: 'p-target', workspaceId: 'w-1', username: 'target', status: 'active', createdAt: '2026-01-01T00:00:00Z', roleIds: [], policyIds: [], ...overrides } as AdminOperator;
}
function caller(overrides: Partial<CallerInfo> = {}): CallerInfo {
  return { user: { id: ME, username: 'me' }, ...overrides };
}
function safety({ seeded = SEEDED, status = {} }: { seeded?: string | null; status?: Record<string, 'owner' | 'operator' | 'unknown'> } = {}): UsersSafetyPort {
  return {
    seededOwnerPrincipalId: seeded,
    ownerStatus: ({ principalId }) => status[principalId] ?? 'operator',
  };
}
function allowed(action: UserAction, { user = operator(), permissions = ['user.manage'], who = caller(), port = safety() }: {
  user?: AdminOperator; permissions?: readonly string[]; who?: CallerInfo | null; port?: UsersSafetyPort;
} = {}): boolean {
  return userActionAllowed({ user, action, permissions, caller: who, safety: port });
}

describe('hasAdminGrant', () => {
  it('grants on the owner wildcard or an exact permission, never on a prefix or neighbour', () => {
    expect(hasAdminGrant({ permissions: ['*'], permission: 'user.manage' })).toBe(true);
    expect(hasAdminGrant({ permissions: ['role.manage', 'user.manage'], permission: 'user.manage' })).toBe(true);
    expect(hasAdminGrant({ permissions: ['user'], permission: 'user.manage' })).toBe(false);
    expect(hasAdminGrant({ permissions: ['user.manage.extra'], permission: 'user.manage' })).toBe(false);
    expect(hasAdminGrant({ permissions: [], permission: 'user.manage' })).toBe(false);
  });
});

describe('userActionAllowed: preconditions shared by every action', () => {
  it('denies every action when no caller is known', () => {
    for (const action of ['email', 'grants', 'disable', 'enable', 'reset', 'delete'] as const) {
      expect(allowed(action, { who: null, permissions: ['*'] })).toBe(false);
    }
  });

  it('denies when the ownership lookup throws, instead of propagating or allowing', () => {
    const port: UsersSafetyPort = { seededOwnerPrincipalId: SEEDED, ownerStatus: () => { throw new Error('store offline'); } };
    expect(allowed('email', { permissions: ['*'], port })).toBe(false);
  });

  it('never turns unknown ownership into permission, even for the wildcard', () => {
    expect(allowed('email', { permissions: ['*'], port: safety({ status: { 'p-target': 'unknown' } }) })).toBe(false);
  });

  it('allows actions over an owner only to a wildcard holder', () => {
    const port = safety({ status: { 'p-target': 'owner' } });
    expect(allowed('email', { permissions: ['user.manage'], port })).toBe(false);
    expect(allowed('email', { permissions: ['*'], port })).toBe(true);
  });
});

describe('userActionAllowed: delete', () => {
  const trash = caller({ canManageUserTrash: true });
  it('allows user.manage + server trash authority over another, non-seeded operator', () => {
    expect(allowed('delete', { who: trash })).toBe(true);
    expect(allowed('delete', { who: trash, permissions: ['*'] })).toBe(true);
  });
  it('requires each clause on its own', () => {
    expect(allowed('delete', { who: trash, permissions: ['member.manage'] })).toBe(false);
    expect(allowed('delete', { who: caller() })).toBe(false);
    expect(allowed('delete', { who: caller({ canManageUserTrash: false }) })).toBe(false);
    expect(allowed('delete', { who: trash, user: operator({ principalId: ME }) })).toBe(false);
    expect(allowed('delete', { who: trash, port: safety({ seeded: null }) })).toBe(false);
    expect(allowed('delete', { who: trash, permissions: ['*'], user: operator({ principalId: SEEDED }) })).toBe(false);
  });
});

describe('userActionAllowed: disable / enable', () => {
  it('disables only an active, non-seeded operator, with user.manage', () => {
    expect(allowed('disable')).toBe(true);
    expect(allowed('disable', { permissions: ['member.manage'] })).toBe(false);
    expect(allowed('disable', { user: operator({ status: 'disabled' }) })).toBe(false);
    expect(allowed('disable', { port: safety({ seeded: null }) })).toBe(false);
    expect(allowed('disable', { permissions: ['*'], user: operator({ principalId: SEEDED }) })).toBe(false);
  });
  it('enables only a disabled operator, with user.manage', () => {
    expect(allowed('enable', { user: operator({ status: 'disabled' }) })).toBe(true);
    expect(allowed('enable')).toBe(false);
    expect(allowed('enable', { user: operator({ status: 'disabled' }), permissions: ['role.manage'] })).toBe(false);
  });
});

describe('userActionAllowed: reset', () => {
  it('requires a seeded owner to exist at all', () => {
    expect(allowed('reset', { port: safety({ seeded: null }) })).toBe(false);
  });
  it('lets only the seeded owner reset the seeded owner (self), never another operator', () => {
    expect(allowed('reset', { permissions: ['*'], user: operator({ principalId: SEEDED }) })).toBe(false);
    expect(allowed('reset', { permissions: ['*'], user: operator({ principalId: SEEDED }), who: { user: { id: SEEDED, username: 'seed' } } })).toBe(true);
  });
  it('falls through to user.manage for an ordinary operator', () => {
    expect(allowed('reset')).toBe(true);
    expect(allowed('reset', { permissions: ['member.manage'] })).toBe(false);
  });
});

describe('userActionAllowed: grants and email', () => {
  it('gates grants on role.manage alone (user.manage is not enough)', () => {
    expect(allowed('grants', { permissions: ['role.manage'] })).toBe(true);
    expect(allowed('grants', { permissions: ['user.manage'] })).toBe(false);
  });
  it('lets member.manage edit only the caller\'s own email; user.manage edits anyone\'s', () => {
    expect(allowed('email', { permissions: ['member.manage'], user: operator({ principalId: ME }) })).toBe(true);
    expect(allowed('email', { permissions: ['member.manage'] })).toBe(false);
    expect(allowed('email', { permissions: [], user: operator({ principalId: ME }) })).toBe(false);
    expect(allowed('email', { permissions: ['user.manage'] })).toBe(true);
  });
});

describe('describePeopleError', () => {
  it('maps every known server code to its fixed copy', () => {
    const expected: Record<string, string> = {
      FORBIDDEN: 'You do not have permission to do that.',
      GRANT_EXCEEDS_ISSUER: 'You cannot grant a permission you do not hold.',
      RESOURCE_CONFLICT: 'That username is already in use.',
      OWNER_REQUIRED: 'The workspace must keep at least one active owner.',
      SELF_DELETE: 'You cannot delete your own account.',
      USER_IN_TRASH: 'This user is in the Trash; restore them first.',
      USERNAME_IN_TRASH: 'A user with this username is in the Trash; restore or delete them permanently first.',
    };
    for (const [code, copy] of Object.entries(expected)) {
      expect(describePeopleError({ error: Object.assign(new Error('raw server text'), { code }), fallback: 'fb' })).toBe(copy);
      expect(describePeopleError({ error: { code }, fallback: 'fb' })).toBe(copy);
    }
  });

  it('uses the Error message for an unknown code, and the fallback when there is no usable message', () => {
    expect(describePeopleError({ error: Object.assign(new Error('Disk full'), { code: 'E_DISK' }), fallback: 'fb' })).toBe('Disk full');
    expect(describePeopleError({ error: new Error(''), fallback: 'fb' })).toBe('fb');
    expect(describePeopleError({ error: { code: 42 }, fallback: 'fb' })).toBe('fb');
    expect(describePeopleError({ error: 'FORBIDDEN', fallback: 'fb' })).toBe('fb');
    expect(describePeopleError({ error: null, fallback: 'fb' })).toBe('fb');
  });

  it('never returns an inherited Object.prototype member for a code like "constructor"', () => {
    for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(describePeopleError({ error: { code }, fallback: 'fb' })).toBe('fb');
      expect(describePeopleError({ error: Object.assign(new Error('server said no'), { code }), fallback: 'fb' })).toBe('server said no');
    }
  });
});

describe('grantLabel', () => {
  it('joins resolved names in id order and keeps unknown ids visible', () => {
    const records = [{ id: 'r1', name: 'Editor' }, { id: 'r2', name: 'Admin' }];
    expect(grantLabel({ ids: ['r2', 'gone', 'r1'], records })).toBe('Admin, gone, Editor');
  });
  it('reads "none" for an empty grant list', () => {
    expect(grantLabel({ ids: [], records: [{ id: 'r1', name: 'Editor' }] })).toBe('none');
  });
});
