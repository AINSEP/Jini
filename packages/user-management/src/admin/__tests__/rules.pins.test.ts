/** Branch pins for the framework-free Roles rules (`../rules.ts`). */
import { describe, expect, it } from 'vitest';
import { canManageRoles, describeRolesError, destructiveCopy, mutablePolicy, mutableRole } from '../rules.js';
import { rolesMessagesEn as m } from '../messages.en.js';
import { RolesApiError } from '../ports.js';
import type { PolicyPermissionRecord, PolicyRecord, RoleRecord } from '../models.js';

const role: RoleRecord = { id: 'r', workspaceId: 'w', name: 'Writer', isBuiltin: false };
const policy: PolicyRecord = { id: 'p', workspaceId: 'w', name: 'Read', isBuiltin: false, isFrozen: false };
const row: PolicyPermissionRecord = { id: 'pp', workspaceId: 'w', policyId: 'p', permission: 'content.read', resourceType: null, constraintJson: null };

describe('canManageRoles (pin)', () => {
  it('allows only role.manage or the owner wildcard, as exact entries', () => {
    expect(canManageRoles({ permissions: ['role.manage'] })).toBe(true);
    expect(canManageRoles({ permissions: ['*'] })).toBe(true);
    expect(canManageRoles({ permissions: ['user.manage', 'role.manage.extra', 'role', 'Role.Manage'] })).toBe(false);
    expect(canManageRoles({ permissions: [] })).toBe(false);
  });
});

describe('mutableRole / mutablePolicy (pin)', () => {
  it('refuses built-in roles and built-in or frozen policies', () => {
    expect(mutableRole({ role })).toBe(true);
    expect(mutableRole({ role: { ...role, isBuiltin: true } })).toBe(false);
    expect(mutablePolicy({ policy })).toBe(true);
    expect(mutablePolicy({ policy: { ...policy, isBuiltin: true } })).toBe(false);
    expect(mutablePolicy({ policy: { ...policy, isFrozen: true } })).toBe(false);
  });
});

describe('describeRolesError (pin)', () => {
  const describeIt = (error: unknown) => describeRolesError({ error, fallback: 'fallback copy' });

  it('maps each known code to its feature copy, ignoring the server message', () => {
    expect(describeIt(new RolesApiError({ code: 'FORBIDDEN', message: 'x' }))).toBe(m.forbidden);
    expect(describeIt(new RolesApiError({ code: 'RESOURCE_CONFLICT', message: 'x' }))).toBe(m.conflict);
    expect(describeIt(new RolesApiError({ code: 'PERMISSION_UNKNOWN', message: 'x' }))).toBe(m.unknownPermission);
    expect(describeIt({ code: 'GRANT_EXCEEDS_ISSUER' })).toBe(m.exceedsIssuer);
  });

  it('shows a validation error message when present, else generic validation copy', () => {
    expect(describeIt(new RolesApiError({ code: 'VALIDATION_ERROR', message: 'Name is required.' }))).toBe('Name is required.');
    expect(describeIt(new RolesApiError({ code: 'VALIDATION_ERROR', message: '' }))).toBe(m.validation);
    expect(describeIt({ code: 'VALIDATION_ERROR', message: 'plain objects are not Errors' })).toBe(m.validation);
  });

  it('falls back to the Error message for unknown codes, then to the fallback', () => {
    expect(describeIt(new RolesApiError({ code: 'RESOURCE_NOT_FOUND', message: 'Role not found.' }))).toBe('Role not found.');
    expect(describeIt({ code: 'RESOURCE_NOT_FOUND' })).toBe('fallback copy');
    expect(describeIt({ code: '' })).toBe('fallback copy');
    expect(describeIt(new Error(''))).toBe('fallback copy');
  });

  it('ignores a non-string code and non-object errors', () => {
    expect(describeIt({ code: 403 })).toBe('fallback copy');
    expect(describeIt(Object.assign(new Error('numeric code'), { code: 7 }))).toBe('numeric code');
    for (const error of [null, undefined, 0, '', 'FORBIDDEN', false]) expect(describeIt(error)).toBe('fallback copy');
    expect(describeIt({})).toBe('fallback copy');
  });

  it('resolves an Object.prototype key code to the inherited member instead of copy (reported, not fixed)', () => {
    // describePeopleError guards with Object.hasOwn; describeRolesError does not, so a server code
    // such as "constructor" yields a non-string (the Object function) where UI copy is expected.
    expect(describeIt({ code: 'constructor' })).toBe(Object);
    expect(describeIt(new RolesApiError({ code: 'toString', message: 'x' }))).toBe(Object.prototype.toString);
  });
});

describe('destructiveCopy (pin)', () => {
  it('describes permission removal with and without a resource type', () => {
    expect(destructiveCopy({ target: { kind: 'permission', policyId: 'p', row } })).toEqual({ title: 'Remove permission?', label: 'Remove', tone: 'warning',
      body: 'Remove "content.read" from this policy? This changes live access immediately.', consequence: 'changes live access immediately' });
    expect(destructiveCopy({ target: { kind: 'permission', policyId: 'p', row: { ...row, resourceType: 'page' } } }).body)
      .toBe('Remove "content.read" (page) from this policy? This changes live access immediately.');
  });

  it('describes policy and role deletion, and an empty role body when nothing is pending', () => {
    expect(destructiveCopy({ target: { kind: 'policy', policy } })).toEqual({ title: 'Delete policy?', label: 'Delete', tone: 'danger',
      body: 'Delete "Read"? Policies still attached to users or roles cannot be deleted.', consequence: 'cannot be undone' });
    expect(destructiveCopy({ target: { kind: 'role', role } })).toEqual({ title: 'Delete role?', label: 'Delete', tone: 'danger',
      body: 'Delete "Writer"? Roles still assigned to users cannot be deleted.', consequence: 'cannot be undone' });
    expect(destructiveCopy({ target: null })).toEqual({ title: 'Delete role?', label: 'Delete', tone: 'danger', body: '', consequence: 'cannot be undone' });
  });
});
