import type { CredentialScope, CredentialProjectHalf } from "@jini-ai/core/contracts/site/credential-project-half";
export type { CredentialScope, CredentialProjectHalf };

/**
 * @file Shared scope policy for custom, publish and source-control credentials. Site-owned keys
 * remain in place and take precedence; only explicitly granted owner rows are a fallback.
 * New keys may be saved to the owner store through a create-only port, or explicitly to the site.
 * Earlier boot adoption removed local overrides to prevent copied keys bypassing revoke. Adoption
 * is retired: grants govern shared rows only, and existing local keys remain independently owned.
 */

/** One store a site reads credentials from, with the deps (repo, sealer, keyring) that open its rows. */
export interface ScopedCredentialDeps<D> { readonly deps: D; readonly workspaceId: string; readonly scope: CredentialScope }

type WithProject = { readonly repo: { readonly project?: CredentialProjectHalf<unknown> } };

/**
 * The stores a site reads: its own vault first, followed by its granted owner half.
 * The host's composition root attaches that owner half (its `credentialProject` dep), if any.
 * @complexity O(1).
 */
export function credentialScopes<D extends WithProject>({ deps, workspaceId }: { deps: D; workspaceId: string }, _optional = {}): ScopedCredentialDeps<D>[] {
  const site: ScopedCredentialDeps<D> = { deps, workspaceId, scope: "site" };
  const project = deps.repo.project;
  if (!project) return [site];
  return [site, { deps: { ...deps, repo: project.repo, sealer: project.sealer, keyring: project.keyring } as D, workspaceId: project.workspaceId, scope: "project" }];
}

/**
 * Where a new row is written: the configured owner store, or the site vault on remote hosts
 * without an owner store. An explicit local save remains local even with an owner store configured.
 * @throws The store's own validation error (`invalid`) when `scope` is neither omitted, `"site"` nor `"project"`.
 */
export function credentialCreateTarget<D extends WithProject>({ deps, input, invalid }: { deps: D; input: { workspaceId: string; scope?: unknown }; invalid: (message: string) => Error }, _optional = {}): ScopedCredentialDeps<D> {
  if (input.scope !== undefined && input.scope !== "site" && input.scope !== "project") throw invalid('scope must be "site" or "project"');
  const owner = deps.repo.project;
  if (!owner || input.scope === "site") return { deps, workspaceId: input.workspaceId, scope: "site" };
  const project = credentialScopes({ deps, workspaceId: input.workspaceId })[1];
  if (project === undefined) throw new Error("Project credential store has no project scope");
  // Human save adapters use the separate owner mutation port; runtime reads retain the site view.
  if (!owner.createRepo) return project;
  return { ...project, deps: { ...project.deps, repo: owner.createRepo } as D };
}
