import { ScopeContext, type RolesScope } from './RolesScope.hooks.js';
export { useRolesScope } from './RolesScope.hooks.js';
export type { RolesScope, RolesTabProps, RolesPageProps } from './RolesScope.hooks.js';
import { createElement, lazy } from 'react';
import type { ReactNode } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import { rolesModule } from '../../roles.module.js';
/** A private scope binds only this module's declared ports. No admin React internals are needed. */
export function createRolesBinding({ module }: {
    module: typeof rolesModule;
}, _optional: Record<string, never> = {}) {
    const pages = { roles: { Page: lazy(() => import('../pages/RolesPage.js')), tabs: {
                roles: lazy(() => import('../tabs/RolesTab.js')), policies: lazy(() => import('../tabs/PoliciesTab.js')),
            } } };
    function Provider({ admin, children }: {
        admin: AdminInstance;
        children: ReactNode;
    }, _optional: Record<string, never> = {}) {
        const ports = admin.scope({ module });
        const description = admin.describe().pages.find(p => p.id === 'roles.roles');
        const value: RolesScope = { api: ports.rolesApi, permissions: description?.grants ?? [] };
        return createElement(ScopeContext.Provider, { value }, children);
    }
    return { pages, Provider };
}
