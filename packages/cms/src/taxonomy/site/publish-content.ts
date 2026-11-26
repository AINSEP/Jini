import { ForbiddenError } from "@jini-ai/cms/core";

import type { createRepoPublishHandler, gatewayDeps as GatewayDeps, RepoWriteContext } from "@jini-ai/cms/publish/content/repo-handler";
import type { PublishContentContributor } from "@jini-ai/cms/publish/content/type-registry";
import type { CmsPublishPorts } from "@jini-ai/cms/publish/content/publish-ports";
import type { TaxonomyPublishPorts } from "@jini-ai/cms/taxonomy/publish-ports";

import {
  HierarchyCycleDetectedError,
  importTaxonomy,
  importTerm,
  ParentCrossTaxonomyError,
  TaxonomyNotHierarchicalError,
  TaxonomyRecordNotFoundError,
  TaxonomyVersionConflictError,
  TermNotFoundError,
  toTaxonomyOutbox,
  type Taxonomy,
  type Term,
} from "@jini-ai/cms/taxonomy";

/** The slice of the host's publish bag this file reads. The host registry (`features/publish-content/type-registry.ts`) is
 *  instantiated with the full product bag, which satisfies this slice, so this file names no other feature. */
type TaxonomyBag = Pick<CmsPublishPorts, "taxonomy" | "term">;

/**
 * @file `taxonomy` and `term` on the publish factory. Both keep the source's own id (Jini's
 * `importTaxonomy`/`importTerm`), so a term's `taxonomyId`/`parentId` point at the same rows on the
 * destination. A trashed row (`status` = `"trash"`) never packs, and a trashed destination refuses.
 * `status`, `updatedAt` and `version` stay local.
 */

const TRASH = "trash";

/** The Jini write-service deps for one apply. */
function writeDeps({ ctx, entityType, gatewayDeps }: { ctx: RepoWriteContext<unknown, TaxonomyPublishPorts, TaxonomyBag>; entityType: string; gatewayDeps: typeof GatewayDeps }, _optional = {}) {
  const { deps, workspaceId, ports } = ctx;
  const gateway = gatewayDeps({ deps, entityType });
  return {
    ...ports,
    clock: deps.clock,
    idGen: deps.idGen,
    workspaceId,
    authorize: (params: { principalId: string; permission: string }) => gateway.authorize({ ...params, workspaceId }),
    outbox: toTaxonomyOutbox({ outbox: gateway.outbox, clock: deps.clock, idGen: deps.idGen, workspaceId }),
  };
}

const errors = {
  conflict: [TaxonomyVersionConflictError],
  blocked: [ForbiddenError, TaxonomyRecordNotFoundError, TermNotFoundError, HierarchyCycleDetectedError, ParentCrossTaxonomyError, TaxonomyNotHierarchicalError],
};

export const contributeTaxonomyPublish = (required: { createRepoPublishHandler: typeof createRepoPublishHandler; gatewayDeps: typeof GatewayDeps }, _optional = {}): PublishContentContributor<TaxonomyBag> =>
  required.createRepoPublishHandler<Taxonomy, TaxonomyPublishPorts, TaxonomyBag>({
    entityType: "taxonomy",
    coversTables: ["taxonomies", "terms", "entry_terms", "taxonomy_revisions"],
    permission: "admin.taxonomy.manage",
    ports: ({ deps }, _optional = {}) => deps.ports.taxonomy,
    list: ({ ports: p }) => p.taxonomies.list(),
    find: ({ ports: p, workspaceId: _workspaceId, id }) => p.taxonomies.findAnyById({ id }),
    isTrashed: ({ row }) => row.status === TRASH,
    fields: { name: "transferred", hierarchical: "transferred", id: "local", status: "local", updatedAt: "local", version: "local" },
    // Not unique in the schema; two same-named groups would read as one on screen.
    address: { field: "name", holder: async ({ ports: p, workspaceId: _workspaceId, value: name }) => (await p.taxonomies.list()).find((t) => t.name === name) ?? null },
    write: async (ctx) => {
      const { id, state, expectedVersion, principalId } = ctx;
      const deps = writeDeps({ ctx, gatewayDeps: required.gatewayDeps, entityType: "taxonomy" });
      const saved = await importTaxonomy({ deps, principalId, actor: ctx.deps.mutationActor, id, name: state.name as string, hierarchical: state.hierarchical as boolean, expectedVersion });
      return { version: saved.version };
    },
    errors,
  });

/** Parents before children, so `importTerm` always finds a term's parent already written. */
function parentFirst({ rows }: { rows: readonly Term[] }, _optional = {}): Term[] {
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const ordered: Term[] = [];
  const seen = new Set<string>();
  const visit = (row: Term): void => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (parent) visit(parent);
    ordered.push(row);
  };
  rows.forEach(visit);
  return ordered;
}

export const contributeTermPublish = (required: { createRepoPublishHandler: typeof createRepoPublishHandler; gatewayDeps: typeof GatewayDeps }, _optional = {}): PublishContentContributor<TaxonomyBag> =>
  required.createRepoPublishHandler<Term, TaxonomyPublishPorts, TaxonomyBag>({
    entityType: "term",
    coversTables: ["taxonomies", "terms", "entry_terms", "taxonomy_revisions"],
    permission: "admin.taxonomy.manage",
    dependsOn: ["taxonomy"],
    ports: ({ deps }, _optional = {}) => deps.ports.term,
    list: async ({ ports: p }) => (await Promise.all((await p.taxonomies.list()).map((t) => p.terms.listByTaxonomy({ taxonomyId: t.id })))).flat(),
    find: ({ ports: p, workspaceId: _workspaceId, id }) => p.terms.findAnyById({ id }),
    isTrashed: ({ row }) => row.status === TRASH,
    packOrder: parentFirst,
    fields: { taxonomyId: "transferred", parentId: "transferred", name: "transferred", id: "local", status: "local", updatedAt: "local", version: "local" },
    // Its taxonomy and its parent: a scoped publish of a term brings both.
    references: ({ entity: { state } }) => [
      { entityType: "taxonomy", key: String(state.taxonomyId) },
      ...(typeof state.parentId === "string" ? [{ entityType: "term", key: state.parentId }] : []),
    ],
    // A name is taken only among its siblings (same taxonomy, same parent).
    address: {
      field: "name",
      holder: async ({ ports: p, workspaceId: _workspaceId, value: name, state }) =>
        (await p.terms.listByTaxonomy({ taxonomyId: state.taxonomyId as string })).find((t) => t.name === name && t.parentId === (state.parentId ?? null)) ?? null,
    },
    write: async (ctx) => {
      const { id, state, expectedVersion, principalId } = ctx;
      const deps = writeDeps({ ctx, gatewayDeps: required.gatewayDeps, entityType: "term" });
      const parentId = (state.parentId ?? null) as string | null;
      const saved = await importTerm({ deps, principalId, actor: ctx.deps.mutationActor, id, taxonomyId: state.taxonomyId as string, name: state.name as string, expectedVersion }, { parentId });
      return { version: saved.version };
    },
    errors,
  });
