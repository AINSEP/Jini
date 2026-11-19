import { ForbiddenError } from "../core/commands/command.js";
import type { TaxonomyRepoPort, TermRepoPort, WriteServiceDeps } from "./write-contracts.js";

export class TaxonomyRecordNotFoundError extends Error {
  constructor(requiredArgs: { message: string }, optionalArgs: Record<string, never> = {}) {
    const { message } = requiredArgs;
    super(message);
    this.name = "TaxonomyRecordNotFoundError";
  }
}

export class TermRecordNotFoundError extends Error {
  constructor(requiredArgs: { message: string }, optionalArgs: Record<string, never> = {}) {
    const { message } = requiredArgs;
    super(message);
    this.name = "TermRecordNotFoundError";
  }
}

/** Finding 1 fix — the target of an `assignTerms` call does not resolve to any real content row. */
export class ContentRecordNotFoundError extends Error {
  constructor(requiredArgs: { message: string }, optionalArgs: Record<string, never> = {}) {
    const { message } = requiredArgs;
    super(message);
    this.name = "ContentRecordNotFoundError";
  }
}

/**
 * J1 (plan-publish-all-types-2026-09-25.md) — `importTaxonomy`/`importTerm`'s optimistic-concurrency
 * rejection. Neither `Taxonomy` nor `Term` had a version-checked write before this slice
 * (`createTaxonomy`/`createTerm` always insert a fresh row; `renameTerm` doesn't check a caller-
 * supplied version either), so this is a new class rather than a reused one — `content-types`' and
 * `entries`' own `VersionConflictError`s are each that package's own, per this file's header's
 * "catch the one it actually called into" rule.
 */
export class TaxonomyVersionConflictError extends Error {
  constructor(requiredArgs: { message: string }, optionalArgs: Record<string, never> = {}) {
    const { message } = requiredArgs;
    super(message);
    this.name = "TaxonomyVersionConflictError";
  }
}

/** `admin.taxonomy.manage` (the flat-string permission convention) — must run before any other
 * side effect of every write-service export in this file. */
export async function authorizeTaxonomyManage(deps: WriteServiceDeps, principalId: string): Promise<void> {
  const result = await deps.authorize({ principalId, permission: "admin.taxonomy.manage" });
  if (!result.allowed) {
    throw new ForbiddenError({
      message: `principal '${principalId}' is not authorized for 'admin.taxonomy.manage' (${result.reason})`,
      permission: "admin.taxonomy.manage",
      reason: result.reason,
    });
  }
}

/** The owning-taxonomy lookup `createTerm`/`importTerm` both run before touching any term. */
export async function requireTaxonomy(required: { taxonomies: TaxonomyRepoPort; taxonomyId: string }): Promise<{ id: string; hierarchical: boolean }> {
  const { taxonomies, taxonomyId } = required;
  const taxonomy = await taxonomies.findById({ id: taxonomyId });
  if (!taxonomy) {
    throw new TaxonomyRecordNotFoundError({ message: `taxonomy '${taxonomyId}' was not found` });
  }
  return taxonomy;
}

/** `validateHierarchyAssignment`'s `resolvedParent` input: `"not-applicable"` when no parent was
 * requested, `null` when the requested parent does not exist, else its id + taxonomy. */
export async function resolveCandidateParent(required: {
  terms: TermRepoPort;
  candidateParentId: string | null;
}): Promise<{ id: string; taxonomyId: string } | null | "not-applicable"> {
  const { terms, candidateParentId } = required;
  if (candidateParentId === null) return "not-applicable";
  const parentTerm = await terms.findById({ id: candidateParentId });
  return parentTerm ? { id: parentTerm.id, taxonomyId: parentTerm.taxonomyId } : null;
}
