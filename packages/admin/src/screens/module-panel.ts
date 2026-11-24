/**
 * @file The host's module-panel hook shape, shared by every screen that mounts a Jini module page
 * through the host's admin module scope (SEO, Redirects, …). One neutral owner so screens do not
 * each redeclare the same contract.
 */
import type { ReactNode } from 'react';

/** The host's module-panel hook: mounts a Jini module page inside the host's admin module scope. */
export type ModulePanelHook = (
  props: { moduleId: string; pageId: string; route: { view: string | null; params: Readonly<Record<string, string>>; query: URLSearchParams } },
  optional?: { loadingContent?: ReactNode },
) => { content: ReactNode };
