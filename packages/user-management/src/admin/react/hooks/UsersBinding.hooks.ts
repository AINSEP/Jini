import { createContext, createElement, lazy, useContext } from 'react';
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import type { UsersApiPort, UsersSafetyPort } from '../../ports.js';
import { usersModule } from '../../users.module.js';
import type { AdminAccount } from "../../models.js";
import type { MembersRefreshPort } from "../../ports.js";
export interface UsersScope { readonly api: UsersApiPort; readonly permissions: readonly string[]; readonly safety: UsersSafetyPort; }
const ScopeContext = createContext<UsersScope | null>(null);
export interface UsersPageProps {
  readonly tabs: Readonly<Record<string, LazyExoticComponent<ComponentType<{ readonly params?: Readonly<Record<string, unknown>> }>>>>;
  readonly description: ReturnType<AdminInstance['describe']>['pages'][number];
  readonly openOwnPasswordReset?: boolean;
  readonly onOwnPasswordResetClosed?: (required: Record<string, never>, optional?: Record<string, never>) => void;
}
export function useUsersScope(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const scope = useContext(ScopeContext); if (!scope) throw new Error('Users admin scope is unavailable.'); return scope;
}
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
