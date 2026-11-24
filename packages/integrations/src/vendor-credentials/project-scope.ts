import type { KeyringPort, SecretSealerPort } from "../secrets/ports.js";

/**
 * @file Shared scope policy for custom, publish and source-control credentials. Site-owned keys
 * remain in place and take precedence; only explicitly granted owner rows are a fallback.
 * New keys may be saved to the owner store through a create-only port, or explicitly to the site.
 * Earlier boot adoption removed local overrides to prevent copied keys bypassing revoke. Adoption
 * is retired: grants govern shared rows only, and existing local keys remain independently owned.
 */

/** This site's own vault, or the project store every site of the project shares (the host's project database). */
export type CredentialScope = "site" | "project";

/**
 * A store's project half: the same repo shape over the project's own `secrets_vault`, opened with the
 * project's keyring and sealer, under the project's workspace id. Jini derives the sealing key from
 * the store's key and the row's AAD binds its workspace, so a project row opens only with these.
 */
export interface CredentialProjectHalf<R> {
  readonly workspaceId: string;
  readonly repo: R;
  /** Trusted human replacement only; the adapter still requires the current site grant. */
  readonly replaceRepo?: R;
  readonly createRepo?: R;
  readonly sealer: SecretSealerPort;
  readonly keyring: KeyringPort;
}

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
