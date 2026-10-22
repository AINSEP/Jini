import { ScopeContext, type AuthScope } from './AuthScope.hooks.js';
export { useAuthScope } from './AuthScope.hooks.js';
export type { AuthScope, AuthPageProps } from './AuthScope.hooks.js';
import { createElement, lazy } from 'react';
import type { ReactNode } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import { authModule } from '../../auth.module.js';
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
