import type { UnassignableEntryTermRepoPort } from "./assignment-service.js";
import type { ImportableTaxonomyRepoPort, ImportableTermRepoPort } from "./import-service.js";
import type { TaxonomyListPort, TermListPort } from "./list.js";
import type { EntryTermReadPort, TaxonomyPublishReadPort, TermPublishReadPort } from "./read-ports.js";
import type {
  ContentLookupPort,
  ContentTypeTaxonomyPolicyPort,
  EntryTermRepoPort,
  TaxonomyRepoPort,
  TaxonomyRevisionRepoPort,
  TermRepoPort,
} from "./write-contracts.js";

/**
 * @file The `taxonomy` and `term` slices of a publish bag (`PublishPorts`,
 * `@jini-ai/core/contracts/site/publish-ports`) — one shared shape.
 *
 * `taxonomy` and `term` share one bag: the taxonomy write-service deps, minus the gateway
 * fields the engine's deps already carry.
 */
export interface TaxonomyPublishPorts {
  readonly taxonomies: TaxonomyRepoPort & TaxonomyListPort & ImportableTaxonomyRepoPort & TaxonomyPublishReadPort;
  readonly terms: TermRepoPort & TermListPort & ImportableTermRepoPort & TermPublishReadPort;
  /** Also read and unassigned: post/page/entry `termIds` sync through these (`taxonomy/publish-term-ids.ts`). */
  readonly entryTerms: EntryTermRepoPort & UnassignableEntryTermRepoPort & EntryTermReadPort;
  readonly revisions: TaxonomyRevisionRepoPort;
  readonly stampWatermark: () => Promise<void> | void;
  /** Resolves posts/pages and collection entries (`createContentLookup`). */
  readonly contentLookup: ContentLookupPort;
  /** Which collection types take terms: every live one (the host's `buildContentPublishPorts`). */
  readonly contentTypeTaxonomyPolicy: ContentTypeTaxonomyPolicyPort;
}
