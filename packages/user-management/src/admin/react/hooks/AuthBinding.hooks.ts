import { createContext, createElement, lazy, useContext } from 'react';
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import type { AuthApiPort } from '../../ports.js';
import { authModule } from '../../auth.module.js';
import type { AdminAccount } from "../../models.js";
import type { MembersRefreshPort } from "../../ports.js";
export interface AuthScope { readonly api: AuthApiPort; readonly permissions: readonly string[]; }
const ScopeContext = createContext<AuthScope | null>(null);
export interface AuthPageProps {
  readonly tabs: Readonly<Record<string, LazyExoticComponent<ComponentType<{ readonly params?: Readonly<Record<string, unknown>> }>>>>;
  readonly description: ReturnType<AdminInstance['describe']>['pages'][number];
  readonly title?: string;
  readonly initialUsername?: string;
  readonly onLogin: (required: { user: AdminAccount }, optional?: Record<string, never>) => void;
}
export function useAuthScope(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const scope = useContext(ScopeContext); if (!scope) throw new Error('Auth admin scope is unavailable.'); return scope;
}
/** Descriptor identity must be the exact enriched object supplied to createAdmin. */
export function createAuthBinding({ module }: { module: typeof authModule }, _optional: Record<string, never> = {}) {
  const pages = { auth: { Page: lazy(() => import('../pages/LoginPage.js')), tabs: { auth: lazy(() => import('../tabs/AuthTab.js')) } } };
  function Provider({ admin, children }: { admin: AdminInstance; children: ReactNode }, _optional: Record<string, never> = {}) {
    const ports = admin.scope({ module });
    const description = admin.describe().pages.find(p => p.id === 'auth.auth');
    const value: AuthScope = { api: ports.authApi, permissions: description?.grants ?? [] };
    return createElement(ScopeContext.Provider, { value }, children);
  }
  return { pages, Provider };
}
