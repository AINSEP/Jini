import type { MediaProviderCredentialRecord, MediaProviderCredentialReplacePlanner, MediaProviderCredentialRepoPort } from "./provider-credential-contracts.js";
import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { Clock as ClockPort, IdGenerator, ISODateTime, UUID } from "@jini-ai/core/primitives";
import type { KeyringPort, SecretSealerPort, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { SecretsVaultService } from "@jini-ai/core/contracts/site/secrets-credential-sets";
import { mediaProviderVault, mediaVaultRecord, mediaVaultScope, resolveMediaCredentialIds, type MediaCredentialVaultPolicy } from "./provider-credential-vault.js";

type VaultPutRecord = Parameters<VaultRepoPort["put"]>[0]["record"];
/**
 * One provider as the admin screen sees it — the marker half only, never the key.
 *
 * Field names are `@jini-ai/ui`'s `MediaProviderCredentials`, not the host's own, because this shape
 * crosses the wire straight into that component. Structurally duplicated rather than imported:
 * `@jini-ai/ui` is a browser/React package and this is server code, so the wire contract is
 * restated here and pinned by `__tests__/provider-credential-store.test.ts`.
 */
export interface MediaProviderCredentialView {
  baseUrl?: string;
  model?: string;
  /** `true` iff a sealed key is stored. Absent rather than `false` when none is. */
  apiKeyConfigured?: boolean;
  apiKeyHint?: CredentialTokenHint | null;
  /** Bare tail, no `••••` prefix — `@jini-ai/ui`'s `maskedKeyLabel` adds and clamps that itself. */
  apiKeyTail?: string;
}

/** Credentials keyed by engine-canonical provider id. */
export type MediaProviderCredentialMap = Record<string, MediaProviderCredentialView>;

/** Longest accepted `baseUrl`/`model`. Not a vendor limit — a bound on what an admin payload may
 *  write into a text column, so a malformed client cannot store unbounded blobs. */
const MAX_FIELD_LENGTH = 2048;

export class MediaProviderCredentialValidationError extends Error {}

/** Thrown when a caller supplies a new key but the site key (the host's site-key variable) is
 *  unavailable — fail-closed, mirroring the two sibling credential stores so the route can map it
 *  to its own `503 SECRET_STORE_UNCONFIGURED` rather than a generic `400`. */
export class MediaProviderCredentialSecretStoreUnconfiguredError extends Error {}

/** The key half of a view: only stored safe hints, so reading never opens an envelope. Short or
 *  unknown-length tokens withhold their suffix. */
function keyMarkers(record: MediaProviderCredentialRecord): MediaProviderCredentialView {
  if (record.sealed === null) return {};
  const row = record.vaultRecord;
  if (row?.tokenLength === null || row?.tokenLength === undefined) return { apiKeyConfigured: true };
  const last4 = row.tokenLength >= 12 ? row.last4 : null;
  return { apiKeyConfigured: true, apiKeyHint: { length: row.tokenLength, last4 }, ...(last4 === null ? {} : { apiKeyTail: last4 }) };
}

/** Stored safe hints keep metadata readable without opening any envelopes, even with no site key. */
function toView(record: MediaProviderCredentialRecord): MediaProviderCredentialView {
  return { ...(record.baseUrl === null ? {} : { baseUrl: record.baseUrl }),
    ...(record.model === null ? {} : { model: record.model }), ...keyMarkers(record) };
}

/** Keyed by write id: a canonical row shadows its legacy rows, and a lone legacy row reports under the canonical id. */
function toMap(records: readonly MediaProviderCredentialRecord[], policy: MediaCredentialVaultPolicy): MediaProviderCredentialMap {
  const stored = new Set(records.map(record => record.providerId));
  return Object.fromEntries(records.flatMap(record => {
    const { writeId } = resolveMediaCredentialIds({ providerId: record.providerId, policy });
    return writeId !== record.providerId && stored.has(writeId) ? [] : [[writeId, toView(record)]];
  }));
}

export interface MediaProviderCredentialReadDeps {
  repo: Pick<MediaProviderCredentialRepoPort, "listByWorkspaceId">;
  vaultPolicy: MediaCredentialVaultPolicy;
}

/**
 * Every configured provider for a workspace, as markers only. Pure DB read — never decrypts, so a
 * missing or rotated site key cannot make this fail.
 *
 * @complexity O(n) over the workspace's provider rows, itself bounded by the catalogue size.
 */
export async function getMediaProviderCredentials(
  { deps, workspaceId }: { deps: MediaProviderCredentialReadDeps; workspaceId: UUID },
  _optional = {}
): Promise<MediaProviderCredentialMap> {
  return toMap(await deps.repo.listByWorkspaceId({ workspaceId }), deps.vaultPolicy);
}

/** The markers map and the revision of exactly that map, as the provider routes answer them. */
export interface MediaProviderCredentialReadModel {
  providers: MediaProviderCredentialMap;
  revision: string;
}

/**
 * The workspace's credential-set revision, derived only from stored write markers: each row's vault id,
 * its compare-and-swap revision (bumped by every write to that row) and its write time. Sorted so
 * row order cannot change it; hashed only to keep the header short. No key, envelope or hint is an
 * input, so the digest carries nothing about key material. A provider removed and re-saved restarts
 * its row revision at 1 but carries a new write time, so the set's revision still moves.
 * @complexity O(n log n) over the catalogue-bounded rows.
 */
export function mediaProviderSetRevision({ records, sha256Hex }: { records: readonly MediaProviderCredentialRecord[]; sha256Hex(required: { text: string }, optional?: Record<string, never>): string }, _optional: Record<string, never> = {}): string {
  const markers = records.map((record) => [record.vaultRecord?.id ?? record.providerId, record.vaultRecord?.revision ?? 0, record.updatedAt] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `mp1-${sha256Hex({ text: JSON.stringify(markers) })}`;
}

/** {@link getMediaProviderCredentials} plus its revision, both from ONE list read so they describe the same set. Never decrypts. @complexity O(n log n). */
export async function getMediaProviderCredentialsModel(
  { deps, workspaceId }: { deps: MediaProviderCredentialReadDeps & { sha256Hex(required: { text: string }, optional?: Record<string, never>): string }; workspaceId: UUID },
  _optional: Record<string, never> = {},
): Promise<MediaProviderCredentialReadModel> {
  const records = await deps.repo.listByWorkspaceId({ workspaceId });
  return { providers: toMap(records, deps.vaultPolicy), revision: mediaProviderSetRevision({ records, sha256Hex: deps.sha256Hex }) };
}

/** A whole-set save whose last-read revision no longer matches the stored set; nothing was written. */
export class MediaProviderCredentialStaleError extends Error {}

/** One provider's incoming edit. `apiKey` present and non-blank sets a new key; absent or blank
 *  leaves the stored one alone (`@jini-ai/ui`'s `filled()` treats blank as absent, and the tab
 *  clears a key by omitting the whole provider rather than by sending an empty one). */
export interface MediaProviderCredentialInput {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Accepted and ignored — the tab echoes back markers it was given. Listed so a payload carrying
   *  them is not rejected as having unknown fields. */
  apiKeyConfigured?: boolean;
  apiKeyHint?: CredentialTokenHint | null;
  apiKeyTail?: string;
  source?: string;
}

export interface SaveMediaProviderCredentialsInput {
  workspaceId: UUID;
  providers: Record<string, MediaProviderCredentialInput>;
}

export interface MediaProviderCredentialWriteDeps extends MediaProviderCredentialReadDeps {
  sealer: SecretSealerPort;
  keyring: KeyringPort;
  clock: ClockPort;
  idGen: IdGenerator;
  /** The live media provider registry (built-in + plugin vendors, 2026-10-21). A plugin vendor's id is
   *  accepted only when the registry holds that exact public id; omitted, only built-in ids are. */
  providerCatalog?: MediaProviderIdCatalog;
  /** The credential rules applied to ids, endpoints and keys; omitted, the real pair is used. A port rather
   *  than a module mock so a test can make the policy fail in a way the real one never does. */
  credentialPolicy: MediaProviderCredentialPolicy;
  builtInProviderIds: ReadonlySet<string>;
  credentialInputMessage(required: { error: unknown }): string | undefined;
  storageMessage: string;
  sha256Hex(required: { text: string }, optional?: Record<string, never>): string;
  createVault(required: { repo: Pick<MediaProviderCredentialRepoPort, "vault">; sealer: SecretSealerPort; keyring?: KeyringPort; clock?: ClockPort; storageError: () => Error }): Pick<SecretsVaultService, "prepare" | "findOne">;
}

/** Structurally the two real credential rules (`assertCredentialFreeField` binds the host's secret-shape detector). */
export interface MediaProviderCredentialPolicy {
  assertCredentialFreeField(required: { value: string; field: string }, optional?: Record<string, never>): void;
  normalizeCredentialToken(required: { value: unknown; field?: string; hosted?: boolean }, optional?: Record<string, never>): string;
}

/** Structurally `MediaProviderRegistry['findProvider']` — only the id is read. */
export interface MediaProviderIdCatalog {
  findProvider(required: { id: string }): { readonly id: string } | null;
}

/** Writes use only `replaceWorkspace`; new envelopes are prepared through the vault port. */
export type MediaProviderCredentialSaveDeps = Omit<MediaProviderCredentialWriteDeps, "repo"> & {
  repo: Pick<MediaProviderCredentialRepoPort, "replaceWorkspace" | "vault">;
};

function trimmedOrNull({ value }: { value: string | undefined }, _optional: Record<string, never> = {}): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Only a credential-policy refusal is an operator mistake; anything else surfaces unchanged. */
export function rethrowAsValidation<T>({ run, credentialInputMessage }: { run: () => T; credentialInputMessage: MediaProviderCredentialWriteDeps["credentialInputMessage"] }, _options = {}): T {
  try { return run(); }
  catch (err) {
    const message = credentialInputMessage({ error: err });
    if (message !== undefined) throw new MediaProviderCredentialValidationError(message);
    throw err;
  }
}

/** An exact (never alias-resolved) non-built-in id the injected registry holds. @complexity O(m). */
function isPluginProviderId({ providerId, catalog, builtInProviderIds }: { providerId: string; catalog: MediaProviderIdCatalog | undefined; builtInProviderIds: ReadonlySet<string> }, _optional: Record<string, never> = {}): boolean {
  return !builtInProviderIds.has(providerId) && catalog?.findProvider({ id: providerId })?.id === providerId;
}

/** Built-in ids, or a plugin vendor id the injected registry holds. @complexity O(m). */
function isKnownProviderId({ providerId, catalog, builtInProviderIds }: { providerId: string; catalog: MediaProviderIdCatalog | undefined; builtInProviderIds: ReadonlySet<string> }, _optional: Record<string, never> = {}): boolean {
  return builtInProviderIds.has(providerId) || isPluginProviderId({ providerId, catalog, builtInProviderIds });
}

function assertKnownProviderId({ providerId, policy, catalog, builtInProviderIds, credentialInputMessage }: { providerId: string; policy: MediaProviderCredentialPolicy; catalog: MediaProviderIdCatalog | undefined; builtInProviderIds: ReadonlySet<string>; credentialInputMessage: MediaProviderCredentialWriteDeps["credentialInputMessage"] }, _optional = {}): void {
  rethrowAsValidation({ credentialInputMessage, run: () => policy.assertCredentialFreeField({ value: providerId, field: 'providerId' }) });
  if (!isKnownProviderId({ providerId, catalog, builtInProviderIds })) {
    throw new MediaProviderCredentialValidationError(
      `unknown media provider "${providerId}" — expected an engine-canonical id from @jini-ai/integrations/media-providers`
    );
  }
}

/** `apiKey` is only type-checked here: token normalization owns its own policy and limit. */
function assertEntryField({ providerId, field, value, policy, credentialInputMessage }: { providerId: string; field: "apiKey" | "baseUrl" | "model"; value: unknown; policy: MediaProviderCredentialPolicy; credentialInputMessage: MediaProviderCredentialWriteDeps["credentialInputMessage"] }, _options = {}): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw new MediaProviderCredentialValidationError(`${field} for "${providerId}" must be a string`);
  }
  if (field === "apiKey") return;
  rethrowAsValidation({ credentialInputMessage, run: () => policy.assertCredentialFreeField({ value, field }) });
  if (value.length > MAX_FIELD_LENGTH) {
    throw new MediaProviderCredentialValidationError(
      `${field} for "${providerId}" exceeds ${MAX_FIELD_LENGTH} characters`
    );
  }
}

/** Rejects anything the row cannot faithfully hold, before a single write happens. */
export function assertValidEntry({ providerId, entry, catalog, policy, builtInProviderIds, credentialInputMessage }: { providerId: string; entry: MediaProviderCredentialInput; catalog: MediaProviderIdCatalog | undefined; policy: MediaProviderCredentialPolicy; builtInProviderIds: ReadonlySet<string>; credentialInputMessage: MediaProviderCredentialWriteDeps["credentialInputMessage"] }, _optional: Record<string, never> = {}): void {
  assertKnownProviderId({ providerId, policy, catalog, builtInProviderIds, credentialInputMessage });
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new MediaProviderCredentialValidationError(`provider "${providerId}" must be an object`);
  }
  for (const field of ["apiKey", "baseUrl", "model"] as const) assertEntryField({ providerId, field, value: entry[field], policy, credentialInputMessage });
}

/** Prepare only supplied keys before the replacement transaction. The later planner re-reads
 * CURRENT rows for all preserved keys, so a rotation during this await cannot be resurrected.
 * @complexity Catalogue-bounded reads/seals; no writes or per-row opens.
 */
export async function sealNewProviderKeys(
  deps: MediaProviderCredentialSaveDeps,
  input: SaveMediaProviderCredentialsInput,
  policy: MediaProviderCredentialPolicy,
): Promise<Map<string, VaultPutRecord>> {
  const fresh = new Map<string, VaultPutRecord>();
  const vault = deps.createVault({ repo: deps.repo, sealer: deps.sealer, keyring: deps.keyring, clock: deps.clock,
    storageError: () => new MediaProviderCredentialSecretStoreUnconfiguredError(deps.storageMessage) });
  for (const [providerId, entry] of Object.entries(input.providers)) {
    const submitted = entry.apiKey;
    if (submitted === undefined || submitted === "") continue;
    const apiKey = rethrowAsValidation({ credentialInputMessage: deps.credentialInputMessage, run: () => policy.normalizeCredentialToken({ value: submitted, field: "apiKey" }) });
    const scope = mediaVaultScope({ workspaceId: input.workspaceId, providerId, policy: deps.vaultPolicy });
    if (!deps.repo.vault) throw new MediaProviderCredentialSecretStoreUnconfiguredError(deps.storageMessage);
    const existing = (await deps.repo.vault.list(scope))[0];
    fresh.set(providerId, await vault.prepare({ ...scope,
      id: existing?.id ?? deps.idGen.newId(), expectedRevision: existing?.revision ?? null,
      provider: providerId, label: providerId, meta: { ...existing?.meta, baseUrl: trimmedOrNull({ value: entry.baseUrl }), model: trimmedOrNull({ value: entry.model }) },
      payload: { apiKey }, hintToken: apiKey }));
  }
  return fresh;
}

/**
 * A metadata-only edit of a canonical id with no canonical row yet carries its legacy key forward: the
 * legacy envelope is opened under its OWN stored identity, then sealed as a NEW canonical envelope
 * (expected revision null, so the transaction's CAS refuses a racing canonical writer). Never a ciphertext copy.
 * @complexity At most one probe read per alias id and one open + seal per migrated provider.
 */
async function migrateLegacyProviderKeys(deps: MediaProviderCredentialSaveDeps, input: SaveMediaProviderCredentialsInput): Promise<Map<string, VaultPutRecord>> {
  const migrated = new Map<string, VaultPutRecord>();
  const { vault: repoVault } = deps.repo;
  if (!repoVault) return migrated;
  const vault = deps.createVault({ repo: deps.repo, sealer: deps.sealer, keyring: deps.keyring, clock: deps.clock,
    storageError: () => new MediaProviderCredentialSecretStoreUnconfiguredError(deps.storageMessage) });
  for (const [providerId, entry] of Object.entries(input.providers)) {
    if (entry.apiKey !== undefined && entry.apiKey !== "") continue;
    const storedId = await selectStoredCredentialId({ vault: repoVault, workspaceId: input.workspaceId, providerId, deps });
    if (storedId === null || storedId === providerId) continue;
    const legacy = await openStoredCredential({ vault: repoVault, sealer: deps.sealer, workspaceId: input.workspaceId, storedId, deps });
    if (legacy === null) continue;
    migrated.set(providerId, await vault.prepare({ ...mediaVaultScope({ workspaceId: input.workspaceId, providerId, policy: deps.vaultPolicy }),
      id: deps.idGen.newId(), expectedRevision: null, provider: providerId, label: providerId,
      meta: { baseUrl: trimmedOrNull({ value: entry.baseUrl }), model: trimmedOrNull({ value: entry.model }) },
      payload: { apiKey: legacy.apiKey }, hintToken: legacy.apiKey }));
  }
  return migrated;
}

/** Pure merge against the transaction's snapshot; hints and envelope travel as one private unit. */
export function buildProviderUpsertRow(input: {
  workspaceId: UUID; providerId: string; entry: MediaProviderCredentialInput;
  existing: MediaProviderCredentialRecord | undefined; fresh: VaultPutRecord | undefined; now: ISODateTime; vaultPolicy: MediaCredentialVaultPolicy;
}, _options = {}): MediaProviderCredentialRecord {
  const { workspaceId, providerId, entry, existing, fresh, now, vaultPolicy } = input;
  const credential = fresh ? mediaVaultRecord({ row: fresh, policy: vaultPolicy }) : existing;
  // Only a new provider must bring a key. A stored keyless row (migrated or recovered, metadata
  // only) is re-sent by every whole-map save, so refusing it would block every other provider's edit.
  if (!credential) throw new MediaProviderCredentialValidationError('Enter a token. Spaces alone are not a token.');
  const row: MediaProviderCredentialRecord = { workspaceId, providerId,
    baseUrl: trimmedOrNull({ value: entry.baseUrl }), model: trimmedOrNull({ value: entry.model }),
    sealed: credential.sealed, keyTail: credential.keyTail, aadVersion: credential.aadVersion,
    createdAt: existing?.createdAt ?? now, updatedAt: now };
  Object.defineProperty(row, "vaultRecord", { value: credential.vaultRecord });
  return row;
}

/**
 * Replaces the workspace's ENTIRE provider set and resolves the authoritative copy afterward.
 *
 * Whole-map semantics over the BUILT-IN vendors, because that is what the port promises: a built-in
 * provider absent from `providers` is DELETED, not left in place; any other stored row (a plugin
 * vendor's, registered or not) is kept. A present entry with a blank/absent `apiKey` keeps whatever key is
 * already stored, so an operator editing only `baseUrl` never has to re-paste a key they cannot
 * see.
 *
 * Ordering is deliberate and load-bearing: every entry is validated, then every new key is sealed,
 * and only then is anything written. Sealing is the one step that can fail for an environmental
 * reason (a missing the host's site-key variable), so doing it up front means that failure cannot
 * leave the workspace half-rewritten — the alternative, sealing inside the write loop, would delete
 * some providers and abort before writing the rest.
 *
 * Sealing up front is also what lets the merge itself be synchronous: this function hands
 * `replaceWorkspace` a plain function of the workspace's CURRENT rows, and the repo runs that read,
 * that merge, and every resulting write inside one transaction under the writer lock.
 * Reading preserved keys out here instead — the shape this function used to have — reintroduces a
 * window in which a concurrent rotation lands between the read and the write and is then reverted by
 * this call's own merge, because a metadata-only entry re-writes the sealed key it read.
 *
 * @throws {MediaProviderCredentialValidationError} `providers` is not an object, names an unknown
 *   provider id, or carries a non-string/oversized `apiKey`/`baseUrl`/`model`.
 * @throws {MediaProviderCredentialSecretStoreUnconfiguredError} a new key was supplied but the
 *   site key is unavailable — never downgraded to a plaintext write or a silent skip.
 * @throws {MediaProviderCredentialStaleError} `expectedRevision` was given and the stored set's
 *   revision, read inside the writer boundary, differs; the transaction rolls back unwritten.
 * @complexity O(n) over the submitted providers, plus one keyring derivation per NEW key. `n` is
 *   bounded by the catalogue: unknown ids are rejected, so the payload cannot exceed its size.
 */
export async function saveMediaProviderCredentials(
  { deps, input }: { deps: MediaProviderCredentialSaveDeps; input: SaveMediaProviderCredentialsInput },
  { expectedRevision }: { expectedRevision?: string } = {},
): Promise<MediaProviderCredentialMap> {
  const { providers } = input;
  if (providers === null || typeof providers !== "object" || Array.isArray(providers)) {
    throw new MediaProviderCredentialValidationError("providers must be an object keyed by provider id");
  }

  const policy = deps.credentialPolicy;
  const entries = Object.entries(providers);
  for (const [providerId, entry] of entries) assertValidEntry({ providerId, entry, catalog: deps.providerCatalog, policy, builtInProviderIds: deps.builtInProviderIds, credentialInputMessage: deps.credentialInputMessage });

  const now = clockNowIso({ clock: deps.clock });

  // Seal every new key BEFORE any write — see this function's doc for why the order matters, and
  // why this is the ONLY async step left before the transaction opens.
  const sealedByProviderId = await sealNewProviderKeys(deps, input, policy);
  const migratedByProviderId = await migrateLegacyProviderKeys(deps, input);

  const submittedIds = new Set(entries.map(([providerId]) => providerId));

  /** Merges the submitted payload against whatever rows the transaction just read. Synchronous and
   *  pure by contract — it runs inside the open transaction. */
  const plan: MediaProviderCredentialReplacePlanner = ({ existing: existingRows }, _optional = {}) => {
    // The last-read revision is compared HERE, against the rows this writer boundary just read: a
    // compare made before the boundary would let another window's save land between it and this write.
    if (expectedRevision !== undefined && mediaProviderSetRevision({ records: existingRows, sha256Hex: deps.sha256Hex }) !== expectedRevision) {
      throw new MediaProviderCredentialStaleError("media provider set changed since it was read");
    }
    const existingByProviderId = new Map(existingRows.map((row) => [row.providerId, row]));
    const upserts = entries.map(([providerId, entry]) =>
      buildProviderUpsertRow({ workspaceId: input.workspaceId, providerId, entry,
        existing: existingByProviderId.get(providerId), now, vaultPolicy: deps.vaultPolicy,
        // A migrated legacy key applies only while the snapshot still has no canonical row.
        fresh: sealedByProviderId.get(providerId) ?? (existingByProviderId.has(providerId) ? undefined : migratedByProviderId.get(providerId)) })
    );
    return {
      upserts,
      // A plugin vendor's row is never tombstoned by omission: the admin tab renders only built-in
      // vendors, so its whole-map save would otherwise silently delete a key saved for a plugin vendor.
      // Keyed on "not built-in", not "registry holds it": a disabled plugin, a restart or a loader
      // fault drops the vendor from the registry, and its stored key must survive that too.
      tombstoneProviderIds: existingRows
        .map((row) => row.providerId)
        .filter((providerId) => !submittedIds.has(providerId) && deps.builtInProviderIds.has(providerId)),
    };
  };

  return toMap(await deps.repo.replaceWorkspace({ workspaceId: input.workspaceId, plan }), deps.vaultPolicy);
}
/** One-row writes read the set back afterward, so they also need the list read. */
export type MediaProviderCredentialRowDeps = Omit<MediaProviderCredentialWriteDeps, "repo"> & {
  repo: Pick<MediaProviderCredentialRepoPort, "replaceWorkspace" | "vault" | "listByWorkspaceId">;
};

/** One provider's PATCH merged over its stored row: a field the PATCH omits keeps its stored value. @complexity O(1). */
export function mergedPatchEntry({ fields, existing }: { fields: MediaProviderCredentialInput; existing: MediaProviderCredentialRecord | undefined }, _optional: Record<string, never> = {}): MediaProviderCredentialInput {
  const baseUrl = fields.baseUrl ?? existing?.baseUrl ?? undefined;
  const model = fields.model ?? existing?.model ?? undefined;
  return { ...(baseUrl === undefined ? {} : { baseUrl }), ...(model === undefined ? {} : { model }) };
}

/**
 * Merges ONE provider's fields into its stored credentials and answers the set's read model. No other
 * provider is touched: this write names one provider, so it never tombstones by omission. An omitted
 * `apiKey` keeps the stored key; an omitted `baseUrl`/`model` keeps the stored value, an empty one
 * clears it. Same order as the whole-set save, for the same reason: validate, seal any new key, and
 * only then open the writer boundary, where the merge reads the CURRENT row.
 * @throws {MediaProviderCredentialValidationError} unknown provider id or an invalid field.
 * @throws {MediaProviderCredentialSecretStoreUnconfiguredError} a new key but no site key.
 * @complexity One seal at most, one read-plan-write, one list read.
 */
export async function patchMediaProvider(
  { deps, workspaceId, providerId, fields }: { deps: MediaProviderCredentialRowDeps; workspaceId: UUID; providerId: string; fields: MediaProviderCredentialInput },
  _optional: Record<string, never> = {},
): Promise<MediaProviderCredentialReadModel> {
  const policy = deps.credentialPolicy;
  assertValidEntry({ providerId, entry: fields, catalog: deps.providerCatalog, policy, builtInProviderIds: deps.builtInProviderIds, credentialInputMessage: deps.credentialInputMessage });
  const now = clockNowIso({ clock: deps.clock });
  const fresh = (await sealNewProviderKeys(deps, { workspaceId, providers: { [providerId]: fields } }, policy)).get(providerId);
  await deps.repo.replaceWorkspace({ workspaceId, plan: ({ existing: existingRows }) => {
    const existing = existingRows.find((row) => row.providerId === providerId);
    const entry = mergedPatchEntry({ fields, existing });
    return { upserts: [buildProviderUpsertRow({ workspaceId, providerId, entry, existing, fresh, now, vaultPolicy: deps.vaultPolicy })], tombstoneProviderIds: [] };
  } });
  return getMediaProviderCredentialsModel({ deps, workspaceId });
}

/**
 * Deletes exactly one provider's stored credentials in one workspace and answers the set's read model.
 * The catalog is deliberately NOT consulted: a saved plugin vendor whose plugin is disabled or gone
 * must stay removable, and catalog absence is no permission to remove anything either — only this
 * explicit, workspace-scoped request is. A provider with nothing stored is a no-op, not an error.
 * @throws {MediaProviderCredentialValidationError} the id is secret-shaped (it is never echoed).
 * @complexity One read-plan-write, one list read.
 */
export async function removeMediaProvider(
  { deps, workspaceId, providerId }: { deps: Pick<MediaProviderCredentialRowDeps, "repo" | "credentialPolicy" | "credentialInputMessage" | "vaultPolicy" | "sha256Hex">; workspaceId: UUID; providerId: string },
  _optional: Record<string, never> = {},
): Promise<MediaProviderCredentialReadModel> {
  const policy = deps.credentialPolicy;
  rethrowAsValidation({ credentialInputMessage: deps.credentialInputMessage, run: () => policy.assertCredentialFreeField({ value: providerId, field: "providerId" }) });
  await deps.repo.replaceWorkspace({ workspaceId, plan: () => ({ upserts: [], tombstoneProviderIds: [providerId] }) });
  return getMediaProviderCredentialsModel({ deps, workspaceId });
}

export interface MediaProviderCredentialResolveDeps {
  repo: Pick<MediaProviderCredentialRepoPort, "vault">;
  sealer: SecretSealerPort;
  vaultPolicy: MediaCredentialVaultPolicy;
  storageMessage: string;
  createVault: MediaProviderCredentialWriteDeps["createVault"];
}

/** One provider's decrypted, USABLE credential — never logged, never returned from a tool result;
 *  see {@link resolveMediaProviderCredential}'s own doc for the one caller this exists for. */
export interface ResolvedMediaProviderCredential {
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
}

/**
 * The ONLY decrypting read this table has. Finds the workspace's saved credential for `providerId`
 * (an engine-canonical id from `@jini-ai/integrations/media-providers` — same catalogue
 * {@link KNOWN_PROVIDER_IDS} is frozen from) and decrypts it.
 *
 * Returns `null`, never throws, for either "not configured at all" (no row) or "configured with no
 * key yet" (`sealed === null` — `MediaProviderCredentialRecord`'s own doc: "a row may legitimately
 * hold only `baseUrl`/`model` with no key yet"). Both are the same ordinary, expected state for an
 * optional integration a caller should handle with a clear "nothing saved yet" message, not treat as
 * exceptional — matching `resolveCustomCredentialByLabel`'s identical "not found is not an error"
 * contract for the sibling table.
 *
 * @throws {MediaProviderCredentialSecretStoreUnconfiguredError} A row with a sealed key exists but
 *   `sealer.open()` failed — the site key is missing/rotated, or the stored row is corrupted.
 * @complexity One indexed provider-group read, at most one selected envelope open.
 */
export async function resolveMediaProviderCredential(
  { deps, workspaceId, providerId }: { deps: MediaProviderCredentialResolveDeps; workspaceId: UUID; providerId: string },
  _optional = {}
): Promise<ResolvedMediaProviderCredential | null> {
  if (!deps.repo.vault) throw new MediaProviderCredentialSecretStoreUnconfiguredError(deps.storageMessage);
  const storedId = await selectStoredCredentialId({ vault: deps.repo.vault, workspaceId: workspaceId, providerId, deps });
  if (storedId === null) return null;
  return openStoredCredential({ vault: deps.repo.vault, sealer: deps.sealer, workspaceId: workspaceId, storedId, deps });
}

/** The FIRST STORED row among the provider's credential ids, not the first that decrypts: a canonical
 *  row wins even with no key. A provider without legacy ids keeps its single exact-provider read. */
async function selectStoredCredentialId({ vault, workspaceId, providerId, deps }: { vault: VaultRepoPort; workspaceId: string; providerId: string; deps: Pick<MediaProviderCredentialResolveDeps, "vaultPolicy"> }, _optional = {}): Promise<string | null> {
  const { readIds } = resolveMediaCredentialIds({ providerId, policy: deps.vaultPolicy });
  if (readIds.length === 1) return readIds[0] ?? providerId;
  for (const id of readIds) {
    if ((await vault.list(mediaVaultScope({ workspaceId, providerId: id, policy: deps.vaultPolicy })))[0]) return id;
  }
  return null;
}

/** Opens the selected row under ITS stored id, provider scope and AAD; `null` for a keyless row. */
async function openStoredCredential({ vault: repoVault, sealer, workspaceId, storedId, deps }: { vault: VaultRepoPort; sealer: SecretSealerPort; workspaceId: string; storedId: string; deps: Pick<MediaProviderCredentialResolveDeps, "vaultPolicy" | "storageMessage" | "createVault"> }, _optional = {}): Promise<ResolvedMediaProviderCredential | null> {
  const vault = deps.createVault({ sealer, repo: { vault: mediaProviderVault({ vault: repoVault, providerId: storedId, policy: deps.vaultPolicy }) },
    storageError: () => new MediaProviderCredentialSecretStoreUnconfiguredError(deps.storageMessage) });
  const resolved = await vault.findOne(mediaVaultScope({ workspaceId, providerId: storedId, policy: deps.vaultPolicy }));
  if (!resolved?.payload) return null;
  if (typeof resolved.payload.apiKey !== "string") throw new MediaProviderCredentialSecretStoreUnconfiguredError(deps.storageMessage);
  const meta = deps.vaultPolicy.parseMeta({ meta: resolved.summary.meta });
  return { apiKey: resolved.payload.apiKey, baseUrl: meta.baseUrl, model: meta.model };
}
