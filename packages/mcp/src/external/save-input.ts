import { requireString, ToolInputError } from '@jini-ai/core';
import type { UUID } from '@jini-ai/core/primitives';
import type { SaveExternalMcpOAuthInput, SaveExternalMcpServerInput } from '@jini-ai/core/contracts/hosted-mcp';
import type { ExternalMcpSaveInput } from './save-form.js';
import type { ExternalMcpToolDeps } from './tool-registrations.js';

/** Reads `input[key]` as a string, or `undefined` for anything else — the same tri-state reading
 *  rule every other optional field in this domain's save path already follows (see `save-form.ts`'s
 *  header). @complexity O(1). */
export function optionalStringField({ input, key }: { input: Record<string, unknown>; key: string }, _optional = {}): string | undefined {
  return typeof input[key] === "string" ? (input[key] as string) : undefined;
}

/** Reads `input[key]` as a string, treating a blank (empty-after-trim) value the same as absent:
 *  `undefined`. For the handful of fields this form never prefills back with the stored secret —
 *  `env` (`save-form.ts:164`) and the OAuth client secret (`save-form.ts:212`) — the field hint tells
 *  the human "leave blank to keep the stored value", so a blank submission must carry forward what is
 *  already saved, not `optionalStringField`'s ordinary `""`. The store's own PUT contract still lets
 *  `""` mean "clear" ({@link resolveExternalMcpSealedEnv}, `resolveSealedOAuthBlob` in
 *  `external-mcp-store.ts`) for callers that DO round-trip the current value — that contract is
 *  unchanged; only this form's blank-means-absent mapping is fixed here.
 *  @complexity O(1). */
function optionalSecretField({ input, key }: { input: Record<string, unknown>; key: string }, _optional = {}): string | undefined {
  const value = optionalStringField({ input, key });
  return value === undefined || value === "" ? undefined : value;
}

/** The model's own {@link ExternalMcpSaveInput} fields beyond `id`/`transport` — every one of
 *  `SAVE_INPUT_SCHEMA`'s optional string properties (`agent-tools.ts`), read the same tri-state way
 *  the submitted form's own params are read below. */
const SAVE_MODEL_OPTIONAL_FIELDS = [
  "label",
  "command",
  "args",
  "url",
  "allowedToolNames",
  "writeAllowedToolNames",
  "authMode",
  "accessTokenEnvName",
  "oauthProviderId",
  "oauthGrant",
  "oauthClientId",
  "oauthScopes",
  "oauthTokenEnvName",
  "oauthAuthorizationEndpoint",
  "oauthTokenEndpoint",
  "oauthDeviceAuthorizationEndpoint",
] as const satisfies readonly (keyof ExternalMcpSaveInput)[];

/** Narrows the model's OWN `external_mcp_save` call input into {@link ExternalMcpSaveInput} — the
 *  shape `mergeExternalMcpSavePrefill`/`buildExternalMcpSaveForm` take to generate the form the
 *  human actually sees. `id` is normalized the same way `saveExternalMcpServer` itself normalizes
 *  it (trim + lowercase), so the existing-row lookup below matches what a prior save actually
 *  stored. @complexity O(1) — a fixed field list. */
export function buildModelSaveInput(input: Record<string, unknown>, { assertCredentialFreeField }: Pick<ExternalMcpToolDeps, "assertCredentialFreeField">): ExternalMcpSaveInput {
  if (Object.keys(input).some(key => key !== "id" && key !== "transport" && key !== "enabled" && !SAVE_MODEL_OPTIONAL_FIELDS.some(field => field === key))) {
    throw new ToolInputError({ message: "external_mcp_save: credentials belong in the human form, never in this tool input. Nothing was saved." });
  }
  const id = requireString({ input, key: "id" }).trim().toLowerCase();
  const transport = requireString({ input, key: "transport" });
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new ToolInputError({ message: "'enabled' must be true or false. Nothing was saved." });
  let save: ExternalMcpSaveInput = { id, transport, ...(input.enabled === undefined ? {} : { enabled: input.enabled as boolean }) };
  for (const key of SAVE_MODEL_OPTIONAL_FIELDS) {
    const value = optionalStringField({ input, key });
    if (value !== undefined) { assertCredentialFreeField({ value, field: key }); save = { ...save, [key]: value }; }
  }
  return save;
}

/** The submitted form field name -> {@link SaveExternalMcpOAuthInput} field name pairs —
 *  `save-form.ts`'s `buildOAuthCoreFields`/`buildOAuthTokenEnvField`/`buildOAuthEndpointFields` own
 *  the field NAMES on the rendered side; this is the one place that maps them back. */
const OAUTH_FORM_FIELD_MAP = [
  ["oauthProviderId", "providerId"],
  ["oauthGrant", "grant"],
  ["oauthClientId", "clientId"],
  ["oauthClientSecret", "clientSecret"],
  ["oauthScopes", "scopes"],
  ["oauthTokenEnvName", "tokenEnvName"],
  ["oauthAuthorizationEndpoint", "authorizationEndpoint"],
  ["oauthTokenEndpoint", "tokenEndpoint"],
  ["oauthDeviceAuthorizationEndpoint", "deviceAuthorizationEndpoint"],
] as const;

/** Builds the OAuth half of a save from the submitted form's params — only rendered fields are ever
 *  present (see this file's header), so an absent key here means the form never showed that field,
 *  not that the human left it blank. `undefined` when nothing OAuth-shaped was submitted.
 *  @complexity O(1) — a fixed field list. */
function buildOAuthSaveInputFromFormParams(params: Record<string, unknown>): SaveExternalMcpOAuthInput | undefined {
  let oauth: SaveExternalMcpOAuthInput = {};
  for (const [formKey, oauthKey] of OAUTH_FORM_FIELD_MAP) {
    // `oauthClientSecret` is the one OAuth field this form never prefills back with the stored value
    // (`save-form.ts:212`'s hint: "Leave blank to keep the stored secret") — every other OAuth field
    // IS prefilled from the existing row, so a blank one there is a genuine, intentional clear.
    const value = formKey === "oauthClientSecret" ? optionalSecretField({ input: params, key: formKey }) : optionalStringField({ input: params, key: formKey });
    if (value !== undefined) oauth = { ...oauth, [oauthKey]: value };
  }
  return Object.keys(oauth).length === 0 ? undefined : oauth;
}

/**
 * Maps the human's SUBMITTED form (`answer.params`, already past the `received`/dismissed checks)
 * onto {@link SaveExternalMcpServerInput} — `saveExternalMcpServer`'s own input shape.
 *
 * `enabled: true` always: `save-form.ts`'s rendered fields never include an enabled toggle (this
 * tool's job is "connect a server", not "flip one that already exists off/on"), so every save this
 * tool ever performs both creates and enables, or re-enables, the row — matching the admin PUT
 * route's own default (`enabled: body.enabled !== false`) for the identical "caller sent nothing"
 * case. `writeAllowedToolNames` is read from the submitted form the same tri-state way
 * `allowedToolNames` is (`optionalStringField(params, ...) ?? ""`) — see `save-form.ts`'s
 * `writeAllowedToolNames` field/`mergeExternalMcpSavePrefill` for the field this reads and its
 * prefill-from-existing-row behavior. 2026-09-08 fix: this used to hardcode `""` unconditionally,
 * silently dropping every write grant on any save performed through the assistant — this domain's
 * form now has the field `SaveExternalMcpServerInput`'s own doc always assumed an un-migrated caller
 * would eventually grow (ADS-memory/reports/2026-09-08-dock-recovery-product-test.md).
 *
 * @complexity O(1) — a fixed field list.
 */
export function buildSaveExternalMcpServerInputFromFormParams(
  { params, workspaceId, principalId }: { params: Record<string, unknown>; workspaceId: UUID; principalId: string }, _optional = {},
): SaveExternalMcpServerInput {
  const optionalFields = Object.fromEntries(
    ["label", "url", "authMode", "accessTokenEnvName"]
      .map(key => [key, optionalStringField({ input: params, key })])
      .filter(([, value]) => value !== undefined),
  );
  const serverIdRaw = params.id;
  const transportRaw = params.transport;
  if (typeof serverIdRaw !== "string" || typeof transportRaw !== "string") {
    // Both come from prepared state, formerly `baseParams` on every render — their absence means
    // the domain save port was called without this tool's bound destination.
    throw new Error("external_mcp_save: the submitted form is missing 'id' or 'transport'.");
  }

  return {
    workspaceId,
    serverId: serverIdRaw,
    transport: transportRaw,
    ...optionalFields,
    enabled: params.enabled as boolean,
    command: optionalStringField({ input: params, key: "command" }) ?? "",
    args: optionalStringField({ input: params, key: "args" }) ?? "",
    allowedToolNames: optionalStringField({ input: params, key: "allowedToolNames" }) ?? "",
    writeAllowedToolNames: optionalStringField({ input: params, key: "writeAllowedToolNames" }) ?? "",
    ...readOptionalSecretInputs({ params }),
    principalId,
  };
}

/** The save form's optional secret-bearing fields; each is omitted, never defaulted, when absent. */
function readOptionalSecretInputs(
  { params }: { params: Record<string, unknown> }, _optional = {},
): Pick<SaveExternalMcpServerInput, "env" | "accessToken" | "oauth"> {
  const env = optionalSecretField({ input: params, key: "env" });
  const accessToken = optionalSecretField({ input: params, key: "accessToken" });
  const oauth = buildOAuthSaveInputFromFormParams(params);
  return {
    ...(env !== undefined ? { env } : {}),
    ...(accessToken !== undefined ? { accessToken } : {}),
    ...(oauth !== undefined ? { oauth } : {}),
  };
}

