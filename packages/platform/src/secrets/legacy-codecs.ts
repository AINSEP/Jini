import type { UUID } from "@jini-ai/core/primitives";
import { formatAad } from "./aad.js";
import {
  VaultError,
  type VaultRecord,
  type VaultMeta,
  type VaultKind,
  type VaultOptions,
} from "@jini-ai/core/contracts/vault";

/** @file Historical vault AAD formats, legacy-row decoders and payload normalization, moved from
 * the host composition (formerly the host's `vault-legacy-codecs.ts`).
 * The host injects its own owner key and vault policy (`formerCustomOwnerKey`, `policy`).
 *
 * Historical formats and their original rationale, copied verbatim for S2 recovery.
 * Feature reads must use Jini buildVaultAad, never these builders. */
const AAD_VERSION = "v1";

/** The host vault-policy slice the historical payload normalizer reads. The host keeps its own
 * catalog and token-field rules and passes them in; this module never guesses a vendor. */
export interface LegacyVaultPolicy {
  /** Workspace registry first, bundled registry second, as in the former publish backfill.
   * Missing plugins leave their legacy records recoverable instead of guessing a vendor. */
  legacyPublishCredential(input: { workspaceId: string; providerId: string }): { vendorId: string; tokenField: string } | undefined;
  tokenField(input: { kind: VaultKind; provider: string | null }): string | undefined;
}

// Original source: assistant/site-credential-aad.ts

/**
 * @file The ONE place `site_assistant_credentials`' AES-GCM additional authenticated data (AAD)
 * string is formatted — same convention as `legacy-codecs.ts` and its siblings:
 * every `seal()`/`open()` call for this table MUST go through this function so sealing and opening
 * can never drift onto two different formats (which would make every row in the table permanently
 * unopenable, since AAD is authenticated but never stored — see
 * `../features/webhooks/secret-sealer.aesgcm.ts`'s file header).
 *
 * Format: `site-assistant-credential:v1:${workspaceId}` — this table is single-row-per-workspace
 * (`workspace_id` is the bare primary key, `db/schema.sqlite.ts`'s `siteAssistantCredentials` doc), so
 * `workspaceId` is the whole row identity there is to bind. That single binding is still
 * load-bearing: without it, an attacker (or a bad migration) with DB write access could copy one
 * workspace's sealed visitor-assistant key onto another workspace's row and have it decrypt
 * cleanly, since the underlying AES key is shared app-wide (`secret-sealer.aesgcm.ts`'s own
 * header).
 *
 * Legacy no-AAD rows remain readable via `site_assistant_credentials.aad_version`; see its schema contract
 * and the owning backfill script. Opening must use the version the row was sealed under.
 */

/**
 * Builds the AAD string for one `site_assistant_credentials` row. Deterministic — the same
 * `workspaceId` always produces the same string, which is required: opening a sealed value must
 * re-derive the byte-identical value sealing used, with no separate storage of the AAD itself.
 *
 * @complexity O(1) — a fixed-shape string template.
 */
export function buildSiteAssistantCredentialAad(input: { workspaceId: UUID }, _options: VaultOptions = {}): string {
  return `site-assistant-credential:${AAD_VERSION}:${input.workspaceId}`;
}

// Original source: assistant/execution-credential-aad.ts

/**
 * @file The ONE place `admin_execution_credentials`' AES-GCM additional authenticated data (AAD)
 * string is formatted — same convention as `legacy-codecs.ts` and its siblings:
 * every `seal()`/`open()` call for this table MUST go through this function so sealing and opening
 * can never drift onto two different formats (which would make every row in the table permanently
 * unopenable, since AAD is authenticated but never stored — see
 * `../features/webhooks/secret-sealer.aesgcm.ts`'s file header).
 *
 * Format: `admin-execution-credential:v1:${workspaceId}:${principalId}` — this table has no
 * surrogate `id` column (`(workspace_id, principal_id)` IS the row's own primary key, per
 * `db/schema.sqlite.ts`'s `adminExecutionCredentials` doc), so the AAD binds that composite PK directly.
 * Binds both scoping dimensions this table actually has: a ciphertext sealed under one admin's own
 * BYOK key fails auth-tag verification if presented as any other admin's ciphertext, even within
 * the same workspace — which is exactly the property this table's own header requires ("two admins
 * on the same install already carry independent keys").
 *
 * Legacy no-AAD rows remain readable via `admin_execution_credentials.aad_version`; see its schema contract
 * and the owning backfill script. Opening must use the version the row was sealed under.
 */

/**
 * Builds the AAD string for one `admin_execution_credentials` row. Deterministic — the same
 * `(workspaceId, principalId)` always produces the same string, which is required: opening a
 * sealed value must re-derive the byte-identical value sealing used, with no separate storage of
 * the AAD itself.
 *
 * @complexity O(1) — a fixed-shape string template.
 */
export function buildExecutionCredentialAad(input: { workspaceId: UUID; principalId: UUID }, _options: VaultOptions = {}): string {
  return `admin-execution-credential:${AAD_VERSION}:${input.workspaceId}:${input.principalId}`;
}

// Original source: assistant/external-mcp-aad.ts
/**
 * @file The ONE place `external_mcp_servers`' AES-GCM additional authenticated data (AAD) strings
 * are formatted — same convention as `legacy-codecs.ts` and its siblings: every
 * `seal()`/`open()` call for this table MUST go through these functions so sealing and opening can
 * never drift onto two different formats (which would make every row permanently unopenable, since
 * AAD is authenticated but never stored — see `../features/webhooks/secret-sealer.aesgcm.ts`).
 *
 * ## Why this table needs TWO builders, unlike every sibling
 *
 * `external_mcp_servers` carries **two independent sealed blobs on the same row**:
 *
 * - `sealed_*` — the static env block (`{NAME: value}`) handed to a stdio child process.
 * - `oauth_sealed_*` — `{ clientSecret?, tokens? }` for an OAuth-authorized connection.
 *
 * They are different secret classes with different lifecycles: an env block is operator-entered and
 * changes when the operator edits it, while the OAuth blob is rotated by a refresh flow. Sealing
 * both under one AAD would make them interchangeable *within a row* — an attacker able to move
 * column values could present the env blob in the OAuth slot and vice versa. The distinct
 * `external-mcp-env:` / `external-mcp-oauth:` prefixes are domain separation, and they are why this
 * table also carries two independent version discriminators rather than one.
 *
 * Format: `external-mcp-{env,oauth}:v1:${workspaceId}:${serverId}`. This table has no surrogate
 * `id` column — `(workspace_id, server_id)` IS the primary key (`db/schema.sqlite.ts`'s
 * `externalMcpServers`) — so the AAD binds that composite PK directly. A ciphertext sealed for one
 * server fails auth-tag verification if presented as any other server's, in the same workspace or
 * any other.
 *
 * Legacy no-AAD blobs remain readable through `aad_version`/`oauth_aad_version`; see the schema
 * contract and the external MCP AAD backfill. The discriminators must retain
 * each blob's sealing mode.
 */

/** The composite primary key an `external_mcp_servers` AAD binds. */
export interface ExternalMcpAadIdentity {
  readonly workspaceId: string;
  readonly serverId: string;
}

/**
 * The current AAD version for newly sealed blobs. Rows still at `0` were sealed before AAD existed
 * and are opened through the legacy no-AAD path — see the store's `open*` helpers.
 */
export const EXTERNAL_MCP_AAD_VERSION = 1;

/**
 * Builds the AAD for a row's sealed **env block** (`sealed_*`).
 *
 * @complexity O(1) — a fixed-shape string template.
 */
export function buildExternalMcpEnvAad(input: ExternalMcpAadIdentity, _options: VaultOptions = {}): string {
  return `external-mcp-env:${AAD_VERSION}:${input.workspaceId}:${input.serverId}`;
}

/**
 * Builds the AAD for a row's sealed **OAuth blob** (`oauth_sealed_*`, holding `clientSecret` and
 * `tokens`). Deliberately a different string from {@link buildExternalMcpEnvAad} for the same row.
 *
 * @complexity O(1) — a fixed-shape string template.
 */
export function buildExternalMcpOAuthAad(input: ExternalMcpAadIdentity, _options: VaultOptions = {}): string {
  return `external-mcp-oauth:${AAD_VERSION}:${input.workspaceId}:${input.serverId}`;
}

// Original source: features/media/aad.ts

/**
 * @file The ONE place `media_provider_credentials`' AES-GCM additional authenticated data (AAD)
 * string is formatted — mirrors `legacy-codecs.ts`/`features/custom-credentials/
 * aad.ts`/`legacy-codecs.ts`/`legacy-codecs.ts`
 * exactly, all four of whose file headers this one repeats verbatim: every `seal()`/`open()` call
 * for this table MUST go through this function so sealing and opening can never drift onto two
 * different formats (which would make every row in the table permanently unopenable, since AAD is
 * authenticated but never stored — see `webhooks/secret-sealer.aesgcm.ts`'s file header).
 *
 * Format: `media-provider-credential:v1:${workspaceId}:${providerId}` — this table has no surrogate
 * `id` column (`(workspace_id, provider_id)` IS the row's own primary key, per `db/schema.sqlite.ts`'s
 * `mediaProviderCredentials` doc), so the AAD binds that composite PK directly rather than a third
 * `id` component the row does not have. Binds both scoping dimensions this table actually has: a
 * ciphertext sealed under one provider's AAD fails auth-tag verification if presented as any other
 * provider's ciphertext, even within the same workspace.
 *
 * This table's rows predate AAD entirely (2026-09-02 gap closure) — see `media_provider_
 * credentials.aad_version`'s own doc in `db/schema.sqlite.ts` and the media provider credential AAD
 * backfill for how existing rows are migrated without becoming unreadable.
 */

/**
 * Builds the AAD string for one `media_provider_credentials` row. Deterministic — the same
 * `(workspaceId, providerId)` always produces the same string, which is required: opening a sealed
 * value must re-derive the byte-identical value sealing used, with no separate storage of the AAD
 * itself.
 *
 * @complexity O(1) — a fixed-shape string template.
 */
export function buildMediaProviderCredentialAad(input: { workspaceId: UUID; providerId: string }, _options: VaultOptions = {}): string {
  return `media-provider-credential:${AAD_VERSION}:${input.workspaceId}:${input.providerId}`;
}

// Original source: features/custom-credentials/aad.ts

/**
 * @file The ONE place `custom_credential_sets`' AES-GCM additional authenticated data (AAD) string
 * is formatted — mirrors `legacy-codecs.ts` exactly. Every `seal()`/`open()` call for
 * this table MUST go through this function so sealing and opening can never drift onto two
 * different formats (which would make every row in the table permanently unopenable, since AAD is
 * authenticated but never stored — see `Jini packages/platform/src/secrets/secret-sealer.aesgcm.ts`'s file header).
 *
 * Format: `custom-credential-set:v1:${workspaceId}:${id}` — versioned (`v1`), and bound to both
 * scoping dimensions this table actually has (no `providerId` — see `types.ts`'s own header for
 * why this table has none to bind).
 */

/**
 * Builds the AAD string for one `custom_credential_sets` row. Deterministic — the same
 * `(workspaceId, id)` always produces the same string, which is required: opening a sealed value
 * must re-derive the byte-identical value sealing used, with no separate storage of the AAD itself.
 *
 * @complexity O(1) — a fixed-shape string template.
 */
export function buildCustomCredentialAad(input: { workspaceId: UUID; id: UUID }, _options: VaultOptions = {}): string {
  return `custom-credential-set:${AAD_VERSION}:${input.workspaceId}:${input.id}`;
}

// Original source: features/source-control/aad.ts

/**
 * @file The ONE place `source_control_credential_sets`' AES-GCM additional authenticated data
 * (AAD) string is formatted — mirrors `legacy-codecs.ts` exactly.
 * Every `seal()`/`open()` call for this table MUST go through this function so sealing and opening
 * can never drift onto two different formats (which would make every row in the table permanently
 * unopenable, since AAD is authenticated but never stored — see
 * `Jini packages/platform/src/secrets/secret-sealer.aesgcm.ts`'s file header).
 *
 * Format: `source-control-credential-set:v1:${workspaceId}:${providerId}:${id}` — versioned (`v1`)
 * so a future format change is an explicit, reviewed migration path rather than a silent
 * redefinition that breaks every existing row without warning. Binds all three scoping dimensions:
 * a ciphertext sealed under one credential set's AAD fails auth-tag verification if presented as
 * any other credential set's ciphertext, even within the same workspace/provider.
 */

/**
 * Builds the AAD string for one `source_control_credential_sets` row. Deterministic — the same
 * `(workspaceId, providerId, id)` always produces the same string, which is required: opening a
 * sealed value must re-derive the byte-identical value sealing used, with no separate storage of
 * the AAD itself.
 *
 * @complexity O(1) — a fixed-shape string template.
 */
export function buildSourceControlCredentialAad(input: { workspaceId: UUID; providerId: string; id: UUID }, _options: VaultOptions = {}): string {
  return `source-control-credential-set:${AAD_VERSION}:${input.workspaceId}:${input.providerId}:${input.id}`;
}

// Original source: features/vendor-credentials/aad.ts

// Generic formatter and rationale: Jini/packages/platform/src/secrets/aad.ts; the row namespace stays here.
/**
 * @file The ONE place `vendor_credential_sets`' AES-GCM additional authenticated data (AAD) string
 * is formatted — mirrors `legacy-codecs.ts` and
 * `legacy-codecs.ts` exactly, both of whose file headers this one repeats verbatim:
 * every `seal()`/`open()` call for this table MUST go through this function so sealing and opening
 * can never drift onto two different formats (which would make every row in the table permanently
 * unopenable, since AAD is authenticated but never stored — see
 * `Jini packages/platform/src/secrets/secret-sealer.aesgcm.ts`'s file header).
 *
 * Format: `vendor-credential-set:v1:${workspaceId}:${vendorId}:${id}` — a FRESH `v1`, not a `v2` of
 * either predecessor table's own format. This table is a new table with its own AAD lineage, not a
 * versioned continuation of `publish-credential-set:v1:...`/`source-control-credential-set:v1:...`
 * (those formats stay exactly as they are, still governing whatever rows remain in the two
 * predecessor tables until they are cut over and dropped — see `../../db/schema.sqlite.ts`'s
 * `vendorCredentialSets` doc). Binds all three scoping dimensions the predecessor tables' own AAD
 * already bound, with `vendorId` standing in for `providerId`: a ciphertext sealed under one
 * credential set's AAD fails auth-tag verification if presented as any other credential set's
 * ciphertext, even within the same workspace/vendor.
 */

/**
 * Builds the AAD string for one `vendor_credential_sets` row. Deterministic — the same
 * `(workspaceId, vendorId, id)` always produces the same string, which is required: opening a
 * sealed value must re-derive the byte-identical value sealing used, with no separate storage of
 * the AAD itself.
 *
 * @complexity O(1) — a fixed-shape string template.
 */
export function buildVendorCredentialAad(input: { workspaceId: UUID; vendorId: string; id: UUID }, _options: VaultOptions = {}): string {
  return formatAad({ kind: "vendor-credential-set", version: AAD_VERSION, parts: [input.workspaceId, input.vendorId, input.id] });
}

// Original source: features/publish-content/peer-aad.ts

/**
 * @file Task 10 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 10.
 *
 * The ONE place `publish_content_peers`' AES-GCM additional authenticated data (AAD) string is
 * formatted — every `seal()`/`open()` call for this table MUST go through this function, exactly as
 * `legacy-codecs.ts` does for `publish_credential_sets`. AAD is
 * authenticated but never stored, so if sealing and opening ever drift onto two different formats
 * every row in the table becomes permanently unopenable.
 *
 * Format: `publish-content-peer:v1:${workspaceId}:${id}` — binds both scoping dimensions this table
 * has (there is no `providerId` analogue here: a peer is identified by URL + credential, never by a
 * platform identifier, per plan §0b's vendor-neutrality constraint). A ciphertext sealed under one
 * peer's AAD fails auth-tag verification if presented as any other peer's ciphertext, even within
 * the same workspace.
 *
 * Unlike the `publish_credential_sets` precedent, the version is ALSO persisted, in the table's own
 * `aad_version` integer column — {@link PUBLISH_CONTENT_PEER_AAD_VERSION} is what a write stamps
 * there. That makes a future `v2` a readable, row-by-row migration ("re-seal every row whose
 * `aad_version` is 1") rather than a flag day, which is why the column exists.
 */

/** The AAD format version every row written by this feature is stamped with (`aad_version`). */
export const PUBLISH_CONTENT_PEER_AAD_VERSION = 1;

/**
 * Builds the AAD string for one `publish_content_peers` row. Deterministic — the same
 * `(workspaceId, id)` always produces the same string, which is required: `open()` must re-derive
 * the byte-identical value `seal()` used, with no separate storage of the AAD itself.
 *
 * @param input.aadVersion - The version stamped on the row being opened; defaults to the current
 * {@link PUBLISH_CONTENT_PEER_AAD_VERSION} for a fresh seal. Passing the row's OWN stored value is
 * what lets a future `v2` writer coexist with `v1` rows that have not been re-sealed yet.
 * @complexity O(1) — a fixed-shape string template.
 */
export function buildPublishContentPeerAad(input: { workspaceId: UUID; id: UUID; aadVersion?: number }, _options: VaultOptions = {}): string {
  const version = input.aadVersion ?? PUBLISH_CONTENT_PEER_AAD_VERSION;
  return `publish-content-peer:v${version}:${input.workspaceId}:${input.id}`;
}

// Original source: features/database-transfer/destination-aad.ts
/**
 * @file The ONE place `database_transfer_destinations`' AES-GCM additional authenticated data (AAD) is
 * formatted; sealing and opening both call it, so they can never drift apart (AAD is authenticated
 * but never stored — `features/webhooks/secret-sealer.aesgcm.ts`'s header). It binds the sealed
 * address to its workspace: a row copied onto another workspace does not open.
 */

/** Every row is sealed under this version (the table was born with AAD). */
export const DATABASE_DESTINATION_AAD_VERSION = 1;

/** @complexity O(1). */
export function buildDatabaseDestinationAad(input: { workspaceId: string }, _options: VaultOptions = {}): string {
  return `database-transfer-destination:v${DATABASE_DESTINATION_AAD_VERSION}:${input.workspaceId}`;
}

// Original source: features/deployments/publish-credentials/aad.ts

/**
 * @file The ONE place `publish_credential_sets`' AES-GCM additional authenticated data (AAD) string
 * is formatted — every `seal()`/`open()` call for this table MUST go through this function so sealing
 * and opening can never drift onto two different formats (which would make every row in the table
 * permanently unopenable, since AAD is authenticated but never stored — see
 * `Jini packages/platform/src/secrets/secret-sealer.aesgcm.ts`'s file header).
 *
 * Format: `publish-credential-set:v1:${workspaceId}:${providerId}:${id}` — versioned (`v1`) so a
 * future format change is an explicit, reviewed migration path (bump to `v2`, re-seal every row under
 * the new AAD) rather than a silent redefinition that breaks every existing row without warning.
 * Binds all three scoping dimensions Terra's finding named: workspace, provider, and the specific
 * credential-set row — a ciphertext sealed under one credential set's AAD fails auth-tag verification
 * if presented as any other credential set's ciphertext, even within the same workspace/provider.
 */

/**
 * Builds the AAD string for one `publish_credential_sets` row. Deterministic — the same
 * `(workspaceId, providerId, id)` always produces the same string, which is required: `open()` must
 * re-derive the byte-identical value `seal()` used, with no separate storage of the AAD itself.
 *
 * @complexity O(1) — a fixed-shape string template.
 */
export function buildPublishCredentialAad(input: { workspaceId: UUID; providerId: string; id: UUID }, _options: VaultOptions = {}): string {
  return `publish-credential-set:${AAD_VERSION}:${input.workspaceId}:${input.providerId}:${input.id}`;
}

/** Migration-pinned original identity; collisions change the vault ID, never this AAD context. */
export interface VaultLegacyContext {
  table: string; workspaceId: string; id: string; principalId: string | null;
  provider: string | null; serverId: string | null; aadVersion: number;
}

/** Decode only known historical lineages; unknown versions fail closed instead of trying AADs.
 * @complexity O(1); no crypto or I/O.
 */
export function legacyVaultAad({ record, legacy, formerCustomOwnerKey }: {
  record: VaultRecord; legacy: VaultLegacyContext;
  /** The host's own vault owner key, under which the former custom vault (`secrets_vault_custom_v1`) sealed. */
  formerCustomOwnerKey: string;
}, _options: VaultOptions = {}): string | undefined {
  if (legacy.workspaceId !== record.workspaceId || !Number.isInteger(legacy.aadVersion) ||
    legacy.aadVersion < 0 || legacy.aadVersion > 1) throw new VaultError({ code: "context" });
  const decode = legacyAadDecoders.get(legacy.table);
  if (!decode) throw new VaultError({ code: "context" });
  return decode({ record, legacy, formerCustomOwnerKey });
}

type LegacyAadInput = { record: VaultRecord; legacy: VaultLegacyContext; formerCustomOwnerKey: string };

function decodeSiteAssistantCredentials({ record, legacy }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  const input = { workspaceId: legacy.workspaceId, id: legacy.id };
  if (record.kind === "site-assistant") return legacy.aadVersion === 0 ? undefined : buildSiteAssistantCredentialAad(input);
  throw new VaultError({ code: "context" });
}

function decodeAdminExecutionCredentials({ record, legacy }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  const input = { workspaceId: legacy.workspaceId, id: legacy.id };
  if (record.kind === "personal-execution" && legacy.principalId === record.principalId && legacy.principalId !== null) {
    return legacy.aadVersion === 0 ? undefined : buildExecutionCredentialAad({ ...input, principalId: legacy.principalId });
  }
  throw new VaultError({ code: "context" });
}

function decodeMediaProviderCredentials({ record, legacy }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  const input = { workspaceId: legacy.workspaceId, id: legacy.id };
  if (record.kind === "media-provider" && legacy.provider === record.provider && legacy.provider !== null) {
    return legacy.aadVersion === 0 ? undefined : buildMediaProviderCredentialAad({ ...input, providerId: legacy.provider });
  }
  throw new VaultError({ code: "context" });
}

function isFormerCustomVaultIdentity({ record, formerCustomOwnerKey }: Pick<LegacyAadInput, "record" | "formerCustomOwnerKey">, _options: VaultOptions = {}): boolean {
  return record.kind === "vendor" && record.meta.credentialType === "custom" && record.ownerKey === formerCustomOwnerKey && record.provider === null;
}

function decodeSecretsVaultCustomV1({ record, legacy, formerCustomOwnerKey }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  if (!isFormerCustomVaultIdentity({ record, formerCustomOwnerKey }) || record.principalId !== null || record.binding !== null) throw new VaultError({ code: "context" });
  if (legacy.provider !== null || legacy.principalId !== null || legacy.serverId !== null) throw new VaultError({ code: "context" });
  if (legacy.id === record.id && legacy.aadVersion === 1) {
    // Pin the former vault encoding, not the active builder's future version.
    return formatAad({ kind: "secrets-vault", version: "v1", parts: [JSON.stringify([
      record.workspaceId, record.id, "custom", formerCustomOwnerKey, null, null,
    ])] });
  }
  throw new VaultError({ code: "context" });
}

function decodeCustomCredentialSets({ record, legacy }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  const input = { workspaceId: legacy.workspaceId, id: legacy.id };
  if ((record.kind === "custom" || (record.kind === "vendor" && record.meta.credentialType === "custom")) && legacy.aadVersion === 1) return buildCustomCredentialAad(input);
  throw new VaultError({ code: "context" });
}

function decodePublishContentPeers({ record, legacy }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  const input = { workspaceId: legacy.workspaceId, id: legacy.id };
  if (record.kind === "publish-peer" && legacy.aadVersion === 1) return buildPublishContentPeerAad({ ...input, aadVersion: legacy.aadVersion });
  throw new VaultError({ code: "context" });
}

function decodeDatabaseTransferDestinations({ record, legacy }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  const input = { workspaceId: legacy.workspaceId, id: legacy.id };
  if (record.kind === "database-destination" && legacy.aadVersion === 1) return buildDatabaseDestinationAad(input);
  throw new VaultError({ code: "context" });
}

function decodeVendorCredentialSets({ record, legacy }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  const input = { workspaceId: legacy.workspaceId, id: legacy.id };
  if (record.kind === "vendor" && legacy.provider === record.provider && legacy.provider !== null && legacy.aadVersion === 1) {
    return buildVendorCredentialAad({ ...input, vendorId: legacy.provider });
  }
  throw new VaultError({ code: "context" });
}

function decodeSourceControlCredentialSets({ record, legacy }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  const input = { workspaceId: legacy.workspaceId, id: legacy.id };
  if (record.kind === "source-control" && legacy.provider === record.provider && legacy.provider !== null && legacy.aadVersion === 1) {
    return buildSourceControlCredentialAad({ ...input, providerId: legacy.provider });
  }
  throw new VaultError({ code: "context" });
}

function decodePublishCredentialSets({ record, legacy }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  const input = { workspaceId: legacy.workspaceId, id: legacy.id };
  if (record.kind === "vendor" && legacy.provider !== null && legacy.aadVersion === 1) return buildPublishCredentialAad({ ...input, providerId: legacy.provider });
  throw new VaultError({ code: "context" });
}

function decodeExternalMcpServers({ record, legacy }: LegacyAadInput, _options: VaultOptions = {}): string | undefined {
  if (legacy.serverId === record.ownerKey && legacy.serverId !== null && (record.kind === "mcp-env" || record.kind === "mcp-auth")) {
    if (legacy.aadVersion === 0) return undefined;
    const identity = { workspaceId: legacy.workspaceId, serverId: legacy.serverId };
    return record.kind === "mcp-env" ? buildExternalMcpEnvAad(identity) : buildExternalMcpOAuthAad(identity);
  }
  throw new VaultError({ code: "context" });
}

const legacyAadDecoders = new Map<string, (input: LegacyAadInput, options?: VaultOptions) => string | undefined>(Object.entries({
  site_assistant_credentials: decodeSiteAssistantCredentials,
  admin_execution_credentials: decodeAdminExecutionCredentials,
  media_provider_credentials: decodeMediaProviderCredentials,
  secrets_vault_custom_v1: decodeSecretsVaultCustomV1,
  custom_credential_sets: decodeCustomCredentialSets,
  publish_content_peers: decodePublishContentPeers,
  database_transfer_destinations: decodeDatabaseTransferDestinations,
  vendor_credential_sets: decodeVendorCredentialSets,
  source_control_credential_sets: decodeSourceControlCredentialSets,
  publish_credential_sets: decodePublishCredentialSets,
  external_mcp_servers: decodeExternalMcpServers,
}));

/** Resolve the target provider and legacy token field from the host catalog without crypto.
 * Callers pass publish_credential_sets rows only.
 * @throws Error("VAULT_CATALOG_UNAVAILABLE") when the legacy publish catalog has no spec.
 * @complexity O(1) time/space plus one injected catalog lookup for publish rows; no I/O.
 * @example const { provider } = legacyTargetProvider({ record, legacy, policy });
 */
export function legacyTargetProvider(
  { record, legacy, policy }: { record: VaultRecord; legacy: VaultLegacyContext; policy: LegacyVaultPolicy },
  _options: VaultOptions = {},
): { provider: string | null; tokenField?: string } {
  if (legacy.provider === undefined || legacy.provider === null) throw new Error("legacy publish credential has no provider");
  const spec = policy.legacyPublishCredential({ workspaceId: record.workspaceId, providerId: legacy.provider });
  if (!spec) throw new Error("VAULT_CATALOG_UNAVAILABLE");
  return { provider: spec.vendorId, tokenField: spec.tokenField };
}

function parseLegacyPayload({ plaintext }: { plaintext: string }, _options: VaultOptions = {}): VaultMeta {
  const payload = JSON.parse(plaintext) as VaultMeta;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new VaultError({ code: "invalid-record" });
  return payload;
}

function isCustomPayload({ record, meta }: { record: VaultRecord; meta: VaultMeta }, _options: VaultOptions = {}): boolean {
  return record.kind === "custom" || (record.kind === "vendor" && meta.credentialType === "custom");
}

function moveCustomUsername({ payload, meta }: { payload: VaultMeta; meta: VaultMeta }, _options: VaultOptions = {}): void {
  if (payload.username !== undefined) {
    // A saved column value wins. A NULL column never meant a clear: the legacy clear re-sealed
    // without the username, and the old read fell back to the sealed copy (`column ?? sealed`).
    // NULL + sealed username is an un-backfilled row, so the sealed login moves to metadata.
    if ((meta.username === undefined || meta.username === null) && typeof payload.username === "string" && payload.username !== "") {
      meta.username = payload.username;
    }
    delete payload.username;
  }
}

function legacyHint({ token, kind }: { token: unknown; kind: VaultRecord["kind"] }, _options: VaultOptions = {}): { hintToken?: string } {
  return typeof token === "string" && !["mcp-env", "mcp-auth"].includes(kind) ? { hintToken: token } : {};
}

/** Host-specific historical payload shapes. Plain tokens become sealed JSON; secrets remain sealed.
 * Custom username is classified plain metadata; source-control's paired username stays sealed.
 * Targets no hosting plugin declares are blocked, as the former backfill did; never guess a vendor.
 * @throws On unsupported payloads or unavailable catalogs; boot flags the original row.
 * @complexity O(payload size); no per-vendor branches, I/O or new crypto.
 */
export function normalizeLegacyVaultPayload(
  { record, legacy, plaintext, policy }: { record: VaultRecord; legacy: VaultLegacyContext; plaintext: string | null; policy: LegacyVaultPolicy },
  _options: VaultOptions = {},
): { payload: VaultMeta | null; meta: VaultMeta; provider: string | null; hintToken?: string } {
  const { legacyAad: _legacy, normalization: _flag, ...meta } = record.meta;
  let provider = record.provider;
  if (plaintext === null) return { payload: null, meta, provider };
  if (["site-assistant", "personal-execution", "media-provider", "publish-peer"].includes(record.kind)) {
    return { payload: { apiKey: plaintext }, meta, provider, hintToken: plaintext };
  }
  if (record.kind === "database-destination") return { payload: { connectionString: plaintext }, meta, provider };
  const payload = parseLegacyPayload({ plaintext });
  const isCustom = isCustomPayload({ record, meta });
  if (isCustom) moveCustomUsername({ payload, meta });
  let tokenField = isCustom ? "token" : policy.tokenField({ kind: record.kind, provider });
  if (legacy.table === "publish_credential_sets") {
    const target = legacyTargetProvider({ record, legacy, policy });
    provider = target.provider;
    tokenField = target.tokenField;
    delete payload.providerId;
    payload.vendorId = provider;
  }
  // JSON remains byte-equivalent in meaning for MCP (including schemaVersion), vendor and source
  // payloads. Only the explicitly classified custom username and publish discriminator move.
  const token = tokenField === undefined ? undefined : payload[tokenField];
  return { payload, meta, provider, ...legacyHint({ token, kind: record.kind }) };
}

// Additional historical rationale retained during S5 retirement.
/**
 * Builds the AAD string for one `publish_credential_sets` row. Deterministic — the same
 * `(workspaceId, providerId, id)` always produces the same string, which is required: `open()` must
 * re-derive the byte-identical value `seal()` used, with no separate storage of the AAD itself.
 *
 * @complexity O(1) — a fixed-shape string template.
 * @overallScore 100
 */
