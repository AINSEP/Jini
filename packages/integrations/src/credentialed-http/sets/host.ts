import type { CredentialSetKeyringPort, CredentialSetProjectScope, CredentialSetRepoPort, CredentialSetScope } from "@jini-ai/core/contracts/credentials";
import type { SecretSealerPort, VaultContext, VaultErrorCode, VaultIdentity, VaultMeta, VaultPutRecord, VaultSummary } from "@jini-ai/core/contracts/vault";

/**
 * @file Host-input contracts for the credential-set store and vault adapter. Every product value
 * (owner key, metadata policy, categories, scope policy, error factories, wording) is a REQUIRED
 * host input; this module has no default for any of them. Types only.
 * Provenance: moved unchanged (EXTRACT-S8 C1 move) from the first host's credential-set seam file
 * `sets/host.ts` at its commit 43a0e5d4; earlier history lives in that host's repository.
 */

/**
 * @agent-note Canonical vault errors. `create` MUST return the host's canonical vault error
 * (the same class its vault service throws) so callers keep one identity per code; `codeOf` MUST
 * recognize exactly those errors and return `undefined` for anything else.
 */
export interface CredentialSetVaultErrors {
  create(required: { code: VaultErrorCode }, optionalArgs?: Record<string, never>): Error;
  codeOf(error: unknown): VaultErrorCode | undefined;
}

/**
 * @agent-note Trusted row policy, fixed by the host's composition root and never taken from model
 * or request input. Rows are accepted only with this `ownerKey`, a null principal, binding and
 * provider, and kind `vendor` (with `meta.credentialType === "custom"`) or legacy kind `custom`.
 * The legacy kind is a read bridge, not a rewrite: the stored kind authenticates old envelopes (AAD),
 * so writes keep it. `parseMeta` must be the same complete-shape parser the host's vault service
 * uses for that kind; frozen stored metadata must keep parsing unchanged. `labelConflict` is the
 * host's historical raw UNIQUE error for a label collision detected as a vault CAS conflict.
 */
export interface CredentialSetVaultPolicy {
  readonly ownerKey: string;
  parseMeta(input: { kind: "vendor" | "custom"; meta: unknown; provider?: string | null }): VaultMeta;
  compareLabels(a: { label: string }, b: { label: string }): number;
  readonly vaultErrors: CredentialSetVaultErrors;
  labelConflict(required: Record<string, never>): Error;
}

/** @agent-note Indexed, authorization-preserving label lookup over the SAME vault the repo holds. */
export type CredentialSetRowByLabel = (input: { workspaceId: string; label: string }) => Promise<VaultPutRecord | null>;

/** The deps object a scope carries: at least a repo (with an optional project half). */
export interface CredentialSetScopeCarrier { readonly repo: { readonly project?: CredentialSetProjectScope<string> } }

/** One store a site reads credentials from, with the deps that open its rows. */
export interface CredentialSetScoped<D> { readonly deps: D; readonly workspaceId: string; readonly scope: CredentialSetScope }

/** @agent-note The host's vault service, already constrained to one owner/kind. Must authorize the full
 *  expected context before sealing/opening and map only crypto failures to the host storage error. */
export interface CredentialSetVaultService {
  prepare(input: CredentialSetPrepareInput): Promise<VaultPutRecord>;
  get(input: VaultIdentity): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null>;
}

/** One validated create/replace: full expected context, CAS revision, metadata and optional new token. */
export type CredentialSetPrepareInput = VaultContext & {
  id: string; expectedRevision: number | null; provider: null; label: string; meta: VaultMeta;
  payload?: { token: string }; hintToken?: string;
};

/** Deps the vault opener receives: the repo the row lives in and the store's own crypto ports. */
export interface CredentialSetOpenDeps<C extends string> {
  repo: CredentialSetRepoPort<C>;
  sealer: SecretSealerPort;
  keyring?: CredentialSetKeyringPort;
  clock?: { nowMs(): number };
}

/**
 * @agent-note Everything product-specific the credential-set store needs. Scope policy order is
 * site first, then the granted project half; `createTarget` writes to the project store unless the
 * caller asked for the site. Token policy (normalization, secret-free field checks, including any
 * host secret detectors) runs in the same order as before and its input errors are re-thrown as the
 * store's validation error with the same message. All `messages` are host wording returned verbatim.
 */
export interface CredentialSetStoreHost<C extends string> {
  readonly vault: CredentialSetVaultPolicy;
  openVault(required: { deps: CredentialSetOpenDeps<C>; kind: "vendor" | "custom" }): CredentialSetVaultService;
  scopes<D extends CredentialSetScopeCarrier>(deps: D, workspaceId: string): CredentialSetScoped<D>[];
  createTarget<D extends CredentialSetScopeCarrier>(deps: D, input: { workspaceId: string; scope?: unknown }, invalid: (message: string) => Error): CredentialSetScoped<D>;
  isUniqueViolation(error: unknown): boolean;
  /** The host's own "create port refused this label/identity" error; its message is kept. */
  isCreateConflict(error: unknown): error is Error;
  readonly token: {
    normalize(required: { value: unknown }): string;
    assertFreeField(required: { value: string; field: string }): void;
    isInputError(error: unknown): error is Error;
  };
  /** Canonical provider-id parser; throws the host's canonical vault error on invalid input. */
  normalizeWorksFor(required: { value: unknown }): string[];
  readonly categories: readonly C[];
  readonly messages: CredentialSetStoreMessages;
}

/** @agent-note Host wording, verbatim. Product names, codes and help text belong here, never in this module. */
export interface CredentialSetStoreMessages {
  readonly storage: string;
  readonly worksForInvalid: string;
  readonly sharedReplacementReadOnly: string;
  readonly sharedDeleteReadOnly: string;
  duplicateLabel(required: { label: string }): string;
  projectDuplicateLabel(required: { label: string }): string;
  notFound(required: { id: string }): string;
}
