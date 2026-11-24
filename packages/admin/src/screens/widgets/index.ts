/**
 * @file The host-mounted widgets panels.
 *
 * The host's route table renders these four panels; that indirection is the point of the feature
 * boundary: the screens behind them live in `@jini-ai/admin/widgets` and can be split, renamed, or
 * grown a `hooks/` directory without the router noticing. The host injects the hook that mounts a
 * bound admin-module page inside its own admin scope (`useModulePanel`) and the loading view shown
 * until that scope exists (`ModuleLoading`).
 */
import { createElement, type ComponentType, type ReactNode } from 'react';

/** The host hook that mounts one bound admin-module page inside the host's admin scope. */
export type WidgetsModulePanelHook = (
  props: { moduleId: string; pageId: string; params?: Readonly<Record<string, unknown>>;
    route: { view: null; params: Readonly<Record<string, string>>; query: URLSearchParams } },
  options: { loadingContent?: ReactNode },
) => { content: ReactNode };

/** The widgets module pages a panel can mount; each selects its own loading copy. */
export type WidgetsPanelPageId = 'library' | 'editor' | 'regions' | 'region';

/** What the host injects into every widgets panel. */
export interface WidgetsPanelProps {
  /** Custom hook: mounts a `widgets.*` module page in the host admin scope. */
  useModulePanel: WidgetsModulePanelHook;
  /** The host's loading view while its admin scope is not ready, per page. */
  ModuleLoading: ComponentType<{ pageId: WidgetsPanelPageId }>;
}

/** Mount the library through Jini while retaining the host route's public export. */
export function WidgetsLibrary({ useModulePanel, ModuleLoading }: WidgetsPanelProps, _optional: Record<string, never> = {}): ReactNode {
  return useModulePanel({ moduleId: 'widgets', pageId: 'library', route: { view: null, params: {}, query: new URLSearchParams() } },
    { loadingContent: createElement(ModuleLoading, { pageId: 'library' }) }).content;
}
/** Region routes retain the host's widget-regions agent page id in its route table. */
export function WidgetRegions({ useModulePanel, ModuleLoading }: WidgetsPanelProps, _optional: Record<string, never> = {}): ReactNode {
  return useModulePanel({ moduleId: 'widgets', pageId: 'regions', route: { view: null, params: {}, query: new URLSearchParams() } },
    { loadingContent: createElement(ModuleLoading, { pageId: 'regions' }) }).content;
}
/** Forward the matched region key unchanged; Jini owns the placement editor. */
export function WidgetRegionEditor({ regionKey, useModulePanel, ModuleLoading }: WidgetsPanelProps & { regionKey: string }, _optional: Record<string, never> = {}): ReactNode {
  return useModulePanel({ moduleId: 'widgets', pageId: 'region', params: { regionKey }, route: { view: null, params: { regionKey }, query: new URLSearchParams() } },
    { loadingContent: createElement(ModuleLoading, { pageId: 'region' }) }).content;
}
/** Both /new?type= and /:widgetId share this page; preserve null for a new instance. */
export function WidgetInstanceEditor({ widgetId, widgetType, useModulePanel, ModuleLoading }: WidgetsPanelProps & { widgetId: string | null; widgetType: string | null }, _optional: Record<string, never> = {}): ReactNode {
  const query = new URLSearchParams();
  if (widgetType !== null) query.set('type', widgetType);
  return useModulePanel({ moduleId: 'widgets', pageId: 'editor', params: { widgetId, widgetType }, route: { view: null, params: widgetId === null ? {} : { widgetId }, query } },
    { loadingContent: createElement(ModuleLoading, { pageId: 'editor' }) }).content;
}
