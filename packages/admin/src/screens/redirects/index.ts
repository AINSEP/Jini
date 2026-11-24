/**
 * @file Public surface of the `redirects` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder. That indirection is the
 * point of the feature boundary: everything below can be split, renamed, or grown a `hooks/`
 * directory without the router noticing. Adding a file to this feature is not an API change unless
 * it is exported from this line.
 */
import { createElement, type ComponentType, type ReactNode } from 'react';
import type { ModulePanelHook } from '../module-panel.js';

/** The host's module-panel hook (shared shape: `../module-panel.ts`). */
export type RedirectsModulePanelHook = ModulePanelHook;

/** Mount the existing redirects route through the host's Jini module scope. */
export function Redirects(
  { useModulePanel, ModuleLoading }: { useModulePanel: RedirectsModulePanelHook; ModuleLoading: ComponentType },
  _optional: Record<string, never> = {},
): ReactNode {
  return useModulePanel({ moduleId: 'redirects', pageId: 'list', route: { view: null, params: {}, query: new URLSearchParams() } },
    { loadingContent: createElement(ModuleLoading) }).content;
}
