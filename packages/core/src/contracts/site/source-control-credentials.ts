import type { Clock, ISODateTime, UUID } from "../../primitives/index.js";
import type { VaultContext, VaultRepoPort, VaultSummary, KeyringPort, SecretSealerPort, SealedSecret } from "../vault.js";
import type { SecretsVaultService } from "./secrets-credential-sets.js";
import type { CredentialTokenHint, CredentialConnection } from "./secrets-credential-token.js";
import type { CredentialProjectHalf } from "./credential-project-half.js";

/** Source-control identities are separate from deploy targets: they carry authentication,
 * never a repository, owner or branch. The store seals the complete connection as one blob.
 * Provider ids and saved fields remain opaque when their plugin is absent. */
export type SourceControlProviderId = string;

/** New writes follow the provider's existing credential declaration; persisted fields survive reads. */
export interface SourceControlConnectionInput {
  readonly providerId: SourceControlProviderId;
  readonly token: string;
  readonly [field: string]: string;
}

/** A `source_control_credential_sets` row, decrypted-shape (`sealed` is the DB's opaque
 *  `SealedSecret` — nothing in this feature decrypts it yet; see this file's header on the
 *  connect-an-identity-only scope). */
export interface SourceControlCredentialSetRecord {
  readonly tokenHint?: CredentialTokenHint | null;
  readonly workspaceId: UUID;
  readonly id: UUID;
  readonly providerId: SourceControlProviderId;
  readonly label: string;
  readonly sealed: SealedSecret;
  /** At most one `TRUE` per `(workspaceId, providerId)`, maintained by `store.ts`'s write path —
   *  see `src/platform/db/schema.sqlite.ts`'s `sourceControlCredentialSets.isDefault` doc. */
  readonly isDefault: boolean;
  /** Verified account label, or null when no provider identity probe succeeds. */
  readonly accountLabel: string | null;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

/** The read model every route in this feature returns — see `store.ts`'s `toSummary`. NEVER
 *  contains `sealed`, a token, or any `SourceControlConnectionInput` field — enforced by
 *  construction: this type has no field capable of carrying one. */
export interface SourceControlCredentialSummary {
  readonly tokenHint?: CredentialTokenHint | null;
  readonly connection?: CredentialConnection;
  readonly id: UUID;
  readonly providerId: SourceControlProviderId;
  readonly label: string;
  readonly configured: true;
  readonly isDefault: boolean;
  /** See `SourceControlCredentialSetRecord.accountLabel`'s own doc — carried through unchanged. */
  readonly accountLabel: string | null;
  /** Where the row lives — present only where a project store is attached (local web + desktop):
   *  `"project"` is visible to attached sites only, `"site"` is this site's own (an override). */
  readonly scope?: "site" | "project";
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

/** Workspace-scoped persistence for {@link SourceControlCredentialSetRecord} (ADR-007 §1). `insert`
 *  assumes the caller already checked/accepted the `(workspaceId, providerId, label)` UNIQUE
 *  constraint may reject it — see `store.ts`'s `isUniqueLabelViolation` for how that DB error is
 *  turned into `SourceControlCredentialDuplicateLabelError` rather than propagated as a raw driver
 *  error.
 *
 * `insert`/`update`/`delete` ALSO own the `isDefault` invariant, mirroring
 * `VendorCredentialSetRepoPort`'s own contract exactly: if the written `record.isDefault` is
 * `true`, `insert`/`update` atomically clear `isDefault` on every OTHER row sharing
 * `(workspaceId, providerId)`, in the SAME transaction as the write. `delete` promotes the group's
 * most-recently-updated remaining row to default if the deleted row WAS the default. */
/** The host binds provider-declared API-key identities once for every source-control reader. */
export interface CanonicalSourceControlKeys {
  supports(input: { providerId: string }, options?: Record<string, never>): boolean;
  describe(input: { workspaceId: string; providerId: string }, options?: Record<string, never>): Promise<Pick<SourceControlCredentialSetRecord, "id" | "label" | "providerId"> | null>;
  resolve(input: { workspaceId: string; providerId: string }, options?: Record<string, never>): Promise<{ id: string; label: string; connection: SourceControlConnectionInput } | null>;
  create?(input: { workspaceId: string; connection: SourceControlConnectionInput }, options?: { signal?: AbortSignal }): Promise<SourceControlCredentialSummary>;
  /** The site's own and granted canonical keys, one safe row per stable id; never opens a key. */
  list(input: { workspaceId: string }, options?: Record<string, never>): Promise<SourceControlCredentialSummary[]>;
  /** `owned: false` only when this store holds no canonical key with that id for the site. An owned key
   *  that is refused or fails throws, so the caller never retries it as a legacy row. */
  update(input: { workspaceId: string; id: string; patch: SourceControlCredentialPatch }, options?: Record<string, never>): Promise<CanonicalSourceControlUpdate>;
  /** Same ownership contract as {@link CanonicalSourceControlKeys.update}; key-deletion rules still apply. */
  remove(input: { workspaceId: string; id: string }, options?: Record<string, never>): Promise<{ readonly owned: boolean }>;
}

/** The vault/scope/hint collaborator a credential repo carries, bound to that repo's own vault rows where the
 * host composition root builds the repo. Policy (Tovu's credential kinds, owner key, typed storage errors) lives with
 * the binding's owner; this store only says which typed error a storage failure becomes. */
export interface CredentialVaultBinding {
  open(required: { repo: { vault?: VaultRepoPort }; sealer?: SecretSealerPort; keyring?: KeyringPort; clock?: Clock; idGen?: { newId(): string }; storageError: () => Error }, optional?: Record<string, never>): SecretsVaultService;
  scope(required: { workspaceId: string; kind: "vendor" | "custom" | "source-control"; id?: string }, optional?: Record<string, never>): VaultContext & { id?: string };
  hint(required: { record: Pick<VaultSummary, "tokenLength" | "last4"> }, optional?: Record<string, never>): CredentialTokenHint | null;
}

/** The editable fields of a Source Control credential, as the update route receives them. */
export type SourceControlCredentialPatch = { label?: unknown; connection?: unknown; isDefault?: unknown };

/** "Not owned by this store" is the only result that may fall back to the legacy table. */
export type CanonicalSourceControlUpdate = { readonly owned: false } | { readonly owned: true; readonly summary: SourceControlCredentialSummary };

export interface SourceControlCredentialSetRepoPort {
  /** Absent only on a hand-built fake; every store read or write then refuses as an unconfigured vault. */
  readonly credentialVault?: CredentialVaultBinding;
  readonly canonical?: CanonicalSourceControlKeys;
  readonly vault?: VaultRepoPort;
  /** The project store this site's rows fall back to (`store.ts`'s scope rule, shared in
   *  `@jini-ai/integrations/vendor-credentials/project-scope`: site first, then attached project rows; new rows go to the project
   *  unless saved "only for this site"). Absent = site only (Fly/production). */
  readonly project?: CredentialProjectHalf<SourceControlCredentialSetRepoPort>;
  insert(record: SourceControlCredentialSetRecord): Promise<void>;
  /** Full-row replace by `(workspaceId, id)` — used for both a label rename and a connection
   *  rotation. Same UNIQUE-violation possibility as `insert` (renaming into another row's label). */
  update(record: SourceControlCredentialSetRecord): Promise<void>;
  /** Probe metadata must never replace a token rotated while the network request was pending.
   * Adapters may omit this best-effort capability; a save still returns the verified label. */
  updateAccountLabel?(input: { workspaceId: UUID; id: UUID; accountLabel: string; expectedSealed?: SealedSecret }, optional?: {}): Promise<void>;
  findById(input: { workspaceId: UUID; id: UUID }): Promise<SourceControlCredentialSetRecord | null>;
  /** The current default row for one `(workspaceId, providerId)` pair — `null` if that provider has
   *  no rows at all for this workspace. */
  findDefaultByProvider(input: { workspaceId: UUID; providerId: SourceControlProviderId }): Promise<SourceControlCredentialSetRecord | null>;
  /** Every row for one `(workspaceId, providerId)` pair — used by `store.ts`'s write path to decide
   *  "is this the group's first row" (create-time auto-default) and, ahead of `delete`, to reason
   *  about the promotion candidate. */
  listByProvider(input: { workspaceId: UUID; providerId: SourceControlProviderId }): Promise<SourceControlCredentialSetRecord[]>;
  /** Every credential set a workspace has saved, across all providers — inherently small (bounded
   *  by how many connections a human bothers to save through this exact form), so no
   *  pagination/cap is added here. */
  listByWorkspace(input: { workspaceId: UUID }): Promise<SourceControlCredentialSetRecord[]>;
  /** No-op (not an error) if no row exists for `(workspaceId, id)` — matches this feature's own
   *  `DELETE .../credentials/:id` route contract (204, idempotent). */
  delete(input: { workspaceId: UUID; id: UUID }): Promise<void>;
}
