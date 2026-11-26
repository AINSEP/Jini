import type { AdminExternalMcpOAuthInput, AdminExternalMcpServer, AdminExternalMcpServerInput } from "@jini-ai/core/contracts/site/cms-external-mcp";
import type { useExternalMcp, ExternalMcpController } from "./use-external-mcp.hooks.js";
type SourceConfigItem = Awaited<ReturnType<ExternalMcpController["dependencies"]["port"]["fetchSources"]>>[number];

/**
 * @file The real transport behind Settings → External MCP, replacing the empty in-memory fake that
 * tab mounted while Tovu had no config store.
 *
 * ## Why field rendering is NOT driven by a fixed `SourceFieldSpec[]` here anymore
 *
 * Earlier versions of this file exported a single static `TOVU_MCP_FIELD_SPECS` array and Tovu
 * mounted `@jini-ai/ui`'s assembled `ExternalMcpTab` directly against it. That stopped being viable
 * once a server could be `stdio` OR `streamable_http`, with credentials `none`/`static_env`/`oauth`:
 * a static spec list has no way to hide `url`/`command` or the OAuth block depending on what the
 * operator is currently choosing, and showing every field for every combination unconditionally is
 * exactly the "here are all the fields, figure out which apply" experience this tab exists to avoid.
 * `../rules.ts`'s `buildExternalMcpFieldSpecs(values)` now computes the visible/required field set
 * from the draft's current values, and `../components/ExternalMcpSettingsPanel.tsx` — Tovu's own
 * replacement for `ExternalMcpTab` — recomputes it live as the operator types. This hook stays
 * unchanged in shape (still a `SourceConfigDependencies` port), it just no longer also hands back one
 * frozen spec list.
 *
 * ## The env field never round-trips a value
 *
 * `fetchSources` cannot populate `env`: no route returns a stored env value, deliberately. So the
 * field always arrives blank, and {@link toWriteBody} omits `env` entirely when it is still blank.
 *
 * That asymmetry is the safe direction and is chosen on purpose. If blank meant "clear", then every
 * enable/disable toggle and every label edit would silently wipe the operator's credentials —
 * exactly the failure the store's `undefined`-vs-`""` distinction exists to prevent. The cost is
 * that clearing credentials from the card alone is not expressible; removing and re-adding the
 * server is. Losing a token by accident is much worse than needing two steps to discard one.
 * `oauthClientSecret` follows the identical rule, for the identical reason — no read model ever
 * returns a stored client secret either.
 */

/** Joins stored argv back into the one-line field the operator edits, double-quoting any argument
 *  that contains whitespace — the one quoting form the server's `parseArgs` reads — so a re-save
 *  (e.g. toggling `enabled`) splits it back into the same arguments instead of breaking a path like
 *  `C:\\Users\\John Smith\\...` in two. @complexity O(n) in the total arg length. */
function joinArgs(args: readonly string[]): string {
  return args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ");
}

/** The OAuth half of an item's form fields. Everything but the client secret round-trips the stored view. */
function oauthItemFields({ server }: { server: AdminExternalMcpServer }, _options: Record<string, never> = {}): Record<string, string> {
  return {
    // The rest of the OAuth block is NOT secret (a client id travels in the authorization URL by
    // design, same as the store's own doc comment on this), so it round-trips the real stored
    // value — only `oauthClientSecret` stays blank, matching `env`.
    oauthProviderId: server.oauth.providerId ?? "",
    oauthGrant: server.oauth.grant ?? "",
    oauthClientId: server.oauth.clientId ?? "",
    oauthClientSecret: "",
    oauthScopes: server.oauth.scopes.join(" "),
    oauthTokenEnvName: server.oauth.tokenEnvName ?? "",
    // Read-only: drives the row's Connect button. `toWriteBody` never sends it.
    oauthStatus: server.oauth.status,
    // The store's `ExternalMcpOAuthView` does not carry a connection's own endpoints back —
    // `providerId` is enough to identify a registered one, and a connection with its own
    // endpoints has no other read model for them today. Left blank rather than guessed; an
    // operator editing a custom-endpoint connection re-enters them, the same disclosed gap
    // `env`/`oauthClientSecret` already accept for secret-shaped fields (this one isn't secret,
    // it just isn't surfaced yet — a future `oauthEndpoints` field on the view would close it).
    oauthAuthorizationEndpoint: "",
    oauthTokenEndpoint: "",
    oauthDeviceAuthorizationEndpoint: "",
  };
}

export function toItem({ server, deps }: { server: AdminExternalMcpServer; deps: Parameters<typeof useExternalMcp>[0]["deps"] }, { locale = "en" }: { locale?: string } = {}): SourceConfigItem {
  return {
    id: server.serverId,
    label: server.label,
    enabled: server.enabled,
    fields: {
      builtIn: server.builtIn ? "true" : "false",
      // The basis for the next save (`expectedVersion`); never rendered, like `builtIn`.
      version: String(server.version),
      id: server.serverId,
      transport: server.transport,
      command: server.command,
      url: server.url ?? "",
      args: joinArgs(server.args),
      allowedToolNames: server.allowedToolNames.join(", "),
      // The operator's second, write-authorization list — same join convention as
      // `allowedToolNames` immediately above, and round-tripped the same way (never blanked, unlike
      // `env`/`oauthClientSecret`: the store returns this list in the clear, so there is nothing to
      // protect by omitting it).
      writeAllowedToolNames: server.writeAllowedToolNames.join(", "),
      authMode: server.authMode,
      // Never populated — see this file's header. The names are surfaced in `statusMessage` instead,
      // so an operator can still see which variables are set.
      env: "",
      ...oauthItemFields({ server }),
      // Write-only, exactly like `oauthClientSecret`: the store seals it and no read model returns it,
      // so it always arrives blank and {@link toAccessTokenWriteBody} treats blank as "keep".
      accessToken: "",
      // A NAME, not a secret — round-trips the real stored value like `oauthTokenEnvName` does.
      accessTokenEnvName: server.accessTokenEnvName ?? "",
    },
    ...includeIfDefined({ key: "statusMessage", value: describeStoredCredentials({ server, deps }, { locale }) }),
  };
}

/** The card's "what is stored" line: env variable NAMES and whether an access token is held — never
 *  a value. `undefined` when neither is stored, so the card shows no status line at all.
 *  @complexity O(n) in the env variable count. */
function accessTokenHintSuffix({ server, locale, deps }: { server: AdminExternalMcpServer; locale: string; deps: Parameters<typeof useExternalMcp>[0]["deps"] }, _options = {}): string {
  return server.accessTokenHint ? ` (${deps.formatCredentialHint({ hint: server.accessTokenHint, locale })})` : "";
}

export function describeStoredCredentials({ server, deps }: { server: AdminExternalMcpServer; deps: Parameters<typeof useExternalMcp>[0]["deps"] }, { locale = "en" }: { locale?: string } = {}): string | undefined {
  const parts = [
    ...(server.envNames.length > 0 ? [deps.formatCredentialHints({ hints: server.envTokenHints, locale }) || `Credentials set: ${server.envNames.join(", ")}`] : []),
    ...(server.hasAccessToken ? [deps.credentialText({ id: 'set', locale }) + accessTokenHintSuffix({ server, locale, deps })] : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** The `static_env` access-token half of a save, or nothing for any other auth mode — the store only
 *  reads these for a `static_env` row. Both are omit-when-blank: a blank token means "keep the sealed
 *  one" (the `env` rule), and a blank variable name resolves to the stored name server-side either way,
 *  so omitting it keeps every other mode's write body byte-identical to before this field existed.
 *  @complexity O(1). */
export function toAccessTokenWriteBody({ fields, deps }: { fields: Record<string, string>; deps: Parameters<typeof useExternalMcp>[0]["deps"] }, _optional = {}): Pick<AdminExternalMcpServerInput, "accessToken" | "accessTokenEnvName"> {
  if (deps.resolveExternalMcpEffectiveAuthMode(fields) !== "static_env") return {};
  return {
    ...(fieldOrEmpty({ fields, key: "accessToken" }) === "" ? {} : { accessToken: fieldOrEmpty({ fields, key: "accessToken" }) }),
    ...omitIfBlank({ key: "accessTokenEnvName", value: fieldOrEmpty({ fields, key: "accessTokenEnvName" }) }),
  };
}

/** `fields[key] ?? ""` as a named helper — same rationale as `MenuEditor.tsx`'s `orEmpty`:
 *  ESLint's cyclomatic-complexity rule counts each `??` as its own branch, and
 *  {@link toOAuthWriteBody}/{@link toWriteBody} each default many fields this way. Naming it moves
 *  the count out of both functions' own scope without changing what either produces — every field
 *  still falls back to the same `""` for the same absent value it did before. */
export function fieldOrEmpty({ fields, key }: { fields: Record<string, string>; key: string }, _options = {}): string {
  return fields[key] ?? "";
}

/** `value.trim() === "" ? {} : { [key]: value }` as a named helper. The store reads the PRESENCE
 *  of these keys (not just their value) to decide whether a save touched OAuth identity or a
 *  tri-state field like `env` — see {@link toOAuthWriteBody}'s own doc — so the omit-when-blank
 *  convention must stay byte-for-byte the same; this only moves each call site's ternary branch
 *  out of the caller's own complexity count. */
function omitIfBlank<K extends string>({ key, value }: { key: K; value: string }, _options = {}): { [P in K]?: string } {
  return (value.trim() === "" ? {} : { [key]: value }) as { [P in K]?: string };
}

/** `value === undefined ? {} : { [key]: value }` as a named helper — same rationale as
 *  {@link omitIfBlank}, for the two fields (`label`, `oauth`) whose tri-state is "was this
 *  argument passed at all", not "is this string blank". */
function includeIfDefined<K extends string, V>({ key, value }: { key: K; value: V | undefined }, _options = {}): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

/** Builds the OAuth block for a save, or `undefined` when the draft's effective auth mode isn't
 *  `oauth` — matching the store's own `resolveOAuthFields`, which ignores the whole block outside
 *  that mode. `grant`/`clientId`/`scopes`/`tokenEnvName` are sent as-is: {@link toItem} round-trips
 *  their real stored value, so the store's own `firstTrimmed` precedence resolves them correctly
 *  whether or not the operator touched them. `providerId` and the three endpoint fields are
 *  omit-when-blank instead — the same convention `clientSecret` already uses — because the store
 *  reads their PRESENCE, not their value, to decide whether this save touched the connection's OAuth
 *  identity (`resolveOAuthEndpoints`). Endpoints are never round-tripped by {@link toItem} today, so
 *  sending them as an always-present blank string made every save look like an identity change and
 *  silently destroyed the stored token, refresh token, and DCR-minted client secret.
 *  @complexity O(1). */
function toOAuthWriteBody({ fields, deps }: { fields: Record<string, string>; deps: Parameters<typeof useExternalMcp>[0]["deps"] }, _optional = {}): AdminExternalMcpOAuthInput | undefined {
  if (deps.resolveExternalMcpEffectiveAuthMode(fields) !== "oauth") return undefined;
  return {
    ...omitIfBlank({ key: "providerId", value: fieldOrEmpty({ fields, key: "oauthProviderId" }) }),
    grant: fieldOrEmpty({ fields, key: "oauthGrant" }),
    clientId: fieldOrEmpty({ fields, key: "oauthClientId" }),
    scopes: fieldOrEmpty({ fields, key: "oauthScopes" }),
    tokenEnvName: fieldOrEmpty({ fields, key: "oauthTokenEnvName" }),
    ...omitIfBlank({ key: "authorizationEndpoint", value: fieldOrEmpty({ fields, key: "oauthAuthorizationEndpoint" }) }),
    ...omitIfBlank({ key: "tokenEndpoint", value: fieldOrEmpty({ fields, key: "oauthTokenEndpoint" }) }),
    ...omitIfBlank({ key: "deviceAuthorizationEndpoint", value: fieldOrEmpty({ fields, key: "oauthDeviceAuthorizationEndpoint" }) }),
    ...omitIfBlank({ key: "clientSecret", value: fieldOrEmpty({ fields, key: "oauthClientSecret" }) }),
  };
}

/** `{ expectedVersion }` from the item this tab last loaded or saved, so a save from an old screen is refused. @complexity O(1). */
export function expectedVersionOf({ item }: { item: SourceConfigItem | undefined }, _options = {}): { expectedVersion?: number } {
  const version = Number(item?.fields.version);
  return Number.isSafeInteger(version) ? { expectedVersion: version } : {};
}

/**
 * Builds the write body from a field map, omitting `env`/`oauth.clientSecret` when blank.
 *
 * `command`/`url` are both always sent regardless of transport — harmless, since the store's own
 * `resolveTransportTarget` reads only the one that matches `transport` and ignores the other, and
 * sending both unconditionally is simpler than a transport-keyed omission that would buy nothing.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function toWriteBody({ fields, enabled, deps }: { fields: Record<string, string>; enabled: boolean; deps: Parameters<typeof useExternalMcp>[0]["deps"] }, { label }: { label?: string } = {}): AdminExternalMcpServerInput {
  const oauth = toOAuthWriteBody({ fields, deps });
  return {
    ...includeIfDefined({ key: "label", value: label }),
    transport: fields.transport || "stdio",
    enabled,
    command: fieldOrEmpty({ fields, key: "command" }),
    url: fieldOrEmpty({ fields, key: "url" }),
    args: fieldOrEmpty({ fields, key: "args" }),
    allowedToolNames: fieldOrEmpty({ fields, key: "allowedToolNames" }),
    // Resent in full on every save, same as `allowedToolNames` just above — NOT tri-state like
    // `env` below, because the store always returns this list in the clear and the tab can always
    // resend it. The server's own C-006 check rejects a name here absent from `allowedToolNames`.
    writeAllowedToolNames: fieldOrEmpty({ fields, key: "writeAllowedToolNames" }),
    authMode: deps.resolveExternalMcpEffectiveAuthMode(fields),
    // Blank means "untouched", never "clear" — see this file's header.
    ...omitIfBlank({ key: "env", value: fieldOrEmpty({ fields, key: "env" }) }),
    ...toAccessTokenWriteBody({ fields, deps }),
    ...includeIfDefined({ key: "oauth", value: oauth }),
  };
}

