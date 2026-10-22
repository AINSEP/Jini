import { adminPort, defineAdminModule } from '@jini-ai/admin/core/module';
import type { RolesApiPort } from './ports.js';
import { rolesMessagesEn } from './messages.en.js';
export const rolesApiToken = adminPort<RolesApiPort, 'jini.identity.rolesApi'>({ id: 'jini.identity.rolesApi' });
/** Roles and policies show no cross-reference columns, so separating them loses no context.
 * Policy permission editors can grow without pushing the roles list down the page.
 * Counts add density without information: each list is one click away and fully visible.
 * No new read grant is invented; the authenticated server owns read authorization. */
export const rolesModule = defineAdminModule({
    id: 'roles', requires: { rolesApi: rolesApiToken }, provides: {}, messages: rolesMessagesEn,
    pages: { roles: {
            path: '/roles', label: rolesMessagesEn.title, permissions: [], nav: { group: 'people', icon: 'users' },
            tabs: { roles: { label: rolesMessagesEn.roles }, policies: { label: rolesMessagesEn.policies } },
        } },
});
