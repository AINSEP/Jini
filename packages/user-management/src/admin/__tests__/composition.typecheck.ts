import { createAdmin } from '@jini-ai/admin/core/module';
import { roles } from '../react/index.js';
import { createMemoryRolesApi } from '../adapters/memory.js';
/** Compile-only public composition contracts. Never runs or imports in a test. */
function compositionContracts() {
    const feature = roles({});
    const rolesApi = createMemoryRolesApi({ workspaceId: 'w' });
    createAdmin({ modules: [feature], ports: { rolesApi } }, { omit: ['roles.roles.policies'] });
    // @ts-expect-error The roles port is required.
    createAdmin({ modules: [feature], ports: {} });
    // @ts-expect-error Unknown port names cannot silently wire another module.
    createAdmin({ modules: [feature], ports: { rolesApi, misspelled: rolesApi } });
    // @ts-expect-error Omitted tab identities are checked against the composed module.
    createAdmin({ modules: [feature], ports: { rolesApi } }, { omit: ['roles.roles.missing'] });
}
void compositionContracts;

import { users, members, auth } from '../react/index.js';
import { createMemoryUsersApi, createMemoryUsersSafety, createMemoryMembersApi, createMemoryAuthApi } from '../adapters/memory.js';
function peopleCompositionContracts() {
  const u = users({}), m = members({}), a = auth({});
  const usersApi = createMemoryUsersApi({ workspaceId: 'w' });
  const usersSafety = createMemoryUsersSafety({ principalIds: [], ownerPrincipalIds: [], seededOwnerPrincipalId: null });
  const membersApi = createMemoryMembersApi({ workspaceId: 'w' });
  const authApi = createMemoryAuthApi({ accounts: [] });
  createAdmin({ modules: [u, m, a], ports: { usersApi, usersSafety, membersApi, authApi } });
  // @ts-expect-error Authoritative safety is required; omitting it cannot weaken owner protection.
  createAdmin({ modules: [u], ports: { usersApi } });
  // @ts-expect-error Authentication and member ports cannot be omitted by a host.
  createAdmin({ modules: [m, a], ports: {} });
}
void peopleCompositionContracts;
