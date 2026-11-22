import type { AdminTaxonomy } from "../api/taxonomy-api.types.js";

/**
 * @file What `useNewTaxonomyForm` needs from the outside world, as an interface rather than a
 * direct import of the host's API client.
 *
 * A separate port from `taxonomy-port.hooks.ts` and the other taxonomy ports: `createTaxonomy` is
 * this form's only route, shared with none of `TaxonomyPort`'s four, `MergeTermSectionPort`'s
 * three, or `NewTermFormPort`'s one — narrowing to what this hook actually consumes, per
 * the host's page-editor port's "narrowing here is not a shared contract, it is this hook's own
 * consumption" reasoning.
 */
export interface NewTaxonomyFormPort {
  createTaxonomy(input: { name: string; hierarchical: boolean }): Promise<{ taxonomy: AdminTaxonomy }>;
}
