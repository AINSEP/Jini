import type { AdminTerm } from "../api/taxonomy-api.types.js";

/**
 * @file What `useNewTermForm` needs from the outside world, as an interface rather than a direct
 * import of the host's API client.
 *
 * A separate port from `taxonomy-port.hooks.ts` and the other taxonomy ports: `createTerm` is this
 * form's only route, shared with none of `TaxonomyPort`'s four, `MergeTermSectionPort`'s three, or
 * `NewTaxonomyFormPort`'s one — narrowing to what this hook actually consumes, per the host's page-
 * editor port's "narrowing here is not a shared contract, it is this hook's own consumption"
 * reasoning.
 */
export interface NewTermFormPort {
  createTerm(
    target: { taxonomyId: string; name: string },
    options?: { parentId?: string | null }
  ): Promise<{ term: AdminTerm }>;
}
