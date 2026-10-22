import { adminPort, defineAdminModule } from '@jini-ai/admin/core/module';
import type { MembersApiPort } from './ports.js';
import { membersMessagesEn } from './messages.en.js';
export const membersApiToken = adminPort<MembersApiPort, 'jini.identity.membersApi'>({ id: 'jini.identity.membersApi' });
/** Reads remain server-authorized; grants gate mutation affordances, denied by default.
 * Login is mounted by the signed-out host, before the authenticated shell. */
export const membersModule = defineAdminModule({
  id: 'members', requires: { membersApi: membersApiToken }, provides: {}, messages: membersMessagesEn,
  pages: { members: { path: '/members', label: 'Members', permissions: [],
    nav: { group: 'people', icon: 'users' },
    tabs: { members: { label: 'Members' } },
  } },
});
