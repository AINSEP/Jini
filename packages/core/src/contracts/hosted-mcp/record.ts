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
  /** The Agent Plugin id that auto-provisioned this row, or `null` for an operator-created one. See
   *  `schema.sqlite.ts`'s `provisioned_by_plugin_id` column doc for the full rule. */
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
  /** Sealed `{ clientSecret?, tokens? }`. See `external-mcp-oauth.ts` for the read-modify-write rule. */
  sealedOAuth: SealedSecret | null;
  /** Compatibility read field; normalized vault envelopes use lineage 1. */
  aadVersion: number;
  /** Compatibility read field; actual authenticated context lives on the vault row. */
  oauthAadVersion: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
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

/** Workspace-scoped persistence (ADR-007 §1). Multi-row per workspace, so list/upsert/delete rather
 *  than a single-row find/upsert. */
/** @agent-note Fulfilled by the host (SQL or memory adapter). The store, the sign-in service and the plugin connect seam must receive the SAME repository instance, because sealed envelopes carry private repository context only that repository rebuilds. */
export interface ExternalMcpServerRepoPort {
  /** @agent-note Workspace-scoped; returns whole saved rows, never views. */
  listByWorkspaceId(workspaceId: UUID): Promise<ExternalMcpServerRecord[]>;
  /** @agent-note Returns the whole saved row or `null`; at most one row read per call. */
  findByServerId(input: { workspaceId: UUID; serverId: string }): Promise<ExternalMcpServerRecord | null>;
  /** @agent-note Writes the whole row in one transaction (row, vault pointer, status and expiry together). */
  upsert(record: ExternalMcpServerRecord): Promise<void>;
  /** Compare the approved snapshot and update access atomically, preserving credential columns. */
  /** @agent-note Compare-and-set against `expected`; `false` means the row changed since approval and nothing was written. */
  updateAccessIfCurrent(required: ExternalMcpAccessUpdate, optional?: Record<string, never>): Promise<boolean>;
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
 * or `src/platform/oauth/` at all: the boot path asks for a token, and whoever wired the daemon decides where
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
