import type { TaxonomyListPort, TermListPort } from "../../taxonomy/index.js";
import type { PageHtmlEmbedRef } from "../html/html-embeds.js";
import type { WidgetRenderIR } from "../types.js";

/** Workspace-scoped read ports are supplied by the host, like the other HTML embed resolvers. */
export async function resolveTaxonomyEmbeds(
  { refs, deps }: { refs: readonly PageHtmlEmbedRef[]; deps: { taxonomyRepo?: TaxonomyListPort; termRepo?: TermListPort } },
  _optional = {},

): Promise<ReadonlyMap<string, WidgetRenderIR>> {
  const resolved = new Map<string, WidgetRenderIR>();
  if (!deps.taxonomyRepo || !deps.termRepo) return resolved;
  const taxonomies = (await deps.taxonomyRepo.list()).filter((taxonomy) => taxonomy.status !== "trash" && taxonomy.status !== "purged");
  const termsById = new Map<string, Awaited<ReturnType<TermListPort["listByTaxonomy"]>>>();
  for (const ref of refs) {
    const key = ref.id;
    if (!key) continue;
    // Names are human-readable targets, but unlike slugs are not guaranteed unique.
    // An ambiguous name is unresolved, never an arbitrary choice; real ids win.
    const matches = taxonomies.filter((taxonomy) => taxonomy.name === key);
    const taxonomy = taxonomies.find((candidate) => candidate.id === key) ?? (matches.length === 1 ? matches[0] : undefined);
    if (!taxonomy) continue;
    let terms = termsById.get(taxonomy.id);
    if (!terms) {
      terms = await deps.termRepo.listByTaxonomy({ taxonomyId: taxonomy.id });
      termsById.set(taxonomy.id, terms);
    }
    resolved.set(key, {
      componentId: "taxonomy-list",
      props: {
        id: taxonomy.id, name: taxonomy.name, hierarchical: taxonomy.hierarchical,
        terms: terms.filter((term) => term.taxonomyId === taxonomy.id && term.status !== "trash" && term.status !== "purged")
          .map((term) => ({ id: term.id, name: term.name, parentId: term.parentId })),
      },
    });
  }
  return resolved;
}
