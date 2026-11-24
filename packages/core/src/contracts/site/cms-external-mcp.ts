/**
 * @file The admin `external-mcp` wire DTOs (ADR-029): the JSON bodies the external-MCP admin routes
 * (`@jini-ai/cms/admin-http/routes/external-mcp/*`) answer with and an admin client reads. Declared
 * here, once, so the route specs and any client mirror read the same shapes without the client
 * depending on CMS. The routes' behaviour, error ladders and body readers stay in CMS; only the
 * declarations sit in Core.
 *
 * A server row is the host's read model (it carries safe hints only, never an env VALUE); the routes
 * read just `serverId` and `enabled`, so the row type is generic and a host passes its own view.
 * CMS's `routes/external-mcp/__tests__/dto-parity.test.ts` pins every route's answer against these.
 */

/** The fields every external-MCP server row carries on the wire; the host's read model adds the rest. */
export interface ExternalMcpServerSummaryDto { serverId: string; enabled: boolean }

/** A server row tagged with whether the runtime provisioned it (built-in) or the operator did. */
export type ExternalMcpOwnedServerDto<Server extends { serverId: string } = ExternalMcpServerSummaryDto> = Server & { builtIn: boolean };

/** `GET .../mcp-servers`: the workspace's roster, each row tagged with its ownership. */
export interface ExternalMcpListEnvelope<Server extends { serverId: string } = { serverId: string }> {
  servers: ExternalMcpOwnedServerDto<Server>[];
}

/** `PUT .../mcp-servers/:serverId`: the saved row; `restartRequired` is conservative by design. */
export interface ExternalMcpPutEnvelope<Server extends { serverId: string } = ExternalMcpServerSummaryDto> {
  server: ExternalMcpOwnedServerDto<Server>;
  restartRequired: true;
}

/** `DELETE .../mcp-servers/:serverId`. */
export interface ExternalMcpDeleteEnvelope { removed: true; restartRequired: true }

/** `GET .../mcp-servers/admissions`: the federation's report; `configFailures` only when the reader reported them. */
export interface ExternalMcpAdmissionsEnvelope { connections: unknown; configFailures?: unknown }

/** One saved "Always allow" grant as it is sent (the stored fingerprint never is). */
export interface ExternalMcpToolApprovalDto { serverId: string; toolName: string; grantedByPrincipalId: string; grantedAt: string }

/** `GET .../mcp-servers/tool-approvals`: sorted by server, then tool. */
export interface ExternalMcpToolApprovalsEnvelope { approvals: ExternalMcpToolApprovalDto[] }

/** `DELETE .../mcp-servers/:serverId/tool-approvals/:toolName`. */
export interface ExternalMcpToolApprovalRevokeEnvelope { removed: true }

/** `DELETE .../mcp-servers/:serverId/oauth`. */
export interface ExternalMcpOAuthDisconnectEnvelope { disconnected: true; restartRequired: true }

import type { CredentialTokenHint } from './secrets-credential-token.js';

/**
 * The OAuth half of {@link AdminExternalMcpServer}. Mirrors
 * the host's `ExternalMcpOAuthView` — never carries an access token, a
 * refresh token, or a client secret; `hasStoredToken` is presence only, the same technique the view
 * it mirrors uses.
 */
export interface AdminExternalMcpOAuthView {
  providerId: string | null;
  grant: string | null;
  clientId: string | null;
  scopes: string[];
  status: string;
  expiresAt: string | null;
  tokenEnvName: string | null;
  hasStoredToken: boolean;
}

/** `POST .../mcp-servers/:serverId/oauth/connect`'s `auth`. Mirrors the host's
 *  `ExternalMcpConnectStart`; the device code itself never leaves the server. */
export type AdminExternalMcpConnectStart =
  | { kind: "redirect_required"; authorizationUrl: string; expiresAt: string }
  | { kind: "device_code"; userCode: string; verificationUri: string; verificationUriComplete: string | null; expiresAt: string; intervalSeconds: number };

/**
 * One configured external MCP server, as the admin tab sees it. Mirrors
 * the host's `ExternalMcpServerView`.
 *
 * `envNames` without any matching values is the whole point of the shape, not an omission: the
 * variable names are what an operator needs in order to see which credentials are set, and the
 * values are what must never leave the server. `url`/`authMode`/`oauth` are the same posture applied
 * to the two fields the generic streamable-HTTP + OAuth transport added on top of the original
 * stdio-only shape.
 */
export interface AdminExternalMcpServer {
  /** Edit revision; sent back as `expectedVersion` so a save from an older screen is refused (409 `VERSION_CONFLICT`). */
  version: number;
  /** Source-derived runtime ownership, absent on older servers. */
  builtIn?: boolean;
  serverId: string;
  label: string;
  transport: string;
  /** One of the host's `EXTERNAL_MCP_AUTH_MODES` — `none` | `static_env` | `oauth`. */
  authMode: string;
  enabled: boolean;
  command: string;
  /** Endpoint for a `streamable_http` server. `null` for `stdio`, where `command` is used instead. */
  url: string | null;
  args: string[];
  allowedToolNames: string[];
  /**
   * The operator's SECOND, write-authorization list — mirrors
   * the host's `ExternalMcpServerView.writeAllowedToolNames`. A remote
   * tool declaring `readOnlyHint: false` is admitted only when it appears in BOTH this list and
   * {@link allowedToolNames} (`mcp-federation/trust.ts` R3's override). Independent of
   * `allowedToolNames`, never derived from it.
   */
  writeAllowedToolNames: string[];
  /**
   * Who last CHANGED {@link writeAllowedToolNames}, and when — mirrors the store's own view fields
   * of the identical name. Both `null` until that list is ever touched, or for a row written before
   * these columns existed. Read-only: there is no input counterpart, since a save attributes itself
   * from the authenticated principal server-side rather than accepting a caller-supplied identity.
   */
  writeGrantsUpdatedByPrincipalId: string | null;
  writeGrantsUpdatedAt: string | null;
  envNames: string[];
  /** Whether a static access token (auth mode `static_env`) is stored. Presence only — the token is
   *  sealed and never returned. Optional so an API that predates the field reads as "none stored". */
  hasAccessToken?: boolean;
  accessTokenHint?: CredentialTokenHint | null;
  envTokenHints?: Readonly<Record<string, CredentialTokenHint>>;
  /** For a `stdio` + `static_env` server: which environment variable receives that token. */
  accessTokenEnvName?: string | null;
  oauth: AdminExternalMcpOAuthView;
}

/**
 * The OAuth half of {@link AdminExternalMcpServerInput}. Every member is tri-state exactly as the
 * store's own `SaveExternalMcpOAuthInput` is: an absent key keeps whatever is stored, a string
 * replaces it. `clientSecret` is the one member that is ALSO write-only — no read model in this
 * subsystem ever returns it, so the form can only ever send a new one or say nothing.
 */
export interface AdminExternalMcpOAuthInput {
  providerId?: string;
  grant?: string;
  clientId?: string;
  clientSecret?: string;
  /** Raw operator input, comma- or space-separated. */
  scopes?: string;
  tokenEnvName?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  deviceAuthorizationEndpoint?: string;
}

/**
 * Write shape for one external MCP server. `args`/`allowedToolNames`/`env` are the operator's raw
 * strings — the server owns parsing them, so the admin never has a second, subtly different parser
 * that could accept something the store rejects.
 */
export interface AdminExternalMcpServerInput {
  /** The `version` this tab last loaded or saved for the server; absent for a create. */
  expectedVersion?: number;
  label?: string;
  transport: string;
  enabled: boolean;
  command: string;
  /** Endpoint for a `streamable_http` server. Ignored for `stdio`. */
  url?: string;
  args: string;
  allowedToolNames: string;
  /**
   * Raw operator input, comma-separated remote tool names separately authorized to write. Same
   * "resent in full on every save" convention as {@link allowedToolNames} — NOT tri-state like
   * {@link env}, since the tab always has the current list in the clear and can always resend it.
   * The server rejects a save (`ExternalMcpValidationError(field: "writeAllowedToolNames")`) if this
   * names a tool absent from {@link allowedToolNames} — mirrors
   * the host's external-MCP store's C-006 subset check.
   */
  writeAllowedToolNames: string;
  /** Omit to keep stored credentials; `""` to clear them. The distinction is load-bearing. */
  env?: string;
  /** Absent keeps an existing row's auth mode; otherwise one of `none` | `static_env` | `oauth`. */
  authMode?: string;
  /** SECRET, write-only, `static_env` only. Tri-state like {@link env}: omit to keep the stored token,
   *  a string replaces it, `""` clears it. Delivered as `Authorization: Bearer` to a hosted server, or
   *  as {@link accessTokenEnvName} to a local command. */
  accessToken?: string;
  /** For `stdio` + `static_env`: the environment variable that receives {@link accessToken}. */
  accessTokenEnvName?: string;
  oauth?: AdminExternalMcpOAuthInput;
}
