import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { AdminInstance } from '../../core/module/types.js';
import { bindReact } from '../../core/react/bind-react.js';
import type { ModulePageProps } from '../../core/react/bind-react.js';
import { widgetsModule } from '../widgets.module.js';
import { WidgetsPortsContext, WidgetsOptionsContext } from './hooks/WidgetsPorts.hooks.js';
import type { WidgetsReactOptions } from './hooks/WidgetsPorts.hooks.js';
export type { WidgetsReactOptions, WidgetsSlots } from './hooks/WidgetsPorts.hooks.js';
export { useWidgetsPorts, useWidgetsOptions } from './hooks/WidgetsPorts.hooks.js';
export type { WidgetsLibraryProps } from './pages/WidgetsLibrary.js';
export type { WidgetInstanceEditorProps } from './pages/WidgetInstanceEditor.js';
export type { WidgetRegionsProps } from './pages/WidgetRegions.js';
export type { WidgetRegionEditorProps } from './pages/WidgetRegionEditor.js';
/** Optional page params are the Part B host bridge; core ModulePageProps remains untouched. */
export type WidgetsModulePageProps = ModulePageProps & { params?: { widgetId?: string | null; widgetType?: string | null; regionKey?: string } | undefined; widgetId?: string | null | undefined; widgetType?: string | null | undefined; regionKey?: string | undefined };
/** Lazy pages share injected options while bindReact owns the API scope. */
export function widgets({ slots, widgetTypes, defaultConfig }: Pick<WidgetsReactOptions, 'slots' | 'widgetTypes' | 'defaultConfig'>, optional: Omit<WidgetsReactOptions, 'slots' | 'widgetTypes' | 'defaultConfig'> = {}) {
  // Scope membership uses object identity, so bind and return this same per-admin module.
  const module = { ...widgetsModule };
  const defaults: WidgetsReactOptions = { slots, widgetTypes, defaultConfig, ...optional };
  function page<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, params: (props: WidgetsModulePageProps) => P) {
    return async () => {
      const loaded = await load();
      return { default: (props: WidgetsModulePageProps) => createElement(loaded.default, params(props) as P & import('react').Attributes) };
    };
  }
  const react = bindReact({ module, views: {
    library: { page: page(() => import('./pages/WidgetsLibrary.js'), () => ({})), tabs: {} },
    editor: { page: page(() => import('./pages/WidgetInstanceEditor.js'), props => ({ widgetId: props.params?.widgetId ?? props.widgetId ?? null, widgetType: props.params?.widgetType ?? props.widgetType ?? null })), tabs: {} },
    regions: { page: page(() => import('./pages/WidgetRegions.js'), () => ({})), tabs: {} },
    region: { page: page(() => import('./pages/WidgetRegionEditor.js'), props => ({ regionKey: props.params?.regionKey ?? props.regionKey ?? '' })), tabs: {} },
  } }, { context: WidgetsPortsContext });
  /** Refresh host options without replacing lazy views or discarding controller drafts.
   * Factory defaults support existing hosts; the port scope remains owned by bindReact.
   */
  function Provider({ admin, children, options = defaults }: { admin: AdminInstance; children: ReactNode; options?: WidgetsReactOptions }, _optional: Record<string, never> = {}) {
    return createElement(react.Provider, { admin, children: createElement(WidgetsOptionsContext.Provider, { value: options }, children) });
  }
  return Object.assign(module, { react: { ...react, Provider } });
}
