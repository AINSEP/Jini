import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";
import type { SurfaceCardSecretForm, SurfaceCardSecretRun as SecretCardRun, SurfaceCardsPort } from "@jini-ai/core/contracts/cards";
import { adaptLegacyAuthorize, requireToolPermission, type LegacyToolAuthorizeFn as AuthorizeFn } from "@jini-ai/core";
import { requireInputRecord, ToolInputError, type ToolExecutionOptions, type ToolExecutionContext } from "@jini-ai/core";
import type { SurfaceAskThenReport, SurfaceExchangeStore } from "@jini-ai/core";
import {
  deriveAgentPluginConnectionId, provisionAgentPluginMcpServers,
  type AgentPluginMcpPort, type AgentPluginMcpRecord, type AgentPluginMcpProjectionPorts,
  type AgentPluginMcpTrustClassifier, type AgentPluginMcpFederationMessages, type SavedTokenSwitchOutcome,
} from "@jini-ai/agent-plugins/connect";
import type { AgentPluginTokenAuth, RemoteMcpServerConfig } from "@jini-ai/agent-plugins/lifecycle";

import {
  buildAgentPluginAccessTokenFormWithPorts, buildAgentPluginAccessTokenOutcomeWithPorts, resolveAgentPluginCardIdentity,
  type AgentPluginAccessTokenFormMessages, type AgentPluginCardIdentity,
} from "./connect-card-ui.js";
import { titleCaseFromPluginId, type ResolvedAgentPluginForConnect } from "./connect-tool.js";

/**
 * @file `agent_plugin_set_access_token` — the generic access-token fallback for an Agent Plugin whose
 * remote server declares `tokenAuth { helpUrl, probeUrl }` in its `mcp.json` (`manifest.ts`).
 * Used when `agent_plugin_connect`'s sign-in cannot start.
 *
 * Moved here on 2026-09-29 from `features/supabase-connect/` (SPEC-052's `supabase_set_access_token`),
 * so no vendor code is left in core: the tokens page and the probe URL now come from the plugin.
 *
 * A Jini secret-card spec with domain copy from `connect-card-ui.ts`; the submitted token is probed with one GET to the declared
 * `probeUrl` (401/403 = refused for this purpose), then saved as the plugin row's sealed `static_env` access token
 * through `saveExternalMcpServer`. The store sends that token to the hosted server as
 * `Authorization: Bearer`, and switching the row's auth mode replaces any unfinished OAuth attempt on
 * it. The save itself carries `enabled` and the tool lists forward; then `switch-on-saved-token.ts`
 * switches the plugin on with its declared default tools, exactly as a first sign-in does, unless an
 * operator deliberately turned it off (the result then names the screen that turns it back on).
 *
 * The tool takes only a `pluginId`: the token arrives through the form's own submission, never
 * through a model-issued call. Driven by `askThenReport`, like `custom_credential_set_token`: a second
 * send replaces the form with the real outcome once the probe and save have run. Fails closed with no
 * `emitSurface`.
 */



/** Product vocabulary of the token tool: every refusal names the host's tool and product.
 * @agent-note Second host: return YOUR tool name and product wording; never put a token or a vendor
 * response body in any of these strings. `credentialText`/`translateCredentialMessage` are your
 * localized credential copy (rule ids come from your {@link AgentPluginTokenValidator}). */
export interface AgentPluginAccessTokenMessages {
  connectionNotSetUp(input: { pluginId: string }): string;
  connectionRepointed(input: { connectionId: string; displayName: string }): string;
  notInstalled(input: { pluginId: string }): string;
  noTokenSignIn(input: { pluginId: string }): string;
  multipleTokenSignIns(input: { pluginId: string }): string;
  serverNotSetUp(input: { pluginId: string; serverKey: string }): string;
  onlyPluginId(): string;
  pluginIdRequired(): string;
  credentialText(input: { id: string; locale: string }): string;
  translateCredentialMessage(input: { message: string; locale: string }): string;
  savedTokenSwitch(input: { outcome: SavedTokenSwitchOutcome; target: TokenAuthTarget }): string;
}

/** The host's token input rule (R1): a separate required input, not part of the credentials port.
 * @agent-note Second host: `assertToken` throws YOUR input error for a malformed token (never echoing
 * it); `inputErrorRule` returns that error's rule id for `messages.credentialText`, or null for any
 * other error, which is then rethrown unchanged (same object). */
export interface AgentPluginTokenValidator {
  assertToken(required: { value: unknown; field: "token" }, optional?: Record<string, never>): void;
  inputErrorRule(required: { error: unknown }, optional?: Record<string, never>): string | null;
}

/** Plugin-declared credential cards and the guarded, read-only token probe.
 * @agent-note Second host: `apply` returns the form it was given with the card's copy applied (no
 * value fields); `probe` is one bounded GET that never returns a body; `find` reads safe card copy. */
export interface AgentPluginTokenCredentialsPort {
  apply(input: { card?: PluginCredentialCard; form: SurfaceCardSecretForm }, options?: Record<string, never>): SurfaceCardSecretForm;
  find(input: { workspaceId: string; saveKind: PluginCredentialCard["saveKind"]; target: string }, options?: Record<string, never>): Promise<PluginCredentialCard | undefined>;
  probe(input: { probeUrl: string; token: string }, options?: Record<string, never>): Promise<"ok" | "refused" | "unavailable">;
}

/** What resolving and saving onto a plugin's token row needs — no permission check, no HTTP client.
 *  Shared with `import-access-token.ts`, which saves a token that did not come from this form.
 * @agent-note Second host: `mcp` carries your canonical projection pair; `resolveInstalledPlugin` is
 * your installed-declaration read (no filesystem default here); `federation` is your trust rule and
 * federation refusal copy, the same pair your connect tool passes. */
export interface AgentPluginTokenTargetDeps {
  readonly workspaceId: string;
  readonly mcp: AgentPluginMcpProjectionPorts & Pick<AgentPluginMcpPort, "repo" | "saveServer"> & Partial<Pick<AgentPluginMcpPort, "notifyRosterChanged">>;
  readonly resolveInstalledPlugin: (pluginId: string) => Promise<ResolvedAgentPluginForConnect | null>;
  readonly federation: { readonly classifyTrust: AgentPluginMcpTrustClassifier; readonly messages: AgentPluginMcpFederationMessages };
  readonly messages: Pick<AgentPluginAccessTokenMessages, "connectionNotSetUp" | "connectionRepointed" | "notInstalled" | "noTokenSignIn" | "multipleTokenSignIns" | "serverNotSetUp">;
}

/** The host's card wiring and identity for the token form.
 * @agent-note Second host: `toolId` is the lifecycle id your secret-card answers route back to (your
 * credential-save tool); the card URI host is `cardIdentity.uriNamespace`; `cards`/`askThenReport` come
 * from the daemon the tool runs in; `permission`/`entityType` gate the tool. */
export interface AgentPluginAccessTokenHost {
  readonly toolId: string;
  readonly permission: string;
  readonly entityType: string;
  readonly cardIdentity: AgentPluginCardIdentity;
  readonly cards: Pick<SurfaceCardsPort, "defineSecretCardTool">;
  readonly askThenReport: SurfaceAskThenReport;
  readonly formMessages: AgentPluginAccessTokenFormMessages;
}

/** @agent-note Second host: `tokenValidator` is required (R1); `switchOnSavedToken` switches the
 * plugin on after a save exactly as a first sign-in does (your activation owner), and may throw. */
export interface AgentPluginAccessTokenToolDeps extends AgentPluginTokenTargetDeps {
  readonly authorize: AuthorizeFn;
  readonly mcp: AgentPluginTokenTargetDeps["mcp"] & Pick<AgentPluginMcpPort, "classifyError">;
  readonly credentials: AgentPluginTokenCredentialsPort;
  readonly preferences: { locale(input: { workspaceId: string; principalId: string }, options?: Record<string, never>): Promise<string> };
  readonly tokenValidator: AgentPluginTokenValidator;
  readonly switchOnSavedToken: (required: { target: TokenAuthTarget }) => Promise<SavedTokenSwitchOutcome>;
  readonly messages: AgentPluginAccessTokenMessages;
  readonly host: AgentPluginAccessTokenHost;
}

/** Plain-language messages from SPEC-052's errors.spec.md. None ever carries a token or a vendor body. */
const MESSAGES = {
  tokenInvalid: "The server rejected this token.",
  blankToken: "The access token cannot be blank. Nothing was saved.",
  saveFailed: "The access token could not be saved. Nothing was changed.",
} as const;

type UnansweredReason = "cancelled" | "expired" | "abandoned";
export type SetAccessTokenResult =
  | { saved: true; next: string }
  | { saved: false; reason: UnansweredReason | "invalid" | "refused" | "unavailable" | "error"; message?: string };

/** The one declared token-auth server this call saves onto. */
export interface TokenAuthTarget {
  readonly pluginId: string;
  readonly displayName: string;
  readonly connectionId: string;
  readonly config: RemoteMcpServerConfig & { readonly tokenAuth: AgentPluginTokenAuth };
}

function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The plugin row, freshly read. Refused when it is missing or no longer points at the host the plugin
 * declares, so a token is never sent to a server an operator re-pointed.
 *
 * @throws {ToolInputError}
 */
export async function requireTargetRow(
  { routeDeps, target }: { routeDeps: Pick<AgentPluginTokenTargetDeps, "workspaceId" | "mcp" | "messages">; target: TokenAuthTarget },
  _options: Record<string, never> = {},
): Promise<AgentPluginMcpRecord> {
  const row = await routeDeps.mcp.repo.findByServerId({ workspaceId: routeDeps.workspaceId, serverId: target.connectionId });
  if (row === null) {
    throw new ToolInputError({ message: routeDeps.messages.connectionNotSetUp({ pluginId: target.pluginId }) });
  }
  if (hostOf(row.url) !== hostOf(target.config.url)) {
    throw new ToolInputError({ message: routeDeps.messages.connectionRepointed({ connectionId: target.connectionId, displayName: target.displayName }) });
  }
  return row;
}

/**
 * Resolves the plugin's one server declaring `tokenAuth`, provisioning its row (idempotent, the
 * same call `agent_plugin_connect` makes) so a first-time fallback needs no earlier step.
 *
 * @throws {ToolInputError} Not installed; no or several token-auth servers.
 * @param optional.signal Stops provisioning when the run ends during plugin resolution.
 * @throws The signal's abort reason before provisioning when cancelled.
 */
export async function resolveTarget(
  { routeDeps, pluginId, principalId }: { routeDeps: AgentPluginTokenTargetDeps; pluginId: string; principalId: string },
  optional: { signal?: AbortSignal } = {},
): Promise<TokenAuthTarget> {
  const plugin = await routeDeps.resolveInstalledPlugin(pluginId);
  if (!plugin) throw new ToolInputError({ message: routeDeps.messages.notInstalled({ pluginId }) });

  const declared = Object.entries(plugin.servers).flatMap(([serverKey, config]) =>
    config.type !== "stdio" && config.tokenAuth ? [{ serverKey, config: config as TokenAuthTarget["config"] }] : [],
  );
  if (declared.length === 0) throw new ToolInputError({ message: routeDeps.messages.noTokenSignIn({ pluginId }) });
  if (declared.length > 1) throw new ToolInputError({ message: routeDeps.messages.multipleTokenSignIns({ pluginId }) });
  const [{ serverKey, config }] = declared as [(typeof declared)[number]];
  const connectionId = deriveAgentPluginConnectionId(serverKey);
  if (!connectionId) throw new ToolInputError({ message: routeDeps.messages.serverNotSetUp({ pluginId, serverKey }) });

  optional.signal?.throwIfAborted();
  await provisionAgentPluginMcpServers(
    routeDeps.mcp,
    { workspaceId: routeDeps.workspaceId, pluginId, servers: plugin.servers, principalId, ...routeDeps.federation },
  );
  return { pluginId, displayName: titleCaseFromPluginId({ pluginId }), connectionId, config };
}

/** Token sign-in keeps its input validation; Jini owns the GET, redirects and status classification.
 * @returns Invalid only for malformed input; HTTP 401/403 mean refused for this purpose.
 * @complexity One bounded GET; no persistence, response bodies or transport errors escape.
 */
export async function probeToken(
  { probeUrl, token, credentials, tokenValidator }: { probeUrl: string; token: string; credentials: Pick<AgentPluginTokenCredentialsPort, "probe">; tokenValidator: Pick<AgentPluginTokenValidator, "assertToken"> },
  _options: Record<string, never> = {},
): Promise<"ok" | "invalid" | "refused" | "unavailable"> {
  try { tokenValidator.assertToken({ value: token, field: 'token' }); }
  catch { return "invalid"; }
  return credentials.probe({ probeUrl, token });
}

function joinStoredList(raw: string | null): string {
  const parsed: unknown = raw === null ? [] : JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === "string").join(",") : "";
}

/**
 * Seals `token` onto the freshly re-read row as its `static_env` access token, carrying every
 * operator-set field forward unchanged. Re-read at write time because the human may sit on the form
 * while the operator edits the allowlists.
 * @param optional.signal Stops the write when the run ends during the fresh row read.
 * @throws The signal's abort reason before saving when cancelled.
 */
export async function saveStaticAccessToken(
  { routeDeps, target, principalId, token }: { routeDeps: Pick<AgentPluginTokenTargetDeps, "workspaceId" | "mcp" | "messages">; target: TokenAuthTarget; principalId: string; token: string },
  optional: { signal?: AbortSignal } = {},
): Promise<void> {
  const row = await requireTargetRow({ routeDeps, target });
  // A row read or probe may finish after the run ends; never start a credential write then.
  optional.signal?.throwIfAborted();
  await routeDeps.mcp.saveServer({
    workspaceId: routeDeps.workspaceId,
    serverId: row.serverId,
    ...(row.label !== null ? { label: row.label } : {}),
    transport: "streamable_http",
    authMode: "static_env",
    enabled: row.enabled,
    command: "",
    url: row.url ?? target.config.url,
    args: "",
    allowedToolNames: joinStoredList(row.allowedToolNames),
    writeAllowedToolNames: joinStoredList(row.writeAllowedToolNames),
    accessToken: token,
    principalId,
  });
}

/** Only the store's known validation/unconfigured errors are shown. Sealing failures can quote
 * plaintext, so unconfigured storage gets fixed copy; the engine redacts allowlisted messages. */
function describeSaveError({ err, mcp, messages }: { err: unknown; mcp: Pick<AgentPluginMcpPort, "classifyError">; messages: Pick<AgentPluginAccessTokenMessages, "credentialText"> }, _options = {}): string {
  const kind = mcp.classifyError({ error: err });
  if (kind === "unconfigured") return messages.credentialText({ id: "storage", locale: "en" });
  const known = kind === "validation" || err instanceof ToolInputError;
  return known ? (err as Error).message : MESSAGES.saveFailed;
}

/**
 * The form's answer: probe, then seal. The token lives only in a local for the width of this function
 * and is never returned, logged, or put in an outcome.
 *
 * @complexity O(1) plus one outbound GET and one store save.
 */
async function saveSubmittedAccessToken(
  { values, routeDeps, target, principalId, locale, signal, credentialCard }: {
    values: Readonly<Record<string, unknown>>; routeDeps: AgentPluginAccessTokenToolDeps;
    target: TokenAuthTarget; principalId: string; locale: string; signal: AbortSignal; credentialCard?: PluginCredentialCard;
  }, _optional = {},
): Promise<SetAccessTokenResult> {
  const submitted = values.token;
  try { routeDeps.tokenValidator.assertToken({ value: submitted, field: 'token' }); }
  catch (err) { const rule = routeDeps.tokenValidator.inputErrorRule({ error: err }); if (rule !== null) { return { saved: false, reason: 'invalid', message: routeDeps.messages.credentialText({ id: rule, locale }) }; } throw err; }

  const token = (submitted as string).trim();
  const probe = await probeToken({ probeUrl: target.config.tokenAuth.probeUrl, token, credentials: routeDeps.credentials, tokenValidator: routeDeps.tokenValidator });
  signal.throwIfAborted();
  if (probe === "invalid") return { saved: false, reason: "invalid", message: routeDeps.messages.translateCredentialMessage({ message: MESSAGES.tokenInvalid, locale }) };
  if (probe === "refused") {
    const hint = credentialCard?.keyHint ? ` This card needs: ${credentialCard.keyHint}` : '';
    return { saved: false, reason: "refused", message: `This token was refused for this purpose.${hint}` };
  }
  if (probe === "unavailable") return { saved: false, reason: "unavailable", message: `${target.displayName} is unavailable right now. Try again shortly.` };
  await saveStaticAccessToken({ routeDeps, target, principalId, token }, { signal });
  let next: string;
  try {
    next = routeDeps.messages.savedTokenSwitch({ outcome: await routeDeps.switchOnSavedToken({ target }), target });
  } catch {
    // The token is saved; only switching on failed. The next save or sign-in retries it.
    next = `Token saved, but ${target.displayName} could not be switched on automatically. Save the token again to retry.`;
  }
  return { saved: true, next };
}

/** Preserve the catalog's result contract while Jini owns answer classification and error redaction. */
function accessTokenResult({ run, locale, messages }: { run: SecretCardRun<SetAccessTokenResult>; locale: string; messages: Pick<AgentPluginAccessTokenMessages, "credentialText"> }, _optional = {}): SetAccessTokenResult {
  if (run.status === "saved") return run.saved;
  if (run.status === "blank") return { saved: false, reason: "invalid", message: messages.credentialText({ id: "blank", locale }) };
  if (run.status === "failed") return { saved: false, reason: "error", message: run.safeMessage };
  return { saved: false, reason: run.status };
}

/**
 * Runs `agent_plugin_set_access_token` end to end: permission, resolve, form, probe, save.
 *
 * @throws {ToolInputError} Extra input, unknown plugin, no token-auth server, or a re-pointed row.
 * @throws {ToolInputError} No `emitSurface` on this execution context.
 */
// -> one outbound GET to the declared probeUrl, then saveExternalMcpServer: a sealed write, via the human's form.
export async function saveAgentPluginToken(
  { routeDeps, surfaces, ctx }: { routeDeps: AgentPluginAccessTokenToolDeps; surfaces: { readonly surfaceExchanges: Pick<SurfaceExchangeStore, "open"> }; ctx: ToolExecutionContext },
  optional: ToolExecutionOptions = {},
): Promise<SetAccessTokenResult> {
  const input = requireInputRecord({ input: ctx.input });
  const { host, messages } = routeDeps;
  const tokenApps = resolveAgentPluginCardIdentity({ cardIdentity: host.cardIdentity, toolId: host.toolId }).token;
  const card = host.cards.defineSecretCardTool<{ target: TokenAuthTarget; principalId: string; locale: string; credentialCard?: PluginCredentialCard }, SetAccessTokenResult, SetAccessTokenResult>({
    toolId: host.toolId,
    prepare: async ({ ctx }) => {
      if (Object.keys(input).some((key) => key !== "pluginId")) {
        throw new ToolInputError({ message: messages.onlyPluginId() });
      }
      const pluginId = input.pluginId;
      if (typeof pluginId !== "string" || pluginId.trim() === "") throw new ToolInputError({ message: messages.pluginIdRequired() });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.permission }, { entityType: host.entityType, entityId: pluginId });
      // Resolution provisions a missing plugin row; an ended run must not start that effect.
      ctx.signal.throwIfAborted();
      const target = await resolveTarget({ routeDeps, pluginId, principalId: ctx.principal.id }, { signal: ctx.signal });
      await requireTargetRow({ routeDeps, target });
      const locale = await routeDeps.preferences.locale({ workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id });
      const credentialCard = await routeDeps.credentials.find({ workspaceId: routeDeps.workspaceId, saveKind: "agent-plugin-token", target: pluginId });
      return { target, principalId: ctx.principal.id, locale, credentialCard };
    },
    form: ({ prep }) => buildAgentPluginAccessTokenFormWithPorts({ app: tokenApps.formApp, messages: host.formMessages, spec: { credentials: routeDeps.credentials, pluginDisplayName: prep.target.displayName, helpUrl: prep.target.config.tokenAuth.helpUrl, credentialCard: prep.credentialCard } }),
    save: ({ values, prep, signal }) => saveSubmittedAccessToken({ values, routeDeps, ...prep, signal }),
    result: ({ prep, run }) => accessTokenResult({ run, locale: prep.locale, messages }),
    outcome: ({ prep, run }) => {
      const result = accessTokenResult({ run, locale: prep.locale, messages });
      if (!result.saved && result.message === undefined) return undefined;
      return buildAgentPluginAccessTokenOutcomeWithPorts({ app: tokenApps.outcomeApp, spec: {
        pluginDisplayName: prep.target.displayName, state: result.saved ? "success" : "failure",
        title: result.saved ? "Token saved" : "Token not saved", message: result.saved ? result.next : result.message!,
      } });
    },
  }, { uriHost: host.cardIdentity.uriNamespace, frameSize: ["100%", "380px"], safeError: err => describeSaveError({ err, mcp: routeDeps.mcp, messages }), text: { saveFailure: MESSAGES.saveFailed } });
  return card.handler({ surfaceExchanges: surfaces.surfaceExchanges, askThenReport: host.askThenReport })(ctx, optional);
}
