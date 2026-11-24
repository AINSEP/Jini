import type { SaveExternalMcpOAuthInput, SaveExternalMcpServerInput } from "@jini-ai/core/contracts/hosted-mcp";
import { parseExpectedVersion } from "@jini-ai/core/optimistic-concurrency";

/**
 * @file The PUT body reader for `external-mcp/put.ts`, moved verbatim from the host route. It runs
 * inside `handle`, after authorization — the hand-written route read the body only once its guard
 * had passed, so a malformed `expectedVersion` from an unauthorized caller is still the 403.
 */

/** The writable fields a PUT carries; the route adds the workspace, server id and principal. */
export type ExternalMcpPutFields = Omit<SaveExternalMcpServerInput, "workspaceId" | "serverId" | "principalId" | "provisionedByPluginId">;

/** `undefined`/non-string collapses to `""` — the ordinary (non tri-state) field default this
 *  route uses for `command`/`args`/`allowedToolNames`. @complexity O(1). */
function asStringField({ value }: { value: unknown }, _optional = {}): string {
  return typeof value === "string" ? value : "";
}

/** Carries a string field ONLY when the caller actually sent one, so `undefined` (keep what is
 *  stored) stays distinguishable from `""` (clear it). The `env` rule, applied to every field that
 *  shares its three-way meaning. @complexity O(1). */
function optionalStringField({ value, key }: { value: unknown; key: string }, _optional = {}): Record<string, string> {
  return typeof value === "string" ? { [key]: value } : {};
}

/**
 * The OAuth block of a PUT body.
 *
 * Every member is tri-state for the same reason `env` is: an operator renaming a connection, or
 * toggling it off, sends no OAuth fields at all, and collapsing that into `""` would clear the
 * client id and secret of a working connection. So absent keys are dropped rather than defaulted,
 * and `saveExternalMcpServer` applies the keep/replace/clear rule.
 *
 * `clientSecret` is read here and never written back — no read model in this subsystem returns it.
 *
 * @complexity O(1).
 */
function parseExternalMcpOAuthBody({ rawOAuth }: { rawOAuth: unknown }, _optional = {}): { oauth?: SaveExternalMcpOAuthInput } {
  if (rawOAuth === null || typeof rawOAuth !== "object" || Array.isArray(rawOAuth)) return {};
  const oauth = rawOAuth as Record<string, unknown>;

  const parsed: SaveExternalMcpOAuthInput = {
    ...optionalStringField({ value: oauth.providerId, key: "providerId" }),
    ...optionalStringField({ value: oauth.grant, key: "grant" }),
    ...optionalStringField({ value: oauth.clientId, key: "clientId" }),
    ...optionalStringField({ value: oauth.clientSecret, key: "clientSecret" }),
    ...optionalStringField({ value: oauth.scopes, key: "scopes" }),
    ...optionalStringField({ value: oauth.tokenEnvName, key: "tokenEnvName" }),
    ...optionalStringField({ value: oauth.authorizationEndpoint, key: "authorizationEndpoint" }),
    ...optionalStringField({ value: oauth.tokenEndpoint, key: "tokenEndpoint" }),
    ...optionalStringField({ value: oauth.deviceAuthorizationEndpoint, key: "deviceAuthorizationEndpoint" }),
  };

  return Object.keys(parsed).length === 0 ? {} : { oauth: parsed };
}

/**
 * This route's writable PUT fields, read off an untyped body in one place. `label`, `url`,
 * `authMode`, `env` and the whole `oauth` block stay spreadable-optional (an absent key vs. an
 * explicit value are different things — see this route's own doc comment on `env`'s three-way
 * meaning); everything else gets its default here.
 *
 * @complexity O(1).
 */
export function parseExternalMcpPutBody({ rawBody }: { rawBody: unknown }, _optional = {}): ExternalMcpPutFields {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  return {
    ...(typeof body.label === "string" ? { label: body.label } : {}),
    // Defaulted rather than required so a caller that omits it gets the transport that every row
    // written before a second one existed effectively had, instead of a validation error naming a
    // choice it was never offered.
    transport: typeof body.transport === "string" ? body.transport : "stdio",
    enabled: body.enabled !== false,
    command: asStringField({ value: body.command }),
    // Only meaningful for a remote transport, and tri-state so a stdio-shaped PUT does not clear a
    // stored endpoint.
    ...optionalStringField({ value: body.url, key: "url" }),
    // Absent keeps an existing row's mode rather than silently demoting an OAuth connection to
    // `static_env` — which is what a toggle or rename would otherwise do.
    ...optionalStringField({ value: body.authMode, key: "authMode" }),
    args: asStringField({ value: body.args }),
    allowedToolNames: asStringField({ value: body.allowedToolNames }),
    // Same `asStringField` treatment as `allowedToolNames` above — resent in full on every save, not
    // tri-state. NOTE (task #30, R-3): a non-string body value (e.g. an array) collapses to `""`
    // here, which for THIS field silently clears every write grant. Known, pre-existing behaviour of
    // `asStringField` on the sibling field too — undesirable, but it fails CLOSED, so it is not fixed
    // in this change. See `admin-external-mcp-routes.test.ts` for the pinned regression.
    writeAllowedToolNames: asStringField({ value: body.writeAllowedToolNames }),
    // Deliberately NOT `asStringField` — see this route's doc comment. `undefined` must survive.
    ...optionalStringField({ value: body.env, key: "env" }),
    // Same three-way meaning as `env`, and write-only: no read model returns the token.
    ...optionalStringField({ value: body.accessToken, key: "accessToken" }),
    ...optionalStringField({ value: body.accessTokenEnvName, key: "accessTokenEnvName" }),
    ...parseExternalMcpOAuthBody({ rawOAuth: body.oauth }),
    // The version the tab loaded. Absent is still accepted (the save then compares the version read in
    // the same request); a malformed value is a 400, never read as "no basis".
    ...expectedVersionField({ value: body.expectedVersion }),
  };
}

/** `{ expectedVersion }` when the caller sent one. @throws {ToolInputError} when malformed. @complexity O(1). */
function expectedVersionField({ value }: { value: unknown }, _optional = {}): { expectedVersion?: number } {
  const expectedVersion = parseExpectedVersion({ value });
  return expectedVersion === undefined ? {} : { expectedVersion };
}
