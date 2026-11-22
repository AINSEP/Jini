import type { ISODateTime, UUID } from "@jini-ai/core/primitives";

/**
 * @file GitHub provider input records: in-memory contracts, not persisted records.
 * Releases name existing artifacts for promotion; the provider does not build those artifacts.
 */

/** Open string, not a closed union — see `Jini packages/commerce/src/payments/ports.ts`'s `PaymentProviderId`
 * for why (a closed union makes every new provider a core edit). `"github"` is the only value with
 * a real adapter this pass (`@jini-ai/agent-plugins/github/deployments/github.mjs`). */
export type DeploymentProviderId = DeploymentTargetRecord["providerId"];


/** One provider connection, scoped to a single environment. `config` carries non-secret provider
 * config only (repo owner/name, GitHub environment name); the adapter receives credentials
 * separately through DeploymentProviderContext. This contract has no table writer. */
export interface DeploymentTargetRecord {
  readonly workspaceId: UUID;
  readonly id: UUID;
  readonly environmentId: UUID;
  readonly providerId: string;
  readonly label: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
  readonly createdAtIso: ISODateTime;
  readonly version: number;
}

/** What a release promotes. `git-revision` is the only kind a first-party adapter accepts this
 * adapter — its role is to promote a commit that already exists. `external-artifact` is declared for a future non-GitHub provider (e.g. one
 * that accepts a pre-built tarball URL) and is deliberately rejected by `@jini-ai/agent-plugins/github/deployments/github.mjs`. */
export type ReleaseSource =
  | { readonly kind: "git-revision"; readonly repoUrl: string; readonly commitSha: string }
  | { readonly kind: "external-artifact"; readonly uri: string; readonly checksum?: string };

/** An immutable, workspace-scoped artifact IDENTITY — "this is the thing that gets promoted". It
 * records a reference to an artifact that already exists; it does not construct one. */
export interface ReleaseRecord {
  readonly workspaceId: UUID;
  readonly id: UUID;
  readonly label: string;
  readonly source: ReleaseSource;
  readonly createdByPrincipalId: UUID;
  readonly createdAtIso: ISODateTime;
  readonly version: number;
}

/** The host's own normalized run status. Providers report a wider, provider-specific state (GitHub's
 * real deployment-status enum has seven values — see `@jini-ai/agent-plugins/github/deployments/github.mjs`'s
 * `mapGitHubDeploymentStatus`) and every adapter narrows it down to this closed set. */
export type DeploymentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
