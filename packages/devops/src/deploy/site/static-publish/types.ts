import type { DeployTargetDescriptor } from "../deploy-targets/types.js";
import type { ToolFailureDiagnostic } from "@jini-ai/core/contracts/site/daemon-tool-recovery";
import type { UUID } from "@jini-ai/core/primitives";

/**
 * @file Domain types for one-shot static-site publishing through a deploy target an Agent Plugin
 * contributes (`../deploy-targets/`).
 *
 * Purpose:
 * Deliberately separate from this directory's sibling `../types.ts`/`../ports.ts`
 * (`DeploymentProviderPort`/`DeploymentTargetRecord`) — that machinery promotes an EXISTING git
 * commit through a GitHub App (`@jini-ai/agent-plugins/github/deployments/github.mjs`), continuous-deployment-shaped. This
 * feature does the opposite: it takes the host's own static export (`src/features/site-export`'s `exportSite`, bytes
 * this process just rendered, never a pre-existing commit) and hands the file set to a devops
 * `DeployTarget` — a one-shot "publish this exact file set" operation with no polling-run/webhook
 * lifecycle of its own. Two genuinely different problems that happen to share the word "deploy".
 *
 * How it relates to the project:
 * Target ids are OPEN strings (deploy plan T7): the set of targets, and each target's config
 * fields, come from the deploy-target registry at runtime, which validates them at every entry point
 * (`adapter.ts`'s `planStaticPublish`). Ids stay byte-identical to the historical provider ids:
 * sealed credentials and publish history rows are keyed by them.
 *
 * Architectural role:
 * Domain types only — no I/O.
 */

/** A deploy target id the registry knows (lowercase hyphenated). */
export type StaticPublishTargetId = DeployTargetDescriptor["id"];

/**
 * One publish's target and its descriptor-declared config fields, all strings. `basePath` is
 * deliberately NOT a field — the target module derives it, which is what makes "export base path
 * doesn't match the publish target" structurally impossible rather than merely documented.
 */
export interface StaticPublishConfig {
  readonly target: StaticPublishTargetId;
  readonly [field: string]: string | undefined;
}

/** Every outcome this feature returns to a caller (admin route JSON, agent tool result) — never a
 *  `DeployFile`, never a token, never a raw upstream error body.
 *
 * THREE outcomes, not two — `ok` is `true | false | "partial"`, never merely a boolean. Spec
 * `custom-publish-provider-contract.md` §3a names the exact failure mode this third state exists to
 * prevent: uploading objects to a bucket does not, by itself, make them servable — a bucket is private
 * by default on every S3-compatible provider, so "the PUT calls all succeeded" and "a human can
 * actually load this site" are genuinely different claims. Folding "uploaded fine, but not reachable
 * yet" into `ok: true` would be a false "Published" success pointing at a URL that 404s; folding it
 * into `ok: false` would hide that the upload itself DID succeed (nothing needs re-uploading, only the
 * hosting/public-access step is missing — see `deployment_generate_bucket_hosting_setup`, spec §3a).
 * Neither existing branch is honest here, so this is a genuine third branch, not a reuse of either.
 *
 * `adapter.ts`'s `publishStaticSite` is the one place this is decided, from the SAME
 * `DeployPublishResult.status` field every target (not only s3-compatible) already returns — see that
 * function's own doc for why the check applies uniformly rather than being special-cased per target. */
export type StaticPublishOutcome =
  | {
      readonly ok: true;
      /** Saved connection used for this run; absent for environment credentials. */
      readonly credentialId?: UUID;
      readonly targetId: StaticPublishTargetId;
      readonly url: string;
      readonly status: string;
      readonly deploymentId?: string;
      /** The base path this publish's export was rewritten for — e.g. `/${repo}` for a host that
       *  serves the site under a repository subpath; absent for a host serving it at the root. Echoed back so a caller can show "published at /repo" without having to
       *  re-derive the same computation this module already did. */
      readonly basePath?: string;
      readonly consentWarning?: string;
      /** The host's own facts about this publish (`DeployPublishResult.providerMetadata`), e.g. the
       *  repository and commit a git-backed host wrote. Carried into publish history. */
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
    }
  | {
      /** "Uploaded, not yet reachable" — see this type's own header. Every field below has the exact
       *  same meaning as the `ok: true` branch's namesake field; only the discriminant and `message`
       *  are new, so a caller migrating from a boolean-only reading of `ok` gets a compile error
       *  (an unhandled union member) rather than a silent misclassification. */
      readonly ok: "partial";
      readonly credentialId?: UUID;
      readonly targetId: StaticPublishTargetId;
      readonly url: string;
      readonly status: string;
      readonly message: string;
      readonly deploymentId?: string;
      readonly basePath?: string;
      readonly consentWarning?: string;
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly ok: false;
      readonly code: "INVALID_CONFIG" | "NO_CREDENTIALS_CONFIGURED" | "EXPORT_FAILED" | "PROVIDER_ERROR";
      readonly credentialSetup?: ToolFailureDiagnostic;
      readonly message: string;
    };

/**
 * Resolves the bearer token for one publish target, and separately answers whether one is even
 * configured. `credentials.ts`'s `createEnvPublishCredentialSource` is the env-var implementation;
 * `publish-credentials`'s DB-backed source (2026-08-15, ADR-058-pattern encrypted store) is the
 * second — both implement this same interface so no caller changes when the composition between them
 * changes.
 *
 * TWO separate methods, not one, on purpose (2026-08-15 split, Terra's design): {@link resolve}
 * is the ONLY one of the two that may decrypt/expose a real credential, and must never expose usable credentials to a status display or model. Authenticated provider inspection
 * may resolve server-side for read-only API calls; local readiness previews still use isConfigured.
 * {@link isConfigured} answers the read-only "would a publish work" question every preview/education
 * surface actually needs, without decrypting anything (the DB-backed source's `isConfigured` only
 * ever calls `describeCredential`-shaped reads — never `resolveForPublish`). Before this split, the
 * only method was `resolve()`, and the admin preview route called it just to read `.ok` off the
 * result — harmless while the only implementation was a plain `process.env` read, but it would have
 * meant a REAL decrypt on every preview once a DB-backed source existed.
 *
 * `resolve()`'s success ({@link ResolvedPublishCredentialSuccess}) is flat: `token` (the host
 * descriptor's `credential.tokenField`, e.g. the secret half of an access-key pair) plus every other
 * field that host's credential declares, under its own name. Core names none of them; the host's
 * deploy module reads what it needs.
 */
export type PublishVerificationBasis = { readonly id: UUID; readonly revision: number } | { readonly kind: "env" };

/** {@link PublishCredentialSource.resolve}'s success: `token` plus the host's other declared credential
 *  fields. `true` is in the index type only so `ok` itself fits it; every field is a string. */
export type ResolvedPublishCredentialSuccess = {
  readonly ok: true;
  readonly token: string;
  readonly basis: PublishVerificationBasis;
  /** Saved row actually resolved, including default selection; absent for environment credentials. */
  readonly credentialId?: UUID;
} & Readonly<Record<string, string | true | PublishVerificationBasis | undefined>>;

export interface PublishCredentialSource {
  /**
   * @param input.credentialId - OPTIONAL id of the saved connection the OPERATOR chose for this one
   *   publish (terra review 2026-09-20, finding 1 — Critical). When present, an implementation must
   *   resolve THAT connection or refuse: never the provider's current default, and never a fallback
   *   source. The silent "whichever row is `is_default` when the publish POST lands" resolution this
   *   parameter replaces is the defect itself — a publish fired while a "make this one the default"
   *   promotion was still in flight went to the PREVIOUS account. Absent means the caller genuinely
   *   has no chosen connection (the `deployment_execute_static_publish` agent tool, and any admin
   *   install whose credentials come from server env vars, which have no ids), and the established
   *   default lookup applies unchanged.
   *
   *   UNTRUSTED input: it arrives from an HTTP body. An implementation must scope its lookup to
   *   `workspaceId` and verify the row's own provider matches `target` before resolving anything —
   *   a request naming another workspace's credential id must refuse, not publish.
   */
  resolve(input: { workspaceId: UUID; target: StaticPublishTargetId; credentialId?: UUID }): Promise<
    ResolvedPublishCredentialSuccess | { readonly ok: false; readonly reason: string }
  >;
  /** Read-only, never decrypts. `reason` (when `configured` is `false`) is the same human-readable,
   *  non-secret guidance `resolve()`'s own `{ok:false}.reason` carries — safe to show in an admin UI
   *  or hand to an agent tool. */
  isConfigured(input: { workspaceId: UUID; target: StaticPublishTargetId }): Promise<
    { readonly configured: true; readonly basis: PublishVerificationBasis } | { readonly configured: false; readonly reason: string }
  >;
}
