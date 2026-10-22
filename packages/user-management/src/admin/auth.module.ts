import { adminPort, defineAdminModule } from '@jini-ai/admin/core/module';
import type { AuthApiPort } from './ports.js';
import { authMessagesEn } from './messages.en.js';
export const authApiToken = adminPort<AuthApiPort, 'jini.identity.authApi'>({ id: 'jini.identity.authApi' });
/** Reads remain server-authorized; grants gate mutation affordances, denied by default.
 * Login is mounted by the signed-out host, before the authenticated shell. */
export const authModule = defineAdminModule({
  id: 'auth', requires: { authApi: authApiToken }, provides: {}, messages: authMessagesEn,
  pages: { auth: { path: '/login', label: 'Login', permissions: [],
    
    tabs: { auth: { label: 'Login' } },
  } },
});
