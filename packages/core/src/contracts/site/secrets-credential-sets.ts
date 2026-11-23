import type {
  SecretSealerPort,
  VaultContext,
  VaultCopyResult,
  VaultDefaultQuery,
  VaultIdentity,
  VaultMeta,
  VaultOptions,
  VaultPutRecord,
  VaultQuery,
  VaultSummary,
} from "../vault.js";

/**
 * @file The shared credential-vault service as a port. Types only.
 *
 * `@jini-ai/platform/secrets/credential-sets` declares `SecretsVaultService` as a class (the runtime
 * implementation). This is its public method surface, signature for signature, plus the three input
 * shapes copied verbatim, so a consumer that only holds a vault can name it without the runtime
 * package. The class satisfies this interface structurally; its injected deps stay private to it.
 */

export interface VaultPutInput extends VaultContext {
  /** Omit for creation with an injected ID. Replacement requires id and expectedRevision. */
  id?: string;
  expectedRevision: number | null;
  provider: string | null;
  label: string;
  meta: unknown;
  /** null clears; omitted on replacement preserves the envelope/hint without opening or sealing.
   * Creation requires a payload (which may be null). Payloads are always sealed JSON.
   */
  payload?: VaultMeta | null | undefined;
  /** Omitted preserves same-group default status; creation/provider moves let the repository
   * apply its first-row rule. Explicit false opts out; true selects the destination default.
   */
  isDefault?: boolean | undefined;
  /** A host-selected token, never a URI or serialized connection object. */
  hintToken?: string;
}
export interface VaultCopyInput {
  /** This service owns the source repository, authorization and keyring-backed sealer. */
  source: SecretsVaultService;
  sourceContext: VaultContext;
  targetContext: VaultContext;
  ids: readonly string[];
  overwrite: boolean;
  /** Optional selection-time guard; otherwise the revisions read by this operation are used. */
  sourceRevisions?: Readonly<Record<string, number>>;
}

export interface VaultRotateOptions {
  /** Opens the STORED row when it was sealed under a key the service's own `sealer` cannot open any
   * more (a key switch). It is used for that one read only: the service's `sealer` still seals the new
   * envelope and verifies it, so `deps.sealer.open` always means "open with the current keyring". */
  sourceOpener?: Pick<SecretSealerPort, "open">;
}

/** Shared vault lifecycle. Policy/catalogs are injected; persistence and encryption are ports.
 * Expected context is checked before opening. Normal reads have no legacy-AAD fallback.
 * Metadata reads never need keys, and every merged patch is parsed before CAS persistence.
 */
export interface SecretsVaultService {
  /** Create/replace configuration and a sealed JSON payload. Throws on policy, validation or CAS failure. */
  put(input: VaultPutInput, _options?: VaultOptions): Promise<VaultSummary>;
  /** Authorize, validate and seal before the host enters its transaction, without persisting.
   * Replacements retain identity/createdAt; omitted payload preserves the existing envelope.
   * Commit must CAS again because preparation does not reserve a revision or a default.
   * Prepared records contain envelopes and stay private to the host, never a public read model.
   * @example const record = await vault.prepare(input); await repo.put({ record, expectedRevision: input.expectedRevision }); // inside the host transaction
   */
  prepare(input: VaultPutInput, _options?: VaultOptions): Promise<VaultPutRecord>;
  /** Authorized runtime read; returns plaintext only to the caller that supplied exact ownership.
   * `provider`, when given, must match the row's group before its envelope is opened (a stale
   * selection never decrypts another group's secret). */
  get(input: VaultIdentity, options?: { provider?: string }): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null>;
  /** Singleton runtime read using one provider-independent lookup. Full expected ownership and
   * binding are required before policy/decryption; repo callers may use a broader selection scope.
   * @example await vault.findOne({ workspaceId, kind: "site-assistant", ownerKey: "assistant", principalId: null, binding: null });
   */
  findOne(input: VaultContext, _options?: VaultOptions): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null>;
  /** Authorized default read using one exact-group query; ownership is checked before opening.
   * @throws On policy, context, metadata or authentication failure.
   * @complexity One indexed row lookup, then O(payload size) decryption.
   */
  findDefault(input: VaultDefaultQuery & { binding: string | null }, _options?: VaultOptions): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null>;
  /** Copy selected rows into this service without exposing plaintext or envelopes. Each ID is
   * attempted once; failures are isolated and raw adapter/policy/crypto errors never escape.
   * Source reads are plain SELECTs; this operation never upgrades or writes the source.
   * @throws VaultError for invalid scopes. Per-row failures use fixed reason codes.
   * @complexity O(n + payload bytes), n unique IDs; sequential bounded row reads and CAS writes.
   */
  copyToSite(input: VaultCopyInput, _options?: VaultOptions): Promise<VaultCopyResult[]>;
  /** Human-managed scoped inventory. No envelope or plaintext is opened or returned. */
  list(input: VaultQuery, _options?: VaultOptions): Promise<VaultSummary[]>;
  /** Merge and validate complete metadata, then target only changed JSON keys with revision CAS. */
  patchMeta(input: VaultIdentity & { expectedRevision: number; patch: VaultMeta }, _options?: VaultOptions): Promise<VaultSummary>;
  /** Re-seal using the active key; concurrent replacement wins through CAS. Metadata-only rows persist.
   * A re-seal that cannot be opened again under the row's own binding is refused before anything is
   * written: rotation replaces the only copy of the secret, so a bad seal would destroy it.
   * After a key switch the stored row no longer opens with this service's sealer: pass the previous
   * key's opener as `sourceOpener` rather than binding `sealer.open` to it.
   * @throws VaultResealRefusedError (`invalid-record`) when the new envelope does not open to the stored payload.
   * @example await vault.rotate({ ...identity, expectedRevision }, { sourceOpener: previousKeySealer });
   */
  rotate(input: VaultIdentity & { expectedRevision: number }, options?: VaultRotateOptions): Promise<VaultSummary>;
  /** Idempotent for missing rows; existing rows require matching context and revision.
   * Deletion needs no metadata interpretation, so unupgraded legacy rows remain removable.
   */
  delete(input: VaultIdentity & { expectedRevision: number }, _options?: VaultOptions): Promise<boolean>;
}
