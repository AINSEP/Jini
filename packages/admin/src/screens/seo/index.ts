/**
 * @file Public surface of the `seo` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder. That indirection is the
 * point of the feature boundary: everything below can be split, renamed, or grown a `hooks/`
 * directory without the router noticing. Adding a file to this feature is not an API change unless
 * it is exported from this line.
 */
import { createElement, type ComponentType, type ReactNode } from 'react';

/** The host's module-panel hook: mounts a Jini module page inside the host's admin module scope. */
export type SeoModulePanelHook = (
  props: { moduleId: string; pageId: string; route: { view: string | null; params: Readonly<Record<string, string>>; query: URLSearchParams } },
  optional?: { loadingContent?: ReactNode },
) => { content: ReactNode };

/** Mount the existing SEO route through its Jini settings page, preserving the tabId prop. */
export function Seo(
  { tabId, useModulePanel, ModuleLoading }: { tabId: string | null; useModulePanel: SeoModulePanelHook; ModuleLoading: ComponentType },
  _optional: Record<string, never> = {},
): ReactNode {
  const query = new URLSearchParams();
  if (tabId !== null) query.set('tab', tabId);
  return useModulePanel({ moduleId: 'seo', pageId: 'settings', route: { view: null, params: {}, query } },
    { loadingContent: createElement(ModuleLoading) }).content;
}
