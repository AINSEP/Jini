/**
 * @file The page a DOM page driver may navigate to, and the navigation input/result it answers with.
 *
 * Additive verbatim copy of the declarations in `@jini-ai/agentic` (`core/dom/dom-page-driver.ts`,
 * `core/page-navigation.ts`); agentic keeps its identical declarations and exports until the paired
 * cutover.
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
