/**
 * @file The page a DOM page driver may navigate to, and the navigation input/result it answers with.
 *
 * Owner of these declarations; `@jini-ai/agentic` imports them from here and re-exports them from
 * its `core` and `core/dom` entries.
 */
import type { AgentNavigationScreen, ResolvedPageEntity } from './agentic.js';

export interface PageNavigationInput {
  readonly entity?: { readonly type: string; readonly id: string };
  readonly query?: Readonly<Record<string, string>>;
}

export interface PageNavigationResult {
  readonly path: string;
  readonly nextAction?: ResolvedPageEntity['control'];
}

/** One page a host allows navigation to: its human label, and how to actually get there. */
export interface DomPageDriverPage {
  /** Shown to a caller by `page.find_elements`/`page.navigate`'s refusal message — see
   *  `PageSummary.label` for why this exists at all. */
  readonly label: string;
  readonly navigation?: AgentNavigationScreen;
  readonly navigate: (required: PageNavigationInput) => void | PageNavigationResult | Promise<void | PageNavigationResult>;
}
