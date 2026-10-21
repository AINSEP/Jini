import { ScopeContext, type UsersScope } from './UsersScope.hooks.js';
export { useUsersScope } from './UsersScope.hooks.js';
export type { UsersScope, UsersPageProps } from './UsersScope.hooks.js';
import { createElement, lazy } from 'react';
import type { ReactNode } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import { usersModule } from '../../users.module.js';
/** Descriptor identity must be the exact enriched object supplied to createAdmin. */
export function createUsersBinding({ module }: { module: typeof usersModule }, _optional: Record<string, never> = {}) {
  const pages = { users: { Page: lazy(() => import('../pages/UsersPage.js')), tabs: { users: lazy(() => import('../tabs/UsersTab.js')) } } };
  function Provider({ admin, children }: { admin: AdminInstance; children: ReactNode }, _optional: Record<string, never> = {}) {
    const ports = admin.scope({ module });
    const description = admin.describe().pages.find(p => p.id === 'users.users');
    const value: UsersScope = { api: ports.usersApi, permissions: description?.grants ?? [], safety: ports.usersSafety };
    return createElement(ScopeContext.Provider, { value }, children);
  }
  return { pages, Provider };
}
