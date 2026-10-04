import { createContext, createElement, lazy, useContext } from 'react';
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import { rolesModule } from '../../roles.module.js';
import type { RolesApiPort } from '../../ports.js';
export interface RolesScope {
    readonly api: RolesApiPort;
    readonly permissions: readonly string[];
}
const ScopeContext = createContext<RolesScope | null>(null);
export interface RolesTabProps {
    readonly params?: Readonly<Record<string, unknown>>;
}
export interface RolesPageProps {
    readonly tabs: Readonly<Record<string, LazyExoticComponent<ComponentType<RolesTabProps>>>>;
    readonly description: ReturnType<AdminInstance['describe']>['pages'][number];
    readonly requestedTab?: string;
    readonly onTabChange?: (required: {
        tab: string;
    }, optional?: Record<string, never>) => void;
}
export function useRolesScope(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const scope = useContext(ScopeContext);
    if (!scope)
        throw new Error('Roles admin scope is unavailable.');
    return scope;
}
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
