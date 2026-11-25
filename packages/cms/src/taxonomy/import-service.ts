import type { MutationActor } from "@jini-ai/core/contracts/events";
import { checkedMutationActor } from "../core/mutation-actor.js";
import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
import { validateHierarchyAssignment, wouldCreateCycle } from "./validation-chain.js";
import type { Taxonomy, Term, TaxonomyRepoPort, TermRepoPort, WriteServiceDeps } from "./write-contracts.js";
import { TaxonomyVersionConflictError, authorizeTaxonomyManage, requireTaxonomy, resolveCandidateParent } from "./write-validation.js";

/**
 * Additive capability beyond the certified `TaxonomyRepoPort` — `findById`'s narrow return
 * (`{id, hierarchical, allowList?}`) doesn't carry `version`/`name`/`status`/`updatedAt`, which
 * `importTaxonomy`'s CAS check and update-in-place both need, and `insert`-only leaves no way to
 * write an existing row back. Same beyond-the-certified-port precedent as `DeletableTaxonomyRepoPort`.
 */
export interface ImportableTaxonomyRepoPort {
  findByIdFull({ id }: { id: string }): Promise<Taxonomy | null>;
  update(row: Taxonomy): Promise<unknown>;
}

export interface ImportTaxonomyRequired {
  deps: WriteServiceDeps & { taxonomies: TaxonomyRepoPort & ImportableTaxonomyRepoPort };
  principalId: string;
  /** Trusted attribution from the caller's execution channel (admin route `user`, assistant tool
   *  `agent`, publish/background `system`); its `id` must be `principalId`. Optional for now: omitted, the event records no actor. */
  actor?: MutationActor | undefined;
  /** The source's own id, preserved verbatim — unlike `createTaxonomy`, which always mints a fresh
   * one. Anything referencing this taxonomy by id (its member terms) needs it to survive a publish
   * round trip unchanged. */
  id: string;
  name: string;
  hierarchical: boolean;
  /** Same three-way CAS contract as `importEntry`'s `expectedVersion`: `undefined` means "this id
   * must not already exist" (import-as-create); a number means "a row at exactly this version must
   * exist" (import-as-update). Either mismatch is a `TaxonomyVersionConflictError`, never a silent
   * overwrite or a silent no-op. */
  expectedVersion: number | undefined;
}

/**
 * `importTaxonomy`/`importTerm`'s shared three-way CAS check (see
 * `ImportTaxonomyRequired.expectedVersion`): `undefined` requires that no row exists yet; a number
 * requires a row at exactly that version. Either mismatch is a `TaxonomyVersionConflictError`.
 */
function assertImportVersion(required: {
  entity: "taxonomy" | "term";
  id: string;
  expectedVersion: number | undefined;
  existing: { version: number } | null;
}): void {
  const { entity, id, expectedVersion, existing } = required;
  if (expectedVersion === undefined) {
    if (existing) {
      throw new TaxonomyVersionConflictError({ message: `${entity} '${id}' already exists, but no expectedVersion was supplied for import` });
    }
    return;
  }
  if (!existing) {
    throw new TaxonomyVersionConflictError({ message: `expected version ${expectedVersion} for ${entity} '${id}', but no such ${entity} exists` });
  }
  if (existing.version !== expectedVersion) {
    throw new TaxonomyVersionConflictError({ message: `expected version ${expectedVersion} for ${entity} '${id}', found ${existing.version}` });
  }
}

/**
 * Slice J1 — the publish-content import chokepoint for `taxonomies`. Address (name) uniqueness is
 * deliberately not checked here: the publish factory's own `address` precheck (F1's
 * `config.address`) owns that refusal before this is ever called, mirroring `importEntry`'s
 * identical split from slug-uniqueness.
 *
 * @complexity O(1) — one id lookup, one insert-or-update, one revision append, all outside a
 * transaction (this package has no SQLite adapter to open one against yet — see `repo.memory.ts`'s
 * header).
 */
export async function importTaxonomy(
  required: ImportTaxonomyRequired,
  _optional: Record<string, never> = {}
): Promise<Taxonomy> {
  const { deps, principalId, id, name, hierarchical, expectedVersion } = required;
  // The execution channel supplies attribution, the principal ID still governs authorization, and
  // the two are not interchangeable: refuse an actor naming someone else before any write.
  const actor = checkedMutationActor({ principalId, actor: required.actor });
  await authorizeTaxonomyManage(deps, principalId);

  const existing = await deps.taxonomies.findByIdFull({ id: id });
  assertImportVersion({ entity: "taxonomy", id, expectedVersion, existing });

  const now = kernelNowIso({ clock: deps.clock });
  const taxonomy: Taxonomy = {
    id,
    name,
    hierarchical,
    status: "active",
    updatedAt: now,
    version: existing ? existing.version + 1 : 1,
  };

  if (existing) {
    await deps.taxonomies.update(taxonomy);
  } else {
    await deps.taxonomies.insert(taxonomy);
  }
  await deps.revisions.insert({
    taxonomyId: taxonomy.id,
    op: "import",
    previousState: existing ? { name: existing.name, hierarchical: existing.hierarchical } : null,
    actorId: principalId,
    recordedAt: now,
  });
  await deps.stampWatermark({});
  await deps.outbox.enqueue({ event: { name: "taxonomy.imported", taxonomyId: taxonomy.id, actorId: principalId, ...(actor ? { actor } : {}), occurredAt: now } });

  return taxonomy;
}

/**
 * Additive capability beyond the certified `TermRepoPort` — `findById`'s narrow return
 * (`{id, taxonomyId, name?}`) doesn't carry `version`, which `importTerm`'s CAS check needs.
 * `TermRepoPort` already has `update`, unlike taxonomies, so no additive `update` is needed here.
 */
export interface ImportableTermRepoPort {
  findByIdFull({ id }: { id: string }): Promise<Term | null>;
}

/**
 * Loads `startId`'s ancestor chain (`termId -> parentId`, `startId` included) so the synchronous,
 * certified `wouldCreateCycle` walk can run over the destination's REAL tree. Stops at a root, a
 * missing row, or an already-seen id — the last bounds the loop against pre-existing malformed
 * parent data, mirroring `wouldCreateCycle`'s own `visited` guard.
 *
 * @complexity O(d) repo reads for a chain of depth `d`.
 */
async function loadAncestorChain(terms: ImportableTermRepoPort, startId: string): Promise<Map<string, string | null>> {
  const chain = new Map<string, string | null>();
  let current: string | null = startId;
  while (current !== null && !chain.has(current)) {
    const parentId: string | null = (await terms.findByIdFull({ id: current }))?.parentId ?? null;
    chain.set(current, parentId);
    current = parentId;
  }
  return chain;
}

export interface ImportTermRequired {
  deps: WriteServiceDeps & { terms: TermRepoPort & ImportableTermRepoPort };
  principalId: string;
  /** Trusted attribution from the caller's execution channel (admin route `user`, assistant tool
   *  `agent`, publish/background `system`); its `id` must be `principalId`. Optional for now: omitted, the event records no actor. */
  actor?: MutationActor | undefined;
  /** The source's own id, preserved verbatim — unlike `createTerm`, which always mints a fresh one. */
  id: string;
  taxonomyId: string;
  name: string;
  /** Same three-way CAS contract as `importTaxonomy.expectedVersion`. */
  expectedVersion: number | undefined;
}

export interface ImportTermOptional {
  parentId?: string | null | undefined;
}

/**
 * Slice J1 — the publish-content import chokepoint for `terms`. Address (name within
 * `(taxonomyId, parentId)`) uniqueness is the publish factory's own precheck, not this function's
 * job — same split as `importTaxonomy`/`importEntry`.
 *
 * Unlike `createTerm`, an import can MOVE an existing term (an import-as-update with a new
 * `parentId`), so the destination's real ancestor chain is loaded first (`loadAncestorChain`) and
 * handed to the certified `wouldCreateCycle` walk — a publish must never write a parent loop into
 * live taxonomy, where every tree walk over it would spin forever.
 *
 * @complexity O(d) — one taxonomy lookup, one id lookup, one optional parent lookup, `d` ancestor
 * lookups (the candidate parent's depth), one insert-or-update, one revision append.
 */
export async function importTerm(
  required: ImportTermRequired,
  optional: ImportTermOptional = {}
): Promise<Term> {
  const { deps, principalId, id, taxonomyId, name, expectedVersion } = required;
  const { parentId } = optional;
  // The execution channel supplies attribution, the principal ID still governs authorization, and
  // the two are not interchangeable: refuse an actor naming someone else before any write.
  const actor = checkedMutationActor({ principalId, actor: required.actor });
  await authorizeTaxonomyManage(deps, principalId);

  const taxonomy = await requireTaxonomy({ taxonomies: deps.taxonomies, taxonomyId });

  const existing = await deps.terms.findByIdFull({ id: id });
  assertImportVersion({ entity: "term", id, expectedVersion, existing });
  // A cross-taxonomy move would leave the term's children parented across taxonomies.
  // (Only reachable with a matched `expectedVersion`: an `undefined` one over an existing row has
  // already been refused above.)
  if (existing && existing.taxonomyId !== taxonomyId) {
    throw new TaxonomyVersionConflictError({ message: `term '${id}' belongs to taxonomy '${existing.taxonomyId}', not '${taxonomyId}'; an import cannot move a term between taxonomies` });
  }

  const candidateParentId = parentId ?? null;
  await validateImportedTermParent({ terms: deps.terms, taxonomyId, taxonomyIsHierarchical: taxonomy.hierarchical, termId: id, candidateParentId, isExistingTerm: existing !== null });

  return writeImportedTerm({ deps, principalId, actor, existing, term: { id, taxonomyId, parentId: candidateParentId, name } });
}

/**
 * `importTerm`'s hierarchy check: resolves the candidate parent and loads its REAL ancestor chain
 * (`loadAncestorChain`) so the certified `wouldCreateCycle` walk sees the destination's actual
 * tree — an import-as-update can move an existing term, unlike `createTerm`.
 */
async function validateImportedTermParent(required: {
  terms: TermRepoPort & ImportableTermRepoPort;
  taxonomyId: string;
  taxonomyIsHierarchical: boolean;
  termId: string;
  candidateParentId: string | null;
  isExistingTerm: boolean;
}): Promise<void> {
  const { terms, taxonomyId, taxonomyIsHierarchical, termId, candidateParentId, isExistingTerm } = required;
  const resolvedParent = await resolveCandidateParent({ terms, candidateParentId });
  const ancestors = candidateParentId === null ? new Map<string, string | null>() : await loadAncestorChain(terms, candidateParentId);

  validateHierarchyAssignment({
    childTaxonomyId: taxonomyId,
    taxonomyIsHierarchical,
    candidateParentId,
    resolvedParent,
    wouldCreateCycle: ({ candidateParentId }) => wouldCreateCycle({ termId, candidateParentId, tree: { getParentId: ({ termId }) => ancestors.get(termId) ?? null } }),
    termId: isExistingTerm ? termId : "__new__",
  });
}

/** `importTerm`'s write half: insert-or-update at the next version, one `"import"` revision
 * carrying the pre-import name/parentId (or `null` on a create), watermark, outbox. */
async function writeImportedTerm(required: {
  deps: ImportTermRequired["deps"];
  principalId: string;
  actor: MutationActor | undefined;
  existing: Term | null;
  term: { id: string; taxonomyId: string; parentId: string | null; name: string };
}): Promise<Term> {
  const { deps, principalId, actor, existing } = required;
  const { id, taxonomyId, parentId, name } = required.term;
  const now = kernelNowIso({ clock: deps.clock });
  const term: Term = {
    id,
    taxonomyId,
    parentId,
    name,
    status: "active",
    updatedAt: now,
    version: existing ? existing.version + 1 : 1,
  };

  if (existing) {
    await deps.terms.update(term);
  } else {
    await deps.terms.insert(term);
  }
  await deps.revisions.insert({
    taxonomyId,
    op: "import",
    previousState: existing ? { name: existing.name, parentId: existing.parentId } : null,
    actorId: principalId,
    recordedAt: now,
  });
  await deps.stampWatermark({});
  await deps.outbox.enqueue({ event: { name: "taxonomy.term_imported", termId: term.id, actorId: principalId, ...(actor ? { actor } : {}), occurredAt: now } });

  return term;
}
