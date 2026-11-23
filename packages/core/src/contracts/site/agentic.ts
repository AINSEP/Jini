/**
 * @file Page-navigation metadata and the host entity-lookup seam.
 *
 * Additive verbatim copy of the declarations in `@jini-ai/agentic` (`core/page-navigation.ts`);
 * agentic keeps its identical declarations and exports until the paired cutover.
 */

/** Published navigation metadata. Hosts own routes and entity lookup; this module only projects
 * validated destinations. Entity navigation never executes a follow-up control. */
export interface AgentEntityTarget {
  readonly type: string;
  readonly routeTemplate: string;
}
export interface AgentNavigationScreen {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly path: string;
  readonly routeTemplates: readonly string[];
  readonly allowedQueryParams: Readonly<Record<string, readonly string[] | null>>;
  readonly entityTargets: readonly AgentEntityTarget[];
}
export interface ResolvedPageEntity {
  readonly params: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  /** Search the destination's published controls, then click the discovered handle separately. */
  readonly control?: { readonly query: string; readonly role: 'button'; readonly intent: string };
}
export type PageEntityLookup = (required: { page: string; type: string; id: string }, optional?: Record<string, never>) => Promise<ResolvedPageEntity | null>;
