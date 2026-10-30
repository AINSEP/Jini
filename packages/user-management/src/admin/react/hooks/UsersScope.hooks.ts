// Scope and page contracts must not import the lazy page/binding assembly.
import { createContext, useContext } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import type { UsersApiPort, UsersSafetyPort } from '../../ports.js';
export interface UsersScope { readonly api: UsersApiPort; readonly permissions: readonly string[]; readonly safety: UsersSafetyPort; }
export const ScopeContext = createContext<UsersScope | null>(null);
export interface UsersPageProps {
  readonly tabs: Readonly<Record<string, LazyExoticComponent<ComponentType<{ readonly params?: Readonly<Record<string, unknown>> }>>>>;
  readonly description: ReturnType<AdminInstance['describe']>['pages'][number];
  readonly openOwnPasswordReset?: boolean;
  readonly onOwnPasswordResetClosed?: (required: Record<string, never>, optional?: Record<string, never>) => void;
}
export function useUsersScope(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const scope = useContext(ScopeContext); if (!scope) {
    throw new Error('Users admin scope is unavailable.');
  }
  return scope;
}
