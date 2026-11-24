import type { SecretCardField, SecretCardForm } from "@jini-ai/core/contracts/cards";
import type { ExternalMcpServerView as CanonicalExternalMcpServerView } from "@jini-ai/core/contracts/hosted-mcp";
import { toolMetadata as externalMcpToolMetadata } from "@jini-ai/core/tool-metadata/external-mcp";

/** The admin read model with any host's credential-hint shape: the prefill reads no hint. */
type ExternalMcpServerView = CanonicalExternalMcpServerView<unknown>;
/** The secret marker comes from the same external MCP tool metadata the host's secret-form gate
 *  projects its protected ids from, so the gate and this form can never disagree. */
const SECRET_FORM_CARD_DEFINITIONS = { external_mcp_save: externalMcpToolMetadata.external_mcp_save.mcpUi } as const;

/**
 * @file The confirmation form `external_mcp_save` renders — see `tool-registrations.ts`'s handler
 * for how it is opened, answered, and turned into a real write.
 *
 * ## Why the field LIST is computed once, not reactive
 *
 * The host admin UI's `rules.ts`'s `buildExternalMcpFieldSpecs` solves the identical
 * "which fields apply to this transport/authMode" decision for the admin UI, where it must be
 * REACTIVE — a human can change their mind mid-form. An MCP-UI form has no such need: it is a
 * server-rendered HTML document generated once per tool call, and the agent has already committed
 * to a transport/authMode by the time it calls this tool (see `agent-tools.ts`'s own schema doc).
 * So this file restates the SAME decision rules as a one-shot computation over the tool's own input,
 * rather than importing the admin package's React-specific type. Two independent, intentionally
 * parallel implementations of one documented rule — not a shared abstraction — because the two
 * outputs are genuinely different shapes (`@jini-ai/ui`'s `SourceFieldSpec` vs `@jini-ai/ui/mcp-ui/
 * secret-card`'s `SecretCardField`) for two different rendering systems.
 *
 * ## Secrets never appear as `value`
 *
 * `env`/`accessToken`/`oauthClientSecret` are rendered `secret: true` with NO `value` — never pre-filled, even
 * when updating a row that already has one, because there is nothing to pre-fill FROM: no read model
 * in this subsystem ever returns a stored secret (see the host admin UI's own `use-external-mcp.hooks.ts`
 * header for the identical rule, restated for the identical reason). Leaving it blank on submit is
 * what "keep what's stored" means to `saveExternalMcpServer` — the same tri-state convention the
 * admin form's own write path already relies on.
 */

export const EXTERNAL_MCP_SAVE_TOOL_ID = "external_mcp_save";

/** `external_mcp_save`'s own non-secret input, narrowed to what {@link buildExternalMcpSaveFormFields}
 *  and {@link buildExternalMcpSaveForm} actually read. Matches `agent-tools.ts`'s `SAVE_INPUT_SCHEMA`
 *  property-for-property. */
export interface ExternalMcpSaveInput {
  id: string;
  label?: string | undefined;
  enabled?: boolean | undefined;
  transport: string;
  command?: string | undefined;
  args?: string | undefined;
  url?: string | undefined;
  allowedToolNames?: string | undefined;
  /** Raw operator input, comma-separated remote tool names separately authorized to write —
   *  `SaveExternalMcpServerInput.writeAllowedToolNames`'s own tri-state convention (resent in full on
   *  every save, not tri-state like `env`; see `tool-registrations.ts`'s
   *  `buildSaveExternalMcpServerInputFromFormParams` for why). The store rejects a name here that is
   *  not also in `allowedToolNames` (`external-mcp-store.ts`'s `assertWriteAllowlistSubset`). */
  writeAllowedToolNames?: string | undefined;
  authMode?: string | undefined;
  /** Non-secret name of the stdio variable that receives the human-entered token. */
  accessTokenEnvName?: string | undefined;
  oauthProviderId?: string | undefined;
  oauthGrant?: string | undefined;
  oauthClientId?: string | undefined;
  oauthScopes?: string | undefined;
  oauthTokenEnvName?: string | undefined;
  oauthAuthorizationEndpoint?: string | undefined;
  oauthTokenEndpoint?: string | undefined;
  oauthDeviceAuthorizationEndpoint?: string | undefined;
}

/**
 * Merges the agent's own input over an existing row's current (non-secret) values, so an UPDATE's
 * form shows the human accurate current state for anything the agent did not explicitly restate,
 * rather than blanks. `existing` is `undefined` for a brand-new id.
 *
 * @complexity O(1).
 */
export function mergeExternalMcpSavePrefill(
  { input, existing }: { input: ExternalMcpSaveInput; existing: ExternalMcpServerView | undefined }, _optional = {},
): ExternalMcpSaveInput {
  if (!existing) return input;
  const prefill: ExternalMcpSaveInput = {
    id: input.id,
    label: existing.label,
    enabled: existing.enabled,
    transport: input.transport,
    command: existing.command,
    // Quoted the way `parseArgs` reads them, so an unchanged card saves the same arguments.
    args: existing.args.map((arg) => (arg === "" || /\s/.test(arg) ? `"${arg}"` : arg)).join(" "),
    url: existing.url ?? undefined,
    allowedToolNames: existing.allowedToolNames.join(", "),
    writeAllowedToolNames: existing.writeAllowedToolNames.join(", "),
    authMode: existing.authMode,
    accessTokenEnvName: existing.accessTokenEnvName ?? undefined,
    oauthProviderId: existing.oauth.providerId ?? undefined,
    oauthGrant: existing.oauth.grant ?? undefined,
    oauthClientId: existing.oauth.clientId ?? undefined,
    oauthScopes: existing.oauth.scopes.join(" "),
    oauthTokenEnvName: existing.oauth.tokenEnvName ?? undefined,
    // NOT merged from `existing` — `ExternalMcpOAuthView` carries no field for a connection's own
    // typed endpoints (only `providerId`, for a registered one). There is nothing stored to merge
    // from; see the host admin UI's `use-external-mcp.hooks.ts` header for the identical, already-disclosed
    // gap on the admin side.
    oauthAuthorizationEndpoint: input.oauthAuthorizationEndpoint,
    oauthTokenEndpoint: input.oauthTokenEndpoint,
    oauthDeviceAuthorizationEndpoint: input.oauthDeviceAuthorizationEndpoint,
  };
  return Object.keys(prefill).reduce((merged, field) => {
    const key = field as keyof ExternalMcpSaveInput;
    return { ...merged, [key]: input[key] ?? merged[key] };
  }, prefill);
}

/** `{ value }` when `value` is present, an empty object otherwise — the shared shape every optional
 *  field spread in this file's field builders used to write inline as `value !== undefined ? {value}
 *  : {}`. Collapsing it into a call removes that ternary from every call site's own complexity count. */
function fieldValue<T>({ value }: { value: T | undefined }, _optional = {}): { value: T } | Record<string, never> {
  return value !== undefined ? { value } : {};
}

function buildStdioTransportFields(input: ExternalMcpSaveInput): SecretCardField[] {
  return [
    { kind: "string", name: "command", label: "Command", required: true, ...fieldValue({ value: input.command }), placeholder: "e.g. npx, node, /path/to/binary" },
    { kind: "string", name: "args", label: "Args", ...fieldValue({ value: input.args }), placeholder: "space-separated" },
  ];
}

/** A credential stays exclusively in the human form, with blank update submissions preserving it.
 * @complexity O(1) for a fixed field list.
 */
function buildStaticTokenFields({ input, isUpdate, isStdio }: { input: ExternalMcpSaveInput; isUpdate: boolean; isStdio: boolean }, _optional = {}): SecretCardField[] {
  return [
    { kind: "string", name: "accessToken", label: "Access token", ...SECRET_FORM_CARD_DEFINITIONS.external_mcp_save.secretField, allowBlank: true, hint: isUpdate ? "Leave blank to keep the stored token." : "Enter the API key or bearer token for this server." },
    ...(isStdio ? [{ kind: "string" as const, name: "accessTokenEnvName", label: "Access token environment variable", ...fieldValue({ value: input.accessTokenEnvName }), hint: "The environment variable name the local command reads, e.g. API_TOKEN." }] : []),
  ];
}

function buildEnvField({ isUpdate }: { isUpdate: boolean }, _optional = {}): SecretCardField {
  return {
    kind: "string",
    name: "env",
    label: "Environment variables",
    multiline: true,
    rows: 3,
    ...SECRET_FORM_CARD_DEFINITIONS.external_mcp_save.secretField, allowBlank: true,
    placeholder: "KEY=VALUE, one per line",
    ...(isUpdate ? { hint: "Leave blank to keep the stored values." } : {}),
  };
}

/**
 * `isStdio` decides which OAuth fields a human must actually fill in, and it is not a cosmetic
 * distinction: `external-mcp-store.ts`'s `assertOAuthClientId` / `assertOAuthGrant` /
 * `assertOAuthProviderIdentity` admit an EMPTY client id, sign-in method and provider identity on any
 * non-stdio row, because a row carrying a remote URL can run RFC 8414 discovery against it, read the
 * server's own `grant_types_supported`, and mint its own client by RFC 7591 dynamic registration. A
 * growing share of hosted MCP servers publish a registration endpoint and no developer console at
 * all, so for those there is no client id — or a confident answer about the grant — a human could
 * type; marking either field required made the form unsubmittable by any amount of operator effort.
 * A stdio row has no URL to discover from, so there the requirement stands. Same rule, same
 * reasoning, same wording as the host admin UI's `rules.ts`'s
 * `buildExternalMcpFieldSpecs`.
 */
function buildOAuthCoreFields({ input, isUpdate, isStdio }: { input: ExternalMcpSaveInput; isUpdate: boolean; isStdio: boolean }, _optional = {}): SecretCardField[] {
  return [
    {
      kind: "string",
      name: "oauthProviderId",
      label: "Provider ID",
      ...fieldValue({ value: input.oauthProviderId }),
      hint: isStdio
        ? "Leave blank to use your own endpoints below."
        : "Leave blank unless this server is a registered provider — a hosted server discovers its own endpoints.",
    },
    {
      kind: "enum",
      name: "oauthGrant",
      label: "Sign-in method",
      required: isStdio,
      options: [
        { value: "authorization_code", label: "Browser sign-in" },
        { value: "device_code", label: "Device code" },
      ],
      ...fieldValue({ value: input.oauthGrant }),
      ...(isStdio ? {} : { hint: "Detected from the server unless overridden." }),
    },
    {
      kind: "string",
      name: "oauthClientId",
      label: "Client ID",
      required: isStdio,
      ...fieldValue({ value: input.oauthClientId }),
      ...(isStdio ? {} : { placeholder: "leave blank to register with this server automatically" }),
    },
    { kind: "string", name: "oauthClientSecret", label: "Client secret", ...SECRET_FORM_CARD_DEFINITIONS.external_mcp_save.secretField, allowBlank: true, hint: isUpdate ? "Leave blank to keep the stored secret." : "Leave blank if this provider needs none (a public/PKCE client)." },
    { kind: "string", name: "oauthScopes", label: "Scopes", ...fieldValue({ value: input.oauthScopes }), placeholder: "space- or comma-separated" },
  ];
}

function buildOAuthTokenEnvField(input: ExternalMcpSaveInput): SecretCardField {
  return {
    kind: "string",
    name: "oauthTokenEnvName",
    label: "Access token environment variable",
    required: true,
    ...fieldValue({ value: input.oauthTokenEnvName }),
  };
}

/** What an endpoint field means on a row that self-configures: a manual override for the case where
 *  discovery does not answer, not something to go and look up. See {@link buildOAuthCoreFields}. */
const DISCOVERABLE_ENDPOINT_HINT = "Leave blank unless discovery against this server's URL fails.";

function buildOAuthEndpointFields({ input, isStdio }: { input: ExternalMcpSaveInput; isStdio: boolean }, _optional = {}): SecretCardField[] {
  return [
    {
      kind: "string",
      name: "oauthAuthorizationEndpoint",
      label: "Authorization endpoint",
      ...fieldValue({ value: input.oauthAuthorizationEndpoint }),
      hint: isStdio ? "Needed for Browser sign-in, unless Provider ID is set." : DISCOVERABLE_ENDPOINT_HINT,
    },
    {
      kind: "string",
      name: "oauthTokenEndpoint",
      label: "Token endpoint",
      ...fieldValue({ value: input.oauthTokenEndpoint }),
      hint: isStdio ? "Needed unless Provider ID is set." : DISCOVERABLE_ENDPOINT_HINT,
    },
    {
      kind: "string",
      name: "oauthDeviceAuthorizationEndpoint",
      label: "Device authorization endpoint",
      ...fieldValue({ value: input.oauthDeviceAuthorizationEndpoint }),
      hint: isStdio ? "Needed for Device code, unless Provider ID is set." : DISCOVERABLE_ENDPOINT_HINT,
    },
  ];
}

function buildOAuthFields({ input, isUpdate, isStdio }: { input: ExternalMcpSaveInput; isUpdate: boolean; isStdio: boolean }, _optional = {}): SecretCardField[] {
  return [...buildOAuthCoreFields({ input, isUpdate, isStdio }), ...(isStdio ? [buildOAuthTokenEnvField(input)] : []), ...buildOAuthEndpointFields({ input, isStdio })];
}

/**
 * The field list for one save form — see this file's header for why this is computed once rather
 * than reactively. Composed from per-section builders (transport, env, oauth) so the section that
 * decides inclusion stays a flat list of ternaries, and each section's own field shape lives in its
 * own single-purpose function.
 *
 * @complexity O(1) — a fixed, bounded number of conditionally-included entries.
 */
export function buildExternalMcpSaveFormFields({ input, isUpdate }: { input: ExternalMcpSaveInput; isUpdate: boolean }, _optional = {}): SecretCardField[] {
  const isStdio = input.transport !== "streamable_http";
  const isOAuth = input.authMode === "oauth";

  return [
    ...(isUpdate ? [] : [{ kind: "string" as const, name: "id", label: "ID", required: true, value: input.id, hint: "Lowercase letters, digits and dashes." }]),
    { kind: "string", name: "label", label: "Display name", ...fieldValue({ value: input.label }) },
    ...(isStdio ? buildStdioTransportFields(input) : [{ kind: "string" as const, name: "url", label: "URL", required: true, ...fieldValue({ value: input.url }), placeholder: "https://…" }]),
    ...(isStdio ? [buildEnvField({ isUpdate })] : []),
    ...(input.authMode === "static_env" || input.authMode === undefined ? buildStaticTokenFields({ input, isUpdate, isStdio }) : []),
    ...(isOAuth ? buildOAuthFields({ input, isUpdate, isStdio }) : []),
  ];
}

/** Fixed grant disclosures share the credential form without becoming editable fields.
 * @complexity O(a+w) in the bounded proposed tool-name strings; no effects.
 */
function fixedAccessDetails(save: ExternalMcpSaveInput) {
  return [{ label: "Allowed tools", value: save.allowedToolNames || "None" },
    { label: "May write", value: save.writeAllowedToolNames || "None" },
    ...(save.enabled === false ? [{ label: "Connection access", value: "Disabled" }] : [])];
}

/**
 * Builds `external_mcp_save`'s confirmation form.
 *
 * `id`/`transport`/`authMode` are bound to prepared state at save rather than trusted from submit — see this file's
 * header on why the field SET is fixed per call; changing transport or auth mode is "call this tool
 * again", not an in-form control. The engine posts back on cancel rather than a silent close — with the call
 * parked, a silent close would strand the handler for the full TTL staring at a form the human
 * already walked away from.
 *
 * @complexity O(f) in the field count this call includes.
 * @returns Domain form copy and fields; the engine supplies routing/dismissal and renders the card.
 * @example buildExternalMcpSaveForm({ save: { id: "server", transport: "streamable_http" }, isUpdate: false, appName: "host-external-mcp-save" });
 */
export function buildExternalMcpSaveForm(input: {
  save: ExternalMcpSaveInput;
  isUpdate: boolean;
  /** The host's MCP-UI app name for this form (host identity, so host-supplied). */
  appName: string;
}, _optional = {}): SecretCardForm {
  const { save, isUpdate, appName } = input;
  let credentials = "API key / token";
  if (save.authMode === "oauth") credentials = "Connect via OAuth";
  if (save.authMode === "none") credentials = "None needed";
  return {
    title: isUpdate ? `Update "${save.id}"` : `Add "${save.id}"`,
    description: (isUpdate
      ? "The assistant wants to update this external MCP server's configuration. Review and edit anything before saving."
      : "The assistant wants to add this external MCP server. Review and edit anything before saving.") +
      " Saved for the whole site: every chat and agent can use it, with approvals.",
    details: [
      { label: "Connection type", value: save.transport === "streamable_http" ? "Hosted server (URL)" : "Local command (stdio)" },
      { label: "Credentials", value: credentials },
      ...fixedAccessDetails(save),
      ...(save.transport === "streamable_http" ? [] : [{ label: "Local access", value: `Saving lets chats start ${save.command ?? "the command below"} on this computer as your OS user.` }]),
    ],
    submitLabel: isUpdate ? "Save changes" : "Add server",
    fields: buildExternalMcpSaveFormFields({ input: save, isUpdate }),
    cancelLabel: "Cancel",
    app: { appName, appVersion: "1" },
  };
}
