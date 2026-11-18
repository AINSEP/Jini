import type { Taxonomy, Term } from "./write-service.js";

/**
 * @file The read ports a taxonomy store offers beyond the write/list ports of `write-service.ts` and
 * `list.ts`. Types only, so render-path importers take them from `./taxonomy` without loading the
 * `node` SQL entry that implements them.
 */

/** Publish-content's taxonomy read: the full row, trashed ones included, so a precheck refuses a
 *  trashed destination instead of colliding. */
export interface TaxonomyPublishReadPort {
  findAnyById(required: { id: string }): Promise<Taxonomy | null>;
}

/** Publish-content's term read — see {@link TaxonomyPublishReadPort}. */
export interface TermPublishReadPort {
  findAnyById(required: { id: string }): Promise<Term | null>;
}

/**
 * One term assigned to a piece of content, joined with its own name and its owning taxonomy's name
 * — the shape {@link EntryTermReadPort.listForContent} returns, and the ONLY shape a public-render
 * surface needs to list a page's terms.
 */
export interface AssignedTermView {
  termId: string;
  termName: string;
  taxonomyName: string;
}

/**
 * Additive capability beyond the certified `EntryTermRepoPort` (which has no by-content READ method).
 * Kept a SEPARATE, OPTIONAL field on a host's route dependencies because `InMemoryEntryTermRepo` does
 * not implement it; a caller missing this field degrades to "no terms rendered", never a throw.
 */
export interface EntryTermReadPort {
  listForContent(params: { contentType: string; contentId: string }): Promise<readonly AssignedTermView[]>;
}
