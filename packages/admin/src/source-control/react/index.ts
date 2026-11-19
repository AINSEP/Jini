import { createElement, type ComponentType, type ReactNode } from 'react';
import type { AdminInstance, AdminModuleUi } from '@jini-ai/core/contracts/admin-module';
import { sourceControlModule } from '../source-control.module.js';
import { SourceControlPortsContext, SourceControlControllerContext } from './hooks/SourceControlPorts.hooks.js';
export { useSourceControlPorts, SourceControlControllerContext } from './hooks/SourceControlPorts.hooks.js';
/** The host injects the renderer helpers; this module states the contract and imports no implementation. */
type ModuleUi<Page, Tab> = AdminModuleUi<Page, Tab, ComponentType<{ admin: AdminInstance; children: ReactNode }>>;
export function sourceControl<Page, Tab>({ ui }: { ui: ModuleUi<Page, Tab> }, _optional = {}) {
  const module = { ...sourceControlModule };
  const react = ui.bindReact({ module, views: { sourceControl: { page: () => import('./pages/SourceControlPage.js'), tabs: { providers: () => import('./tabs/ProvidersTab.js') } } } }, { context: SourceControlPortsContext });
  function Provider({ admin, children }: { admin: AdminInstance; children: ReactNode }, _optional: Record<string, never> = {}) {
    return createElement(SourceControlControllerContext.Provider, { value: ui.useController }, createElement(react.Provider, { admin, children }));
  }
  return Object.assign(module, { react: { ...react, Provider } });
}
