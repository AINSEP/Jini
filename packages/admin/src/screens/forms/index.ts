/**
 * @file The host-mounted forms panels.
 *
 * The host's route table renders `FormsList` and `FormEditor`; that indirection is the point of the
 * feature boundary: the screens behind them live in `@jini-ai/admin/forms` and can be split,
 * renamed, or grown a `hooks/` directory without the router noticing. The host injects the hook that
 * mounts a bound admin-module page inside its own admin scope (`useModulePanel`) and the loading
 * view shown until that scope exists (`ModuleLoading`). Stylesheets the screens rely on are the
 * host's to load.
 */
import { createElement, type ComponentType, type ReactNode } from 'react';

/** The host hook that mounts one bound admin-module page inside the host's admin scope. */
export type FormsModulePanelHook = (
  props: { moduleId: string; pageId: string; params?: Readonly<Record<string, unknown>>;
    route: { view: null; params: Readonly<Record<string, string>>; query: URLSearchParams } },
  options: { loadingContent?: ReactNode },
) => { content: ReactNode };

/** What the host injects into every forms panel. */
export interface FormsPanelProps {
  /** Custom hook: mounts a `forms.*` module page in the host admin scope. */
  useModulePanel: FormsModulePanelHook;
  /** The host's loading view while its admin scope is not ready; `editor` selects the editor copy. */
  ModuleLoading: ComponentType<{ editor?: boolean }>;
}

/** Mount the Forms list through the host's Jini scope, keeping the public panel export. */
export function FormsList({ useModulePanel, ModuleLoading }: FormsPanelProps, _optional: Record<string, never> = {}): ReactNode {
  return useModulePanel({ moduleId: 'forms', pageId: 'list', route: { view: null, params: {}, query: new URLSearchParams() } },
    { loadingContent: createElement(ModuleLoading) }).content;
}

/** Route-derived tabs share one editor identity so visiting submissions preserves the draft. */
export function FormEditor({ formId, tab, useModulePanel, ModuleLoading }: FormsPanelProps & { formId: string; tab: 'fields' | 'submissions' }, _optional: Record<string, never> = {}): ReactNode {
  return useModulePanel({ moduleId: 'forms', pageId: 'editor', params: { formId },
    route: { view: null, params: { formId }, query: new URLSearchParams({ tab }) } },
    { loadingContent: createElement(ModuleLoading, { editor: true }) }).content;
}
