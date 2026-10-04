import { adminPort, defineAdminModule } from '@jini-ai/admin/core/module';
import type { UsersApiPort, UsersSafetyPort } from './ports.js';
import { usersMessagesEn } from './messages.en.js';
export const usersApiToken = adminPort<UsersApiPort, 'jini.identity.usersApi'>({ id: 'jini.identity.usersApi' });
export const usersSafetyToken = adminPort<UsersSafetyPort, 'jini.identity.usersSafety'>({ id: 'jini.identity.usersSafety' });
/** Reads remain server-authorized; grants gate mutation affordances, denied by default.
 * Login is mounted by the signed-out host, before the authenticated shell. */
export const usersModule = defineAdminModule({
  id: 'users', requires: { usersApi: usersApiToken, usersSafety: usersSafetyToken }, provides: {}, messages: usersMessagesEn,
  pages: { users: { path: '/users', label: 'Users', permissions: [],
    nav: { group: 'people', icon: 'users' },
    tabs: { users: { label: 'Users' } },
  } },
});
