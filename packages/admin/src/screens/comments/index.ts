/**
 * @file The host-mounted comments panel.
 *
 * The host's route table renders `Comments`; that indirection is the point of the feature boundary:
 * the screens behind it live in `@jini-ai/admin/comments` and can be split, renamed, or grown a
 * `hooks/` directory without the router noticing. The host injects the hook that mounts a bound
 * admin-module page inside its own admin scope (`useModulePanel`) and the loading view shown until
 * that scope exists (`ModuleLoading`).
 */
import { createElement, type ComponentType, type ReactNode } from 'react';

/** The host hook that mounts one bound admin-module page inside the host's admin scope. */
export type CommentsModulePanelHook = (
  props: { moduleId: string; pageId: string; route: { view: null; params: Readonly<Record<string, string>>; query: URLSearchParams } },
  options: { loadingContent?: ReactNode },
) => { content: ReactNode };

/** What the host injects into the comments panel. */
export interface CommentsPanelProps {
  /** Custom hook: mounts the `comments.queue` module page in the host admin scope. */
  useModulePanel: CommentsModulePanelHook;
  /** The host's loading view while its admin scope is not ready. */
  ModuleLoading: ComponentType<Record<string, never>>;
}

/** Mount the existing comments route through the host's Jini module scope. */
export function Comments({ useModulePanel, ModuleLoading }: CommentsPanelProps, _optional: Record<string, never> = {}): ReactNode {
  return useModulePanel({ moduleId: 'comments', pageId: 'queue', route: { view: null, params: {}, query: new URLSearchParams() } },
    { loadingContent: createElement(ModuleLoading) }).content;
}
