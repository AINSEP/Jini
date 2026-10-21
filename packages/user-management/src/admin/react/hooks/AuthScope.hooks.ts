// Scope and page contracts must not import the lazy page/binding assembly.
import { createContext, useContext } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { AdminInstance } from '@jini-ai/admin/core/module';
import type { AuthApiPort } from '../../ports.js';
import type { AdminAccount } from '../../models.js';
export interface AuthScope { readonly api: AuthApiPort; readonly permissions: readonly string[]; }
export const ScopeContext = createContext<AuthScope | null>(null);
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
