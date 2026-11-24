import type { AdminTaxonomyWithTerms, AdminTerm } from "../api/taxonomy-api.types.js";
import type { TaxonomyApi } from "../api/taxonomy-api.js";
import type { TaxonomyPort } from "./taxonomy-port.hooks.js";

/**
 * @file The only place among the taxonomy hooks that reaches the host-bound taxonomy API client
 * and Trash client for `useTaxonomy`/`useTermDetailPanel`'s four routes — see
 * `taxonomy-port.hooks.ts` for why the split exists.
 *
 * `trashTerm`/`trashTaxonomy` (T8b, 2026-09-21) go through `api.trash({ type, id })`, the generic
 * single-item Trash route every admin delete button now shares. See `taxonomy-port.hooks.ts`'s own
 * doc comment.
 */

/** The host's generic single-item Trash client, as the taxonomy deletes call it. */
export interface TaxonomyTrashClient {
  trash(target: { type: "term" | "taxonomy"; id: string }): Promise<{ ok: true; version: number | null }>;
}

/** The live implementation over the host-injected {@link TaxonomyApi} and Trash client. The host
 *  builds it once at its composition root, the way the redirects host ports bind a module-level
 *  singleton. */
export function createTaxonomyPort({ api, trash }: { api: TaxonomyApi; trash: TaxonomyTrashClient }, _optional: Record<string, never> = {}): TaxonomyPort {
  return {
    listTaxonomies: () => api.listTaxonomies(),
    trashTerm: ({ id }) => trash.trash({ type: "term", id }),
    trashTaxonomy: ({ id }) => trash.trash({ type: "taxonomy", id }),
    renameTerm: (target) => api.renameTerm(target),
  };
}

/** Seed state for {@link createFakeTaxonomyPort}. */
export interface FakeTaxonomyPortOptions {
  groups?: AdminTaxonomyWithTerms[];
  /** Set to make the next `trashTerm` call throw the 409 the generic Trash route sends for a term
   *  with children (`TERM_HAS_CHILDREN`/`count` — `routes/trash/items.ts`'s only `blocker` today),
   *  the same shape `describeDeleteBlocked` (rules.ts) reads. Taxonomies have no blocked case at all
   *  (`registry.ts`: only `term` registers a `blocker`), so there is no taxonomy equivalent here. */
  onTrashTermBlocked?: (termId: string) => { count: number } | undefined;
}

/**
 * An in-memory {@link TaxonomyPort} for tests — the fake that lets a test describe "this taxonomy
 * has these terms" or "this delete is blocked" directly, instead of hand-building fetch
 * `Response`s. Shipped alongside the real binding per the pattern's "every port gets a fake" rule
 * (see `assistant-chats-dependencies.hooks.ts`).
 */
export function createFakeTaxonomyPort(
  { blockedError }: {
    /** Builds the host's real request error for a blocked-trash seed — `describeDeleteBlocked`
     *  (rules.ts) narrows on the host's `isApiError`, so a plain `Error` with the same fields would
     *  silently fall through to the hard-error branch instead of the blocked one; the fake must
     *  throw the host's real class. */
    blockedError: (required: { count: number }) => Error;
  },
  options: FakeTaxonomyPortOptions = {},
): TaxonomyPort & {
  /** Every taxonomy group currently in the fake's store, in list order. */
  readonly groups: AdminTaxonomyWithTerms[];
} {
  const groups = [...(options.groups ?? [])];

  function findTerm(termId: string): { group: AdminTaxonomyWithTerms; term: AdminTerm } | undefined {
    for (const group of groups) {
      const term = group.terms.find((t) => t.id === termId);
      if (term) return { group, term };
    }
    return undefined;
  }

  return {
    groups,

    async listTaxonomies() {
      return { items: [...groups] };
    },

    async trashTerm({ id }) {
      const blocked = options.onTrashTermBlocked?.(id);
      if (blocked) throw blockedError({ count: blocked.count });
      const found = findTerm(id);
      if (!found) throw new Error(`fake taxonomy port: unknown term ${id}`);
      found.group.terms = found.group.terms.filter((t) => t.id !== id);
      return { ok: true, version: null };
    },

    async trashTaxonomy({ id }) {
      const index = groups.findIndex((g) => g.taxonomy.id === id);
      if (index < 0) throw new Error(`fake taxonomy port: unknown taxonomy ${id}`);
      groups.splice(index, 1);
      return { ok: true, version: null };
    },

    async renameTerm({ termId, newName }) {
      const found = findTerm(termId);
      if (!found) throw new Error(`fake taxonomy port: unknown term ${termId}`);
      const updated = { ...found.term, name: newName };
      found.group.terms = found.group.terms.map((t) => (t.id === termId ? updated : t));
      return { term: updated };
    },
  };
}
