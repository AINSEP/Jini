// Scope and page contracts must not import the lazy page/binding assembly.
import { createContext, useContext } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import type { RolesApiPort } from '../../ports.js';
export interface RolesScope {
    readonly api: RolesApiPort;
    readonly permissions: readonly string[];
}
export const ScopeContext = createContext<RolesScope | null>(null);
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
