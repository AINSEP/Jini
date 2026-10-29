// Scope and page contracts must not import the lazy page/binding assembly.
import { createContext, useContext } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import type { MembersApiPort, MembersRefreshPort } from '../../ports.js';
export interface MembersScope { readonly api: MembersApiPort; readonly permissions: readonly string[]; }
export const ScopeContext = createContext<MembersScope | null>(null);
export interface MembersPageProps {
  readonly tabs: Readonly<Record<string, LazyExoticComponent<ComponentType<{ readonly params?: Readonly<Record<string, unknown>> }>>>>;
  readonly description: ReturnType<AdminInstance['describe']>['pages'][number];
  readonly refresh?: MembersRefreshPort;
}
export function useMembersScope(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const scope = useContext(ScopeContext); if (!scope) {
    throw new Error('Members admin scope is unavailable.');
  }
  return scope;
}
