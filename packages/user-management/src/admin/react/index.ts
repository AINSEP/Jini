import { needs } from '@jini-ai/ui-kit';
import { rolesModule } from '../roles.module.js';
import { createRolesBinding } from './hooks/RolesBinding.hooks.js';
export const rolesKitNeeds = needs({ id: 'identity.roles', components: ['Button', 'TextField', 'Menu', 'Tabs', 'Notice', 'Spinner', 'Badge', 'ConfirmDialog'] });
/** Optional composition surface. Identity services remain owned by user-management. */
export function roles(_required: Record<string, never>, _optional: Record<string, never> = {}) {
    const module = { ...rolesModule };
    // createAdmin scopes by descriptor identity; bind the exact enriched object being composed.
    return Object.assign(module, { react: createRolesBinding({ module }), kitNeeds: rolesKitNeeds });
}
export type { RolesPageProps, RolesTabProps } from './hooks/RolesBinding.hooks.js';

import { usersModule } from '../users.module.js';
import { membersModule } from '../members.module.js';
import { authModule } from '../auth.module.js';
import { createUsersBinding } from './hooks/UsersBinding.hooks.js';
import { createMembersBinding } from './hooks/MembersBinding.hooks.js';
import { createAuthBinding } from './hooks/AuthBinding.hooks.js';
export const usersKitNeeds = needs({ id: 'identity.users', components: ['Button', 'TextField', 'Select', 'Menu', 'Notice', 'Spinner', 'Badge', 'ConfirmDialog'] });
export const membersKitNeeds = needs({ id: 'identity.members', components: ['Button', 'Menu', 'Notice', 'Spinner', 'Badge', 'ConfirmDialog'] });
export const authKitNeeds = needs({ id: 'identity.auth', components: ['Button', 'TextField', 'Notice', 'Spinner'] });
export function users(_required: Record<string, never>, _optional: Record<string, never> = {}) {
  const module = { ...usersModule }; return Object.assign(module, { react: createUsersBinding({ module }), kitNeeds: usersKitNeeds });
}
export function members(_required: Record<string, never>, _optional: Record<string, never> = {}) {
  const module = { ...membersModule }; return Object.assign(module, { react: createMembersBinding({ module }), kitNeeds: membersKitNeeds });
}
export function auth(_required: Record<string, never>, _optional: Record<string, never> = {}) {
  const module = { ...authModule }; return Object.assign(module, { react: createAuthBinding({ module }), kitNeeds: authKitNeeds });
}
export type { UsersPageProps } from './hooks/UsersBinding.hooks.js';
export type { MembersPageProps } from './hooks/MembersBinding.hooks.js';
export type { AuthPageProps } from './hooks/AuthBinding.hooks.js';
