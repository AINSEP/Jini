/**
 * @file REQ-34's "where used" projection for widgets — the model-facing shape every caller that
 * surfaces reference data renders (the widget-editor banner, the purge-blocked 409 body, the
 * `widgets.diagnose` AI tool), so no consumer has to special-case where the data came from.
 *
 * Architectural role:
 * This is a response SHAPER, not transport. It maps `entry_refs` rows — this domain's own
 * reference-integrity index (`core/entry-refs`) — onto the disclosure vocabulary widgets speaks
 * (`region` | `embed`). It touches no `Response`, no status code, and no error mapping; those stay
 * in the HTTP layer.
 *
 * Why it lives here rather than under the HTTP admin layer, where it used to:
 * it was the single import edge that made `widgets` depend on the composition root, and `server/`
 * transitively reaches the whole tree — that one edge inflated this domain's transitive closure
 * from 47 files / 7 modules to 162 files / 31 modules, which is the entire reason widgets looked
 * unextractable. A host importing a domain's projection is the correct direction; a domain
 * importing its host's transport module is not. Same misplacement species as
 * `core/rate-limit/rate-limit.ts` and `features/plugin-runtime/admin-response.ts`, both already
 * relocated. `server/http/site/page-head.ts` is the same species but NOT relocated — its own doc
 * comment records a deliberate ADR-032 decision that the render layer, not `seo`, owns this seam,
 * which the 2026-08-02 module-graph analysis's "page-head.ts -> seo/" suggestion did not account
 * for; that one needs an architecture decision, not a mechanical move (2026-08-12 Refactor pass).
 * The HTTP layer re-exports this symbol so its own consumers keep their existing import site.
 */
import type { EntryRefRow } from "./ports.js";

/** One disclosed reference: which widgets-level location holds it, and where inside that source. */
export interface WhereUsedReference {
  /** `entry_refs` distinguishes several source kinds; widgets discloses them as exactly two. */
  kind: "region" | "embed";
  sourceEntryId: string;
  fieldPath: string;
}

/** REQ-34's where-used disclosure shape. */
export interface WhereUsedResponse {
  count: number;
  references: WhereUsedReference[];
}

export function toWhereUsedResponse({ refs }: { refs: readonly EntryRefRow[] }, _optional: Record<string, never> = {}): WhereUsedResponse {
  return {
    count: refs.length,
    references: refs.map((ref) => ({
      kind: ref.sourceKind === "widget-embed" ? "embed" : "region",
      sourceEntryId: ref.sourceEntryId,
      fieldPath: ref.fieldPath,
    })),
  };
}
