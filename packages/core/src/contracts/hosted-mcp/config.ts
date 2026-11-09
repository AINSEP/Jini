/** @agent-note Types only. The runtime parts come from the host; this area usually from `@jini-ai/mcp/federation/hosted` (values) and `@jini-ai/integrations/api-connections/hosted-mcp` (sign-in). */
import type { ISODateTime } from '../../primitives/time.js';
import type { UUID } from '../../primitives/ids.js';
import type { SealedSecret } from '../vault.js';
import type { ExternalMcpAuthMode, ExternalMcpOAuthStatus, ExternalMcpTransport } from './vocabulary.js';

/** Supplies a current token per exchange. Undefined preserves configured headers. */
/** @agent-note Supplied by the host per exchange (re-exported by `@jini-ai/mcp/federation`); returning `undefined` keeps configured headers. A shared binding that is missing or revoked must throw, never fall back to launch headers. */
export type McpBearerTokenSupplier = (request: { readonly url: string }, options?: { readonly signal?: AbortSignal | undefined }) => string | undefined | Promise<string | undefined>;

/** The decrypted, validated domain shape. Only ever exists in memory. */
/**
 * Where a resolved connection's credentials go, which is the one thing the two transports do
 * genuinely differently.
 *
 * A union rather than a flat shape with an empty `command` on one arm and an empty `url` on the
 * other: a config carrying both is not a degraded row to tolerate, it is a bug, and this makes it
 * unrepresentable. It mirrors `@jini-ai/mcp/federation`'s `McpLaunchSpec` deliberately — this is
 * the same distinction one layer earlier, before policy is attached.
 */
/** @agent-note Built only by the store after credentials are resolved; never persisted. A target carrying both a command and a URL is unrepresentable on purpose. */
export type ExternalMcpServerTarget =
  | {
      readonly kind: "stdio";
      readonly command: string;
      readonly args: string[];
      /**
       * The child process's environment. For an `oauth` connection this ALREADY contains the
       * resolved access token under the operator's chosen variable name — resolution happens before
       * this shape exists, so nothing downstream needs to know whether a value came from a pasted
       * block or a token endpoint.
       */
      readonly env: Record<string, string>;
    }
  | {
      readonly kind: "streamable_http";
      readonly url: string;
      /**
       * Request headers, carrying the resolved access token as `Authorization: Bearer ...` for an
       * `oauth` connection. The hosted analogue of `env` above, and resolved at the same point for
       * the same reason.
       */
      readonly headers: Record<string, string>;
      /** Captures the selected shared connection; missing/revoked bindings refuse instead of using launch headers. */
      readonly bearerToken?: McpBearerTokenSupplier;
    };

/** @agent-note Produced by the store from one saved row; `admissionRevision` must be the revision of that same row so the per-call gate compares like with like. */
export interface ExternalMcpServerConfig {
  /** Retained for matching the reviewed plugin declaration when the roster is loaded. */
  provisionedByPluginId?: string;
  serverId: string;
  label: string;
  transport: ExternalMcpTransport;
  authMode: ExternalMcpAuthMode;
  enabled: boolean;
  allowedToolNames: string[];
  /** The operator's second, write-authorization list. See {@link ExternalMcpServerRecord
   *  .writeAllowedToolNames}. Passed through untouched for `trust.ts` to enforce. */
  writeAllowedToolNames: string[];
  target: ExternalMcpServerTarget;
  /** {@link externalMcpAdmissionRevision} of the row this config was resolved from — carried onto
   *  {@link ResolvedFederatedConnection.config}'s `origin` by {@link toResolvedFederatedConnections}
   *  for `external-mcp-revocation.ts`'s per-call gate. */
  admissionRevision: string;
}

/** The OAuth half of {@link ExternalMcpServerView}. Non-secret by construction: no access token, no
 *  refresh token and no client secret appears here or in anything that builds it. */
/** @agent-note Built from plain-text columns only; nothing is unsealed to produce it and no secret may be added. */
export interface ExternalMcpOAuthView {
  providerId: string | null;
  grant: string | null;
  clientId: string | null;
  scopes: string[];
  status: ExternalMcpOAuthStatus;
  /** Plaintext expiry, straight off the row — nothing is unsealed to produce it. */
  expiresAt: ISODateTime | null;
  tokenEnvName: string | null;
  /** Whether an access TOKEN is stored. Presence, never the value — the same technique
   *  `routes/admin/system/deployment-overview.ts` uses for environment variables. Decided from
   *  PLAINTEXT columns only; see {@link externalMcpRecordHasStoredToken} for why it must not unseal
   *  and for the one state it under-reports. */
  hasStoredToken: boolean;
}

/** The read model the admin tab renders — never carries env VALUES or any OAuth secret. */
/** @agent-note `TokenHint` is host input: the host binds its own credential-hint shape (for example the platform `CredentialTokenHint`). Never carries env values, tokens or client secrets. */
export interface ExternalMcpServerView<TokenHint = never> {
  serverId: string;
  label: string;
  /** Which Agent Plugin auto-provisioned this row, or `null` for one an operator created by hand —
   *  what lets the admin tab (and a future uninstall flow) tell the two apart. */
  provisionedByPluginId: string | null;
  transport: string;
  authMode: string;
  enabled: boolean;
  command: string;
  url: string | null;
  args: string[];
  allowedToolNames: string[];
  /** The operator's second, write-authorization list. See {@link ExternalMcpServerRecord
   *  .writeAllowedToolNames}. */
  writeAllowedToolNames: string[];
  /** Who last changed {@link writeAllowedToolNames}, and when — so the tab can render "authorized by
   *  X on Y". `null` until that list is ever touched. */
  writeGrantsUpdatedByPrincipalId: string | null;
  writeGrantsUpdatedAt: ISODateTime | null;
  /** Variable names only. The tab masks values it never receives. */
  envNames: string[];
  /** Whether a `static_env` access token is stored. Presence only, decided from plaintext columns —
   *  see {@link externalMcpRecordHasStaticAccessToken}. */
  hasAccessToken: boolean;
  accessTokenHint?: TokenHint | null;
  envTokenHints?: Readonly<Record<string, TokenHint>>;
  /** For `stdio` + `static_env`: the child env variable that receives that token. A NAME, so plaintext. */
  accessTokenEnvName: string | null;
  oauth: ExternalMcpOAuthView;
}

/**
 * The OAuth half of a save. Every field follows the same three-state rule `env` established:
 * ABSENT keeps what is stored, a STRING replaces it, an EMPTY string clears it.
 *
 * Structural validation only happens here — charsets, lengths, required-when-oauth. Whether
 * `providerId` names a registered descriptor, and whether the endpoints form a usable provider, is
 * `external-mcp-oauth.ts`'s call: resolving a descriptor is the flow module's job, and importing its
 * registry here would put the store back in the business of the thing its header says it is not.
 */
/** @agent-note Three-state per field: absent keeps, a string replaces, an empty string clears. Structural validation only; provider resolution belongs to the sign-in service. */
export interface SaveExternalMcpOAuthInput {
  /** A registered provider id, or empty to define this connection's own endpoints below — or, on a
   *  REMOTE connection, to leave both to discovery at connect time. */
  providerId?: string;
  grant?: string;
  /** Empty on a remote connection means "mint one by dynamic client registration at connect". */
  clientId?: string;
  /** SECRET. Sealed, never returned by any read model. */
  clientSecret?: string;
  /** Raw operator input, comma- or space-separated. */
  scopes?: string;
  /** For `stdio`: which child env variable receives the access token. */
  tokenEnvName?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  deviceAuthorizationEndpoint?: string;
}

/** @agent-note Raw operator input; the store validates and seals. `principalId` is host-supplied identity; `provisionedByPluginId` is set only by the plugin provisioning seam on the creating save. */
export interface SaveExternalMcpServerInput {
  workspaceId: UUID;
  serverId: string;
  label?: string;
  transport: string;
  /** One of {@link EXTERNAL_MCP_AUTH_MODES}. Absent keeps an existing row's mode, or defaults a new
   *  row to `static_env` — the mode every row written before this field existed effectively had. */
  authMode?: string;
  enabled: boolean;
  command: string;
  /** Endpoint for a remote transport. Required for `streamable_http`, ignored for `stdio`. */
  url?: string;
  /** Raw operator input, space-separated. */
  args: string;
  /** Raw operator input, comma-separated remote tool names. */
  allowedToolNames: string;
  /** Raw operator input, comma-separated remote tool names the operator separately authorizes to
   *  write. Same shape and same "resent in full on every save" convention as {@link
   *  allowedToolNames} — this is NOT tri-state like {@link env}, because the admin tab shows this
   *  list in the clear and can always resend it. Rejected at save (C-006) if it names a tool absent
   *  from {@link allowedToolNames}. Defaulted defensively to `""` if a caller omits it, so a route or
   *  test written before this field existed degrades to "no write grants" rather than throwing. */
  writeAllowedToolNames: string;
  /** Raw operator input, `KEY=VALUE` per line. `undefined` leaves an existing block untouched. */
  env?: string;
  /** SECRET, `static_env` only. Sealed, never returned by any read model. Three-state like {@link env}:
   *  `undefined` keeps the stored token, a string replaces it, `""` clears it. Delivered as
   *  {@link accessTokenEnvName} to a stdio child, or as `Authorization: Bearer` to a hosted server. */
  accessToken?: string;
  /** For `stdio` + `static_env`: which child env variable receives {@link accessToken}. `undefined`
   *  keeps the stored name. */
  accessTokenEnvName?: string;
  oauth?: SaveExternalMcpOAuthInput;
  /**
   * Set ONLY by `features/agent-plugins/federate-mcp.ts`, on the ONE save that creates a brand-new
   * plugin-provisioned row. Every other caller (the admin PUT route, the assistant's own
   * `external_mcp_save` tool) omits this field entirely, and an omitted field PRESERVES whatever the
   * row already has — the same three-state rule `env` establishes, minus the "empty string clears
   * it" arm: nothing should ever intentionally clear this column once set, so no clear signal is
   * defined for it. See `schema.sqlite.ts`'s `provisioned_by_plugin_id` doc for the full rule.
   */
  provisionedByPluginId?: string;
  /**
   * The principal performing this save, threaded from `getAuthedPrincipal(res)` at the route. Used
   * ONLY to attribute a change to {@link writeAllowedToolNames} — see {@link
   * resolveWriteGrantAttribution}. Required so every new caller has to supply one; a caller that
   * never touches the write list never reads it, so an un-migrated caller cannot crash on its
   * absence (see that function's doc).
   */
  principalId: string;
}

/** @agent-note Saved payload v1 inside the sealed OAuth envelope. Member names and JSON serialization are the saved format: keep them byte-identical, add only optional members. */
export interface ExternalMcpSealedOAuthPayload {
  /**
   * A `static_env` row's operator-pasted access token — the only member such a row's blob ever holds
   * (see {@link externalMcpRecordHasStaticAccessToken}). Additive to payload v1: the OAuth flow never
   * reads a `static_env` row (`requireOAuthRecord` refuses it), so no older reader can mishandle it.
   */
  readonly staticAccessToken?: string;
  readonly clientSecret?: string;
  readonly tokens?: {
    readonly accessToken: string;
    readonly refreshToken: string | null;
    readonly tokenType: string;
    readonly scopes: readonly string[];
    readonly expiresAt: ISODateTime | null;
  };
}

/**
 * Seals an OAuth payload, or resolves `null` when there is nothing worth sealing.
 *
 * An empty payload seals to `null` rather than to a blob containing `{}`, so `sealedOAuth !== null`
 * is a truthful answer to "does this connection hold anything secret". It is NOT an answer to "does
 * it hold a token" — a cleared connection keeps its client secret in that blob — which is why
 * {@link externalMcpRecordHasStoredToken} reads the plaintext columns instead.
 *
 * @throws {ExternalMcpSecretStoreUnconfiguredError} When no site key is available.
 * @complexity O(1) — one seal.
 */
/**
 * A sealed OAuth blob with its compatibility lineage. Vault identity travels with the opaque
 * envelope so carried credentials keep the exact ID/context they were authenticated under.
 * The server repository commits that vault row, its pointer, status and expiry together.
 */
/** @agent-note Opaque envelope plus lineage; carry it unchanged so the exact vault identity/context it was sealed under is kept. */
export interface SealedExternalMcpOAuth {
  readonly sealedOAuth: SealedSecret | null;
  readonly oauthAadVersion: number;
}

/** What an authorization-code connect hands back to the route. Carries no secret. */
/** @agent-note Returned by the sign-in service to the host route; carries no secret. */
export interface ExternalMcpAuthorizationStart {
  readonly kind: "redirect_required";
  readonly authorizationUrl: string;
  readonly expiresAt: string;
}

/** What a device-grant connect hands back. `deviceCode` is deliberately absent — it stays
 *  server-side, and the poll route looks it up by server id. */
/** @agent-note Returned by the sign-in service; the device code itself stays server-side. */
export interface ExternalMcpDeviceStart {
  readonly kind: "device_code";
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string | null;
  readonly expiresAt: ISODateTime;
  readonly intervalSeconds: number;
}

/** @agent-note Discriminated by `kind`; hosts render each arm, packages never build host links here. */
export type ExternalMcpConnectStart = ExternalMcpAuthorizationStart | ExternalMcpDeviceStart;
