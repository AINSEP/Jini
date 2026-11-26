/** @agent-note Types only. The runtime parts come from the host; this area usually from `@jini-ai/mcp/federation/hosted` (values) and `@jini-ai/integrations/api-connections/hosted-mcp` (sign-in). */
import type { Clock as ClockPort, ISODateTime } from '../../primitives/time.js';
import type { UUID } from '../../primitives/ids.js';
import type { KeyringPort, SealedSecret, SecretSealerPort } from '../vault.js';

/** Exact source identity and prior access decision captured before an access-only update; no credential bytes. */
/** @agent-note Built only by `externalMcpAccessSnapshot` from the row the host just read; compared field-for-field by the repo's `updateAccessIfCurrent`. Contains no credential bytes; `admissionRevision` is the sha256 hex of the row's source identity. */
export interface ExternalMcpAccessSnapshot {
  readonly admissionRevision: string;
  readonly enabled: boolean;
  readonly allowedToolNames: string | null;
  readonly writeAllowedToolNames: string | null;
  readonly writeGrantsUpdatedByPrincipalId: string | null;
  readonly writeGrantsUpdatedAt: ISODateTime | null;
  readonly provisionedByPluginId: string | null;
}

/** The access-only command accepted by the owner after a bound human approval. */
/** @agent-note The access-only command a host accepts after a bound human approval; `expected` must be the snapshot captured before the approval was shown, never re-read after. */
export interface ExternalMcpApprovedAccess {
  readonly workspaceId: string;
  readonly serverId: string;
  readonly expected: ExternalMcpAccessSnapshot;
  readonly access: { readonly enabled: boolean; readonly allowedToolNames: readonly string[]; readonly writeAllowedToolNames: readonly string[] };
  readonly principalId: string;
}

/** @agent-note The ONE canonical saved row. Fulfilled by the host's repository (SQL or memory). Field names, `null`s, sealed envelopes and plain-text JSON columns are the saved format: never normalize, reseal or rename on read; writes keep serialization/AAD/ids. `transport`/`authMode`/`oauthGrant`/`oauthStatus` stay `string` so unknown saved values load. Never copy this shape into a host type. */
export interface ExternalMcpServerRecord {
  workspaceId: UUID;
  serverId: string;
  label: string | null;
  /** The Agent Plugin id that auto-provisioned this row, or `null` for an operator-created one.
   * @agent-note Only the trusted plugin provisioner sets this on creation; subsequent saves preserve it and never clear it. */
  provisionedByPluginId: string | null;
  transport: string;
  /** How credentials are obtained. Independent of `transport` — see this file's header. */
  authMode: string;
  enabled: boolean;
  command: string | null;
  /** Endpoint for a remote transport. NULL for `stdio`, where `command` is used instead. */
  url: string | null;
  /** JSON array of argv strings, as stored. */
  args: string | null;
  /** JSON array of admissible remote tool names, as stored. */
  allowedToolNames: string | null;
  /**
   * JSON array of remote tool names separately authorized to write, as stored. `trust.ts` R3's
   * override — a tool declaring `readOnlyHint: false` is admitted only when it also appears in
   * {@link allowedToolNames}. See `@jini-ai/mcp/federation`'s `FederatedMcpConnectionConfig
   * .writeAllowedToolNames` for the full argument.
   */
  writeAllowedToolNames: string | null;
  /** Principal who last CHANGED {@link writeAllowedToolNames}'s contents. `null` until that list is
   *  ever touched, or for a row written before this column existed. */
  writeGrantsUpdatedByPrincipalId: string | null;
  /** When {@link writeAllowedToolNames} was last changed. `null` under the same condition. */
  writeGrantsUpdatedAt: ISODateTime | null;
  /** JSON array of env variable names, as stored. Plaintext by design. */
  envNames: string | null;
  sealedEnv: SealedSecret | null;
  /** Which registered provider descriptor this connection authorizes against. */
  oauthProviderId: string | null;
  oauthGrant: string | null;
  /** Plaintext: a client id is not a secret — it travels in the authorization URL by design. */
  oauthClientId: string | null;
  /** JSON object of operator-typed endpoints, when this connection defines its own provider instead
   *  of naming a registered one. Non-secret. */
  oauthEndpointsJson: string | null;
  /** JSON array of requested scopes. Non-secret. */
  oauthScopesJson: string | null;
  oauthStatus: string | null;
  /**
   * PLAINTEXT absolute expiry of the stored access token, beside the sealed blob rather than inside
   * it. Exactly the split this file already makes for `envNames` beside `sealedEnv`, and here it is
   * load-bearing rather than merely convenient: expiry has to be checkable by a scheduler and
   * displayable in the admin tab, and neither can afford a keyring round trip — nor should either be
   * a code path that decrypts a live token to answer a question about when it dies.
   */
  oauthExpiresAt: ISODateTime | null;
  /**
   * For `stdio` + `oauth`: which child-process environment variable receives the access token.
   * Plaintext because it is a NAME, exactly as `envNames` is.
   */
  oauthTokenEnvName: string | null;
  /**
   * Cross-process refresh lease. Held while one process is redeeming the refresh token, so the other
   * — the admin web server and the agent daemon are separate processes with separate database
   * handles — does not redeem the same single-use rotating token. Plaintext for the same reason as
   * `oauthExpiresAt`: a lease you must decrypt to inspect is a lease you cannot break after a crash.
   */
  oauthRefreshLeaseUntil: ISODateTime | null;
  /** Sealed `{ clientSecret?, tokens? }`.
   * @agent-note Writers must open, update and reseal the whole payload, preserving members they did not explicitly change or clear; writing tokens alone would erase the client secret. */
  sealedOAuth: SealedSecret | null;
  /** Compatibility read field; normalized vault envelopes use lineage 1. */
  aadVersion: number;
  /** Compatibility read field; actual authenticated context lives on the vault row. */
  oauthAadVersion: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /**
   * Edit revision, starting at 1. Advanced by every write an editor can see: a form save, an access
   * approval or revocation, a credential removed by recovery. NOT advanced by runtime writes (token
   * refresh, OAuth status, lease), so background activity never makes a person's save conflict.
   * @agent-note Compared in the write statement (`updateIfVersion`), never in application code alone. A caller that holds a `version` read earlier and sends it back as the basis is protected against a save from an old screen; a lock or a same-request read is not that protection.
   */
  version: number;
}

/** A conditional access-only write. Credential and connection configuration are never replaced. */
/** @agent-note Built by the host from an `ExternalMcpApprovedAccess`; the repository applies it atomically or returns `false`. Credential and connection columns are never part of it. */
export interface ExternalMcpAccessUpdate {
  readonly workspaceId: UUID;
  readonly serverId: string;
  readonly expected: ExternalMcpAccessSnapshot;
  readonly access: { readonly enabled: boolean; readonly allowedToolNames: string; readonly writeAllowedToolNames: string };
  readonly principalId: string;
  readonly nowIso: ISODateTime;
}

/** Which server row a runtime write addresses. */
export interface ExternalMcpServerKey {
  readonly workspaceId: UUID;
  readonly serverId: string;
}

/** The credential envelopes an edit was built from, exactly as the writer read them from the stored row. */
/** @agent-note The repository compares these against the row's current vault pointers inside its write. A miss with an unchanged `version` means a runtime write (token refresh) moved a credential between the writer's read and its write: the writer re-reads and rebuilds once. Never re-sealed or edited by the caller. */
export interface ExternalMcpReplacedSecrets {
  readonly sealedEnv: SealedSecret | null;
  readonly sealedOAuth: SealedSecret | null;
}

/** The only columns a runtime (non-edit) OAuth write may change. */
/** @agent-note Deliberately has no label, enabled flag, grants, url or version: a token refresh must not restore the values it read before it called the provider. */
export interface ExternalMcpOAuthRuntimePatch {
  readonly oauthStatus: string | null;
  readonly oauthExpiresAt: ISODateTime | null;
  readonly oauthRefreshLeaseUntil: ISODateTime | null;
  /** The new staged envelope, or `null` to drop the stored one (a cleared token with no client secret to keep). */
  readonly sealedOAuth: SealedSecret | null;
  readonly oauthAadVersion: number;
  readonly updatedAt: ISODateTime;
}

/** Workspace-scoped persistence. Multi-row per workspace, so list/insert/update/delete rather
 *  than a single-row find/upsert. */
/** @agent-note Fulfilled by the host (SQL or memory adapter). The store, the sign-in service and the plugin connect seam must receive the SAME repository instance, because sealed envelopes carry private repository context only that repository rebuilds. */
export interface ExternalMcpServerRepoPort {
  /** @agent-note Workspace-scoped; returns whole saved rows, never views. */
  listByWorkspaceId(workspaceId: UUID): Promise<ExternalMcpServerRecord[]>;
  /** @agent-note Returns the whole saved row or `null`; at most one row read per call. */
  findByServerId(input: { workspaceId: UUID; serverId: string }): Promise<ExternalMcpServerRecord | null>;
  /** @agent-note Writes the whole row in one transaction (row, vault pointer, status and expiry together). Replaces any stored row blindly, so it is not allowed for an edit: use `insert` / `updateIfVersion` / `updateOAuthRuntime`. */
  upsert(record: ExternalMcpServerRecord): Promise<void>;
  /**
   * Creates the row at `version` 1. `false` when a row with this key already exists; nothing is written.
   * @agent-note One transaction (row + staged envelopes). Never overwrites: a create that lost a race to another create reports `false`.
   */
  insert(required: { readonly record: ExternalMcpServerRecord }): Promise<boolean>;
  /**
   * The edit write: replaces the editable columns and both credential pointers iff the stored
   * `version` equals `expectedVersion` AND both stored envelopes are the ones in `replaces`; sets
   * `version` to `expectedVersion + 1`. When supplied, `expectedCreatedAt` must also match.
   * `false` when nothing was written (the row is gone, moved on, or a credential was replaced since the read).
   * @agent-note Compare-and-set in the write statement under the same writer lock the credential writers take. `record.version` is ignored; the repository assigns the next version.
   */
  updateIfVersion(required: { readonly record: ExternalMcpServerRecord; readonly expectedVersion: number; readonly expectedCreatedAt?: string; readonly replaces: ExternalMcpReplacedSecrets }): Promise<boolean>;
  /**
   * The runtime write: sets only the sealed-OAuth pointer, `oauthStatus`, `oauthExpiresAt`,
   * `oauthRefreshLeaseUntil`, `oauthAadVersion` and `updatedAt`, iff the stored sealed-OAuth envelope is `expectedSealedOAuth`.
   * When supplied, `expectedConfig` also compares creation time and version in the write.
   * Leaves `version` and every other column alone. `false` when the credential or guarded configuration changed, or the row is gone.
   * @agent-note A late token set for a credential that no longer exists is dropped, never written onto its replacement. The caller reports it as "reauthorization required".
   */
  updateOAuthRuntime(required: { readonly key: ExternalMcpServerKey; readonly expectedSealedOAuth: SealedSecret | null; readonly expectedConfig?: Pick<ExternalMcpServerRecord, "createdAt" | "version">; readonly patch: ExternalMcpOAuthRuntimePatch }): Promise<boolean>;
  /** Compare the approved snapshot and update access atomically, preserving credential columns. */
  /** @agent-note Compare-and-set against `expected`; `false` means the row changed since approval and nothing was written. A successful write advances `version`, so a form saved from before the approval or revocation conflicts instead of restoring the old grants. */
  updateAccessIfCurrent(required: ExternalMcpAccessUpdate): Promise<boolean>;
  /** @agent-note Returns whether a row existed. */
  deleteByServerId(input: { workspaceId: UUID; serverId: string }): Promise<boolean>;
  /**
   * Atomically claims the OAuth refresh lease for one row, iff nobody holds an unexpired one.
   *
   * A COMPARE-AND-SET, not a read-then-write, and that is the entire point: `upsert` cannot express
   * it, because between reading "no lease" and writing "my lease" the other process does the same
   * and both go on to redeem the same single-use rotating refresh token. One statement with the
   * condition in its `WHERE` is what makes the loser observable.
   *
   * @returns `true` when this caller now holds the lease.
   */
  /** @agent-note Compare-and-set in one statement; only the caller that gets `true` may redeem the refresh token. */
  tryClaimOAuthRefreshLease(input: {
    workspaceId: UUID;
    serverId: string;
    /** Now, per the caller's clock. A lease at or before this instant is treated as abandoned. */
    nowIso: ISODateTime;
    /** When this claim expires, so a crashed holder cannot wedge the connection forever. */
    leaseUntil: ISODateTime;
  }): Promise<boolean>;
  /** Releases the lease unconditionally. Safe when not held — the lease is advisory and
   *  time-bounded, so a spurious release costs at most one extra refresh attempt. */
  /** @agent-note Unconditional and idempotent; call after every claimed refresh, success or failure. */
  releaseOAuthRefreshLease(input: { workspaceId: UUID; serverId: string }): Promise<void>;
}

/** @agent-note Host-wired: `repo` is the same instance the sign-in service gets; `sealer`/`keyring` usually from `@jini-ai/platform/secrets`; `clock` from the host. */
export interface ExternalMcpStoreDeps {
  repo: ExternalMcpServerRepoPort;
  sealer: SecretSealerPort;
  keyring: KeyringPort;
  clock: ClockPort;
}

/**
 * Resolves an `oauth` row's contribution to the child environment.
 *
 * Kept behind a port rather than inlined, so this store never imports a token endpoint, a refresher,
 * or an OAuth implementation at all: the boot path asks for a token, and whoever wired the daemon decides where
 * it comes from. That is also what keeps this module testable without a network.
 */
/** @agent-note Fulfilled by the sign-in service's `tokenResolver`; the store calls it once per OAuth row read and never imports OAuth itself. */
export interface ExternalMcpOAuthTokenResolverPort {
  /** Undefined identifies an existing local connection. Shared failures must throw, never fall back. */
  /** @agent-note Optional; a shared-binding failure throws and never falls back to a local token. */
  resolveSharedAccessToken?(input: { serverId: string }): Promise<string | undefined>;
  /**
   * Returns the access token to inject, refreshing first when it is due.
   *
   * @throws When the connection needs re-authorization or the provider could not be reached. The
   * caller turns that into a per-server failure entry rather than letting it abort the whole read.
   */
  /** @agent-note At most one leased refresh per call; throws a terminal error when re-authorization is needed. */
  resolveAccessToken(input: { serverId: string }): Promise<string>;
}
