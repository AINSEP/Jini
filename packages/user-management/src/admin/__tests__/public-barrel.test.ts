import { expect, it } from 'vitest';
import * as admin from '../index.js';
import { RolesApiError } from '../ports.js';
import { createRolesController } from '../controllers/roles.controller.js';

// `@jini-ai/user-management/admin` is a published entry; hosts compose from exactly these runtime
// names, so dropping or renaming one is a breaking change this pins.
it('exposes the admin modules, controllers, rules, messages and error types at runtime', () => {
  expect(Object.keys(admin).sort()).toEqual([
    'PeopleApiError', 'RolesApiError', 'authApiToken', 'authMessagesEn', 'authModule', 'canManageRoles',
    'createAuthController', 'createMembersController', 'createRolesController', 'createUsersController',
    'describePeopleError', 'describeRolesError', 'destructiveCopy', 'grantLabel', 'hasAdminGrant',
    'membersApiToken', 'membersMessagesEn', 'membersModule', 'mutablePolicy', 'mutableRole', 'rolesApiToken',
    'rolesMessagesEn', 'rolesModule', 'userActionAllowed', 'usersApiToken', 'usersMessagesEn', 'usersModule', 'usersSafetyToken',
  ].sort());
  expect(admin.RolesApiError).toBe(RolesApiError);
  expect(admin.createRolesController).toBe(createRolesController);
});
