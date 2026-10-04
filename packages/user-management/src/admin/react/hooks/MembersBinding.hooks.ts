import { createContext, createElement, lazy, useContext } from 'react';
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import type { MembersApiPort } from '../../ports.js';
import { membersModule } from '../../members.module.js';
import type { AdminAccount } from "../../models.js";
import type { MembersRefreshPort } from "../../ports.js";
export interface MembersScope { readonly api: MembersApiPort; readonly permissions: readonly string[]; }
const ScopeContext = createContext<MembersScope | null>(null);
export interface MembersPageProps {
  readonly tabs: Readonly<Record<string, LazyExoticComponent<ComponentType<{ readonly params?: Readonly<Record<string, unknown>> }>>>>;
  readonly description: ReturnType<AdminInstance['describe']>['pages'][number];
  readonly refresh?: MembersRefreshPort;
}
export function useMembersScope(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const scope = useContext(ScopeContext); if (!scope) throw new Error('Members admin scope is unavailable.'); return scope;
}
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
