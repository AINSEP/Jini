import { ScopeContext, type MembersScope } from './MembersScope.hooks.js';
export { useMembersScope } from './MembersScope.hooks.js';
export type { MembersScope, MembersPageProps } from './MembersScope.hooks.js';
import { createElement, lazy } from 'react';
import type { ReactNode } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import { membersModule } from '../../members.module.js';
/** Descriptor identity must be the exact enriched object supplied to createAdmin. */
export function createMembersBinding({ module }: { module: typeof membersModule }, _optional: Record<string, never> = {}) {
  const pages = { members: { Page: lazy(() => import('../pages/MembersPage.js')), tabs: { members: lazy(() => import('../tabs/MembersTab.js')) } } };
  function Provider({ admin, children }: { admin: AdminInstance; children: ReactNode }, _optional: Record<string, never> = {}) {
    const ports = admin.scope({ module });
    const description = admin.describe().pages.find(p => p.id === 'members.members');
    const value: MembersScope = { api: ports.membersApi, permissions: description?.grants ?? [] };
    return createElement(ScopeContext.Provider, { value }, children);
  }
  return { pages, Provider };
}
