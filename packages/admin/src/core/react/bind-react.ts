import { createContext, createElement, lazy, useContext } from 'react';
import type { ComponentType, ReactNode, LazyExoticComponent, Context as ReactContext } from 'react';
import type { AdminInstance, AdminModule, ScopedPorts } from '../module/types.js';
import { AdminConfigError } from '../module/create-admin.js';
export interface TabViewProps {
  readonly params: Readonly<Record<string, unknown>>;
  readonly permissions?: readonly string[];
}
export interface ModulePageProps {
  readonly tabs: Readonly<Record<string, LazyExoticComponent<ComponentType<TabViewProps>>>>;
  readonly description: ReturnType<AdminInstance['describe']>['pages'][number];
  readonly requestedTab?: string;
  readonly onTabChange?: (required: { tab: string }, optional?: Record<string, never>) => void;
}
type Loader<P> = () => Promise<{ default: ComponentType<P> }>;
export type ReactViews<M extends AdminModule> = {
  readonly [P in keyof M['pages']]: {
    readonly page: Loader<ModulePageProps>;
    readonly tabs: { readonly [T in keyof M['pages'][P]['tabs']]: Loader<TabViewProps> };
  };
};
/** Every page and tab is lazy. The only port context is private to this binding;
 * a sibling module can never read another module's dependencies through a global locator. */
export function bindReact<const M extends AdminModule>(
  { module, views }: { module: M; views: ReactViews<M> },
  { context }: { context?: ReactContext<ScopedPorts<M> | null> } = {},
) {
  const Context = context ?? createContext<ScopedPorts<M> | null>(null);
  const pages = Object.fromEntries(
    Object.entries(views).map(([id, raw]) => {
      const view = raw as {
        page: Loader<ModulePageProps>;
        tabs: Record<string, Loader<TabViewProps>>;
      };
      return [
        id,
        {
          Page: lazy(view.page),
          tabs: Object.fromEntries(
            Object.entries(view.tabs).map(([tab, load]) => [tab, lazy(load)]),
          ),
        },
      ];
    }),
  ) as {
    [P in keyof M['pages']]: {
      Page: LazyExoticComponent<ComponentType<ModulePageProps>>;
      tabs: {
        [T in keyof M['pages'][P]['tabs']]: LazyExoticComponent<ComponentType<TabViewProps>>;
      };
    };
  };
  function usePorts(
    _required: Record<string, never> = {},
    _optional: Record<string, never> = {},
  ): ScopedPorts<M> {
    const ports = useContext(Context);
    if (!ports) throw new AdminConfigError({ issues: [`React scope unavailable: ${module.id}`] });
    return ports;
  }
  function Provider(
    { admin, children }: { admin: AdminInstance; children: ReactNode },
    _optional: Record<string, never> = {},
  ) {
    return createElement(Context.Provider, { value: admin.scope({ module }) }, children);
  }
  return { module, pages, Provider, usePorts };
}
