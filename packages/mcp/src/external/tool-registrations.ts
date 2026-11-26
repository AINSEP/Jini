import { ToolAccessLoweringError } from '@jini-ai/core/tool-access-change';
import { toolMetadata } from '@jini-ai/core/tool-metadata/external-mcp';
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireNoInput, requireString, ToolInputError, type AgentToolDefinition, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration, type ToolContributor, type ToolExecutionContext, type ToolExecutionOptions, type HumanConfirmer } from '@jini-ai/core';
import { adaptLegacyAuthorize } from '@jini-ai/core';
import type { requireToolPermission } from '@jini-ai/core';
import { resolveOperatorLocale } from '@jini-ai/core/operator-locale';
import type { ExternalMcpToolDeps as BaseExternalMcpToolDeps } from '@jini-ai/core/contracts/site/external-mcp-tool-ports';
import type { ChatDeleteSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import type { HumanConfirmSpec } from '@jini-ai/core/contracts/site/human-confirm';
import type { SurfaceCardsPort, SurfaceCardSecretRun as SecretCardRun, SurfaceCardSecretDeps, SurfaceCardSecretOptions } from '@jini-ai/core/contracts/cards';
import type { ToolFailureDiagnostic } from '@jini-ai/core/contracts/site/daemon-tool-recovery';
import type { ExternalMcpAccessSnapshot, ExternalMcpStoreDeps, ExternalMcpServerView, SaveExternalMcpServerInput } from '@jini-ai/core/contracts/hosted-mcp';
import { externalMcpAccessSnapshot, ExternalMcpValidationError } from '../federation/hosted/index.js';
import type { HostedMcpTokenHint } from '../federation/hosted/store-ports.js';
import { EXTERNAL_MCP_MANAGE_PERMISSION } from './agent-tools.js';
import { buildExternalMcpSaveForm, mergeExternalMcpSavePrefill, EXTERNAL_MCP_SAVE_TOOL_ID, type ExternalMcpSaveInput } from './save-form.js';
import { buildModelSaveInput, buildSaveExternalMcpServerInputFromFormParams } from './save-input.js';
import { isExternalMcpAccessInput, externalMcpAccessHandler, requireMcpSaveApprover, requireKnownMcpSave, currentMcpSaveRecord, ExternalMcpSaveBasisChangedError } from './access-review.js';

export interface ExternalMcpToolDeps extends BaseExternalMcpToolDeps {
  catalog: readonly AgentToolDefinition[];
  requireToolPermission: typeof requireToolPermission;
  resolveOperatorLocale: typeof resolveOperatorLocale;
  assertCredentialFreeField(required: { value: string; field: string }): void;
  ForbiddenError: abstract new (...args: never[]) => Error;
  defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'];
  askThenReport: SurfaceCardSecretDeps['askThenReport'];
  appName: string;
  secretCardOptions: SurfaceCardSecretOptions;
  resolveExternalMcpOAuthRedirectUri(required: { serverId: string; derivedPublicOrigin: string | undefined }, optional?: Record<string, never>): string | undefined;
  saveExternalMcpServer(deps: ExternalMcpStoreDeps, input: SaveExternalMcpServerInput): Promise<ExternalMcpServerView<HostedMcpTokenHint>>;
  listExternalMcpServerViews: (required: { deps: Pick<ExternalMcpStoreDeps, 'repo' | 'sealer'>; workspaceId: string }) => Promise<ExternalMcpServerView<HostedMcpTokenHint>[]>;
  readEnabledExternalMcpConfigs: (required: { deps: Pick<ExternalMcpStoreDeps, 'repo' | 'sealer'> & { oauth: NonNullable<BaseExternalMcpToolDeps['externalMcpOAuth']>['tokenResolver'] | undefined }; workspaceId: string }) => Promise<{ configs: { serverId: string }[]; failures: { serverId: string; reason: string }[] }>;
  notifyExternalMcpRosterChanged(optional?: { lowered: { serverIds: string[] } }): Promise<void>;
  credentialText(required: { id: 'saved' | 'connected' | 'auth' | 'timeout' | 'unreachable' | 'blank' | 'savedTitle' | 'storage'; locale: string }): string;
  formatCredentialHint(required: { hint: HostedMcpTokenHint | null; locale: string }): string;
  formatCredentialHints(required: { hints: Record<string, HostedMcpTokenHint> | undefined; locale: string }): string;
  translateCredentialMessage(required: { message: string; locale: string }): string;
  issueCredentialSetup(required: { setupToolId: string; prefill: Readonly<Record<string, string | number | boolean | null>> }, optional: Record<string, never>): ToolFailureDiagnostic;
  approvalToolHandler: <TPrepared>(steps: {
    surfaces: ChatDeleteSurfaceDeps;
    prepare(input: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions): Promise<TPrepared>;
    describe(input: { ctx: ToolExecutionContext; prepared: TPrepared }): HumanConfirmSpec | Promise<HumanConfirmSpec>;
    run(input: { ctx: ToolExecutionContext; prepared: TPrepared; confirmer: HumanConfirmer; choice?: string }, optional: ToolExecutionOptions): Promise<unknown>;
  }, optional: { flag: string }) => ToolHandler;
}

const EXTERNAL_MCP_ENTITY_TYPE = "external-mcp-server" as const;

/**
 * `external_mcp_save`'s domain save port — kept separate from the engine's exchange lifecycle so
 * the field mapper, sealed store, probe and roster fan-out retain their own contracts.
 *
 * `ExternalMcpValidationError` is the one rejection a DIFFERENT form submission would fix, so it is
 * turned by the engine's error allowlist into the documented `{ saved: false, reason: 'invalid', ... }` result —
 * matching `agent-tools.ts`'s own description of this tool's return shapes.
 * `ExternalMcpSecretStoreUnconfiguredError` is deliberately NOT folded into that same branch: its own
 * doc states nothing the operator types can fix it, which is the opposite of what `reason: 'invalid'`
 * promises the model — it propagates to the engine's fixed storage-failure outcome instead.
 *
 * @complexity O(1) plus one `saveExternalMcpServer` call.
 */
async function saveSubmittedExternalMcpConfiguration(
  { routeDeps, surfaces, expected, principalId, values, save, locale, signal }: {
    routeDeps: ExternalMcpToolDeps; surfaces: ChatDeleteSurfaceDeps; expected: ExternalMcpAccessSnapshot | null; principalId: string; values: Readonly<Record<string, unknown>>;
    save: ExternalMcpSaveInput; locale: string; signal: AbortSignal;
  }, _optional = {},
): Promise<Record<string, unknown>> {
  // The field set is fixed per call. A submitted routing value cannot change the credential's
  // destination or switch to an auth/transport mode whose fields the human never reviewed.
  if (values.id !== undefined && values.id !== save.id) {
    throw new ExternalMcpValidationError("The server ID must match the connection form. Nothing was saved.", "id");
  }
  const params = { ...values, id: save.id, transport: save.transport, authMode: save.authMode, enabled: save.enabled ?? true,
    allowedToolNames: save.allowedToolNames ?? "", writeAllowedToolNames: save.writeAllowedToolNames ?? "" };
  const saveInput = buildSaveExternalMcpServerInputFromFormParams({ params, workspaceId: routeDeps.workspaceId, principalId });
  await requireMcpSaveApprover({ routeDeps, surfaces, principalId, id: save.id });
  const current = await currentMcpSaveRecord({ routeDeps, id: save.id, expected });
  requireKnownMcpSave({ routeDeps, record: current, input: saveInput });
  signal.throwIfAborted();
  const server = await routeDeps.saveExternalMcpServer(
    {
      repo: routeDeps.externalMcpServerRepo,
      sealer: routeDeps.siteAssistantSecretSealer,
      keyring: routeDeps.siteAssistantSecretKeyring,
      clock: routeDeps.clock,
    },
    saveInput,
  );
  // Same roster-change fan-out `put.ts`/`oauth-callback.ts` fire on their own save/connect success —
  // see `external-mcp-roster-change.ts`'s own header. Fire-and-forget: this chat-surface save
  // already succeeded and is durable regardless of whether any registered runtime reloads cleanly.
  if (server.enabled) void routeDeps.notifyExternalMcpRosterChanged();
  else await routeDeps.notifyExternalMcpRosterChanged({ lowered: { serverIds: [server.serverId] } });
  const { connection, connectionCode } = await probeSavedExternalMcpConfiguration({
    server, routeDeps, locale,
  });
  const hint = [routeDeps.formatCredentialHint({ hint: server.accessTokenHint ?? null, locale }), routeDeps.formatCredentialHints({ hints: server.envTokenHints, locale })].filter(Boolean).join(' · ');
  const hintPrefix = hint ? `${hint}. ` : '';
  return { saved: true, server, connection: connectionCode, message: `${hintPrefix}${connection}` };
}

/** Report reachability after a durable save; probe failure does not undo that save. */
async function probeSavedExternalMcpConfiguration(
  { server, routeDeps, locale }: {
    server: { transport: string; serverId: string };
    routeDeps: Pick<ExternalMcpToolDeps, "externalMcpProbe" | "credentialText">;
    locale: string;
  }, _optional = {},
): Promise<{ connection: string; connectionCode: string }> {
  if (server.transport === "stdio" || !routeDeps.externalMcpProbe) {
    return { connectionCode: "not_tested", connection: routeDeps.credentialText({ id: "saved", locale }) };
  }
  try {
    const result = await routeDeps.externalMcpProbe({ serverId: server.serverId });
    const connectionCode = result.ok ? "connected" : String(result.body.code ?? "MCP_SERVER_UNREACHABLE");
    let id: "connected" | "auth" | "timeout" | "unreachable";
    if (result.ok) id = "connected";
    else if (connectionCode === "MCP_AUTH_REJECTED") id = "auth";
    else if (connectionCode === "MCP_TIMEOUT") id = "timeout";
    else id = "unreachable";
    return { connectionCode, connection: routeDeps.credentialText({ id, locale }) };
  } catch {
    return { connectionCode: "MCP_SERVER_UNREACHABLE", connection: routeDeps.credentialText({ id: "unreachable", locale }) };
  }
}

/** Project the engine's classified run without exposing any submitted credential. */
function externalMcpSaveResult({ run, locale, routeDeps }: { routeDeps: Pick<ExternalMcpToolDeps, "credentialText">; run: SecretCardRun<Record<string, unknown>>; locale: string }, { validationField }: { validationField?: string | undefined } = {}): Record<string, unknown> {
  if (run.status === "saved") return run.saved;
  if (run.status === "cancelled") return { saved: false, cancelled: true };
  if (run.status === "blank") return { saved: false, cancelled: false, reason: "invalid", message: routeDeps.credentialText({ id: "blank", locale }) };
  if (run.status === "failed") return { saved: false, cancelled: false, reason: validationField === undefined ? "error" : "invalid", message: run.safeMessage,
    ...(validationField === undefined ? {} : { field: validationField }) };
  return { saved: false, cancelled: false, reason: run.status, note: run.status === "expired"
    ? "The user did not respond to the connection form before it expired. Nothing was saved."
    : "The connection form was closed because the run ended. Nothing was saved." };
}

async function prepareExternalMcpSaveInput({ routeDeps, surfaces, ctx }: { routeDeps: ExternalMcpToolDeps; surfaces: ChatDeleteSurfaceDeps; ctx: Parameters<ToolHandler>[0] }) {
  const input = requireInputRecord({ input: ctx.input });
  const modelInput = buildModelSaveInput(input, routeDeps);
  await requireMcpSaveApprover({ routeDeps, surfaces, principalId: ctx.principal.id, id: modelInput.id });
  return modelInput;
}

/** Bind the domain form/save ports to Jini's one lifecycle owner.
 * @complexity O(s + f) during preparation in server views and fixed form fields, plus store/probe I/O.
 */
function externalMcpSaveHandler({ routeDeps, surfaces }: { routeDeps: ExternalMcpToolDeps; surfaces: ChatDeleteSurfaceDeps }, _optional = {}): ToolHandler {
  const accessHandler = externalMcpAccessHandler({ routeDeps, surfaces });
  return async (ctx, optional = {}) => {
    if (isExternalMcpAccessInput(requireInputRecord({ input: ctx.input }))) return accessHandler(ctx, optional);
    // Per-call metadata only: concurrent cards must not share a locale or validation field.
    // The engine owns redaction; this allowlist retains the domain's documented invalid/error shape.
    let validationField: string | undefined;
    let errorLocale = "en";
    const card = routeDeps.defineSecretCardTool<{
      save: ExternalMcpSaveInput; isUpdate: boolean; locale: string; principalId: string; expected: ExternalMcpAccessSnapshot | null;
    }, Record<string, unknown>, Record<string, unknown>>({
      toolId: EXTERNAL_MCP_SAVE_TOOL_ID,
      prepare: async ({ ctx }) => {
        const modelInput = await prepareExternalMcpSaveInput({ routeDeps, surfaces, ctx });
        const locale = await routeDeps.resolveOperatorLocale({ deps: routeDeps, workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id });
        errorLocale = locale;
        const record = await routeDeps.externalMcpServerRepo.findByServerId({ workspaceId: routeDeps.workspaceId, serverId: modelInput.id });
        const views = await routeDeps.listExternalMcpServerViews({ deps: { repo: routeDeps.externalMcpServerRepo, sealer: routeDeps.siteAssistantSecretSealer }, workspaceId: routeDeps.workspaceId });
        const existing = views.find(view => view.serverId === modelInput.id);
        const save = mergeExternalMcpSavePrefill({ input: modelInput, existing });
        requireKnownMcpSave({ routeDeps, record, input: buildSaveExternalMcpServerInputFromFormParams({ params: { ...save, enabled: save.enabled ?? true }, workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id }) });
        return { save, expected: record ? externalMcpAccessSnapshot({ record }) : null, isUpdate: existing !== undefined, locale, principalId: ctx.principal.id };
      },
      form: ({ prep }) => buildExternalMcpSaveForm({ save: prep.save, isUpdate: prep.isUpdate, appName: routeDeps.appName }),
      save: ({ values, prep, signal }) => saveSubmittedExternalMcpConfiguration({ routeDeps, surfaces, values, ...prep, signal }),
      result: ({ prep, run }) => externalMcpSaveResult({ run, locale: prep.locale, routeDeps }, { validationField }),
      outcome: ({ prep, run }) => {
        if (run.status === "cancelled" || run.status === "expired" || run.status === "abandoned") return undefined;
        const result = externalMcpSaveResult({ run, locale: prep.locale, routeDeps }, { validationField });
        return {
          title: result.saved ? routeDeps.credentialText({ id: result.connection === "connected" ? "connected" : "savedTitle", locale: prep.locale }) : routeDeps.credentialText({ id: "unreachable", locale: prep.locale }),
          state: result.saved ? "success" : "failure",
          message: typeof result.message === "string" ? result.message : routeDeps.credentialText({ id: "unreachable", locale: prep.locale }),
        };
      },
    }, { ...routeDeps.secretCardOptions, safeError: error => externalMcpSaveSafeError({ error, locale: errorLocale, routeDeps, onField: field => { validationField = field; } }), text: { ...routeDeps.secretCardOptions.text, saveFailure: routeDeps.credentialText({ id: "storage", locale: "en" }) } });
    return card.handler({ surfaceExchanges: surfaces.surfaceExchanges, askThenReport: routeDeps.askThenReport })(ctx, optional);
  };
}

/** Map a save-port failure to card copy; the engine still redacts the returned text.
 * Three causes stay distinct: changed authority (`ForbiddenError`, which subclasses
 * `ToolInputError` and so must be checked first), a changed approval basis (request a new card) and
 * bad input (fix a field). Bad input keeps its actionable sentence; every such sentence on this path
 * is fixed copy or names a field, never a submitted value. Any other error gets fixed storage copy:
 * an arbitrary `Error.message` can carry internals or the submitted values themselves.
 * @complexity O(m) in the message length; no I/O. */
function externalMcpSaveSafeError({ error, locale, onField, routeDeps }: { routeDeps: Pick<ExternalMcpToolDeps, "ForbiddenError" | "credentialText" | "translateCredentialMessage">; error: unknown; locale: string; onField: (field: string) => void }, _optional = {}): string {
  if (error instanceof routeDeps.ForbiddenError) return 'Your permission to save this connection changed. Reopen the chat in your signed-in admin session. Nothing was saved.';
  if (error instanceof ExternalMcpSaveBasisChangedError) return 'This connection or your access approval is no longer current. Review the connection and its allowed tools in Settings → External MCP, then request the card again. Nothing was saved.';
  if (error instanceof ToolAccessLoweringError) return error.message;
  // Checked before `ToolInputError` in case the validation class ever becomes its subclass: the field path must stay live.
  if (error instanceof ExternalMcpValidationError) {
    onField(error.field);
    return routeDeps.translateCredentialMessage({ message: error.message, locale });
  }
  if (error instanceof ToolInputError) return error.message;
  return routeDeps.credentialText({ id: "storage", locale });
}

/** Reuse the daemon's configuration resolver when no live probe is wired. */
async function resolveExternalMcpConfigurationCheck(
  { routeDeps, id }: { routeDeps: ExternalMcpToolDeps; id: string }, _optional = {},
): Promise<{ ok: boolean; reason?: string }> {
  const { configs, failures } = await routeDeps.readEnabledExternalMcpConfigs(
    { deps: { repo: routeDeps.externalMcpServerRepo, sealer: routeDeps.siteAssistantSecretSealer, oauth: routeDeps.externalMcpOAuth?.tokenResolver },
    workspaceId: routeDeps.workspaceId },
  );
  if (configs.some((config) => config.serverId === id)) return { ok: true };
  const failure = failures.find((candidate) => candidate.serverId === id);
  return { ok: false, reason: failure?.reason ?? "this server's connection could not be resolved" };
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const externalMcpDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> routeDeps.listExternalMcpServerViews(): a repo read, never unseals.
  ["external_mcp_list", "none"],
  // -> routeDeps.saveExternalMcpServer(): repo.upsert() plus a seal, gated behind the human's own form
  //    confirmation (ADR-055-style held-open exchange, same shape as content_post_delete).
  ["external_mcp_save", "mutates-durable-state"],
  // -> routeDeps.readEnabledExternalMcpConfigs(): OAuth token resolution may persist a refreshed grant.
  ["external_mcp_test_connection", "mutates-durable-state"],
  // -> externalMcpOAuth.beginConnect(): writes oauthStatus 'pending' (and, for a self-configuring
  //    connection, persists a minted client identity) before returning the authorization/device
  //    start. Durable.
  ["external_mcp_oauth_connect", "mutates-durable-state"],
  // -> externalMcpOAuth.pollDeviceAuthorization(): persists the access token on the 'connected'
  //    outcome, resets state on a terminal failure. Durable.
  ["external_mcp_oauth_poll_device", "mutates-durable-state"],
]);

async function connectExternalMcpOAuth({ routeDeps, ctx }: { routeDeps: ExternalMcpToolDeps; ctx: Parameters<ToolHandler>[0] }) {
  const input = requireInputRecord({ input: ctx.input });
  const id = requireString({ input, key: "id" });
  await routeDeps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }),
    workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: EXTERNAL_MCP_MANAGE_PERMISSION }, { entityType: EXTERNAL_MCP_ENTITY_TYPE,
    entityId: id });

  if (!routeDeps.externalMcpOAuth) {
    throw new Error(
      `external_mcp_oauth_connect: this execution context has no OAuth service wired, so an authorization ` +
        `cannot be started here. Ask the operator to connect '${id}' from Settings → External MCP instead.`,
    );
  }

  const redirectUri = routeDeps.resolveExternalMcpOAuthRedirectUri({ serverId: id, derivedPublicOrigin: routeDeps.derivedPublicOrigin });
  try {
    return await routeDeps.externalMcpOAuth.beginConnect({ serverId: id, actorId: ctx.principal.id, ...(redirectUri === undefined ? {} : { redirectUri }), delivery: 'hosted' });
  } catch (error) {
    // `ExternalMcpValidationError` is exactly "the caller named something this connection cannot
    // do, and a different input or one config change fixes it" — an unknown id, a non-OAuth row,
    // or (since 2026-09-09) an authorization_code grant with no configured public origin. As a
    // bare `Error` those all reach the model redacted, which is how a clearly-worded refusal
    // naming the configured public URL became, in practice, a silent one. Nothing internal is in these
    // messages beyond the server id the caller already sent.
    if (error instanceof ExternalMcpValidationError) throw new ToolInputError({ message: error.message });
    throw error;
  }
}

async function listExternalMcpConnections({ routeDeps, ctx }: { routeDeps: ExternalMcpToolDeps; ctx: Parameters<ToolHandler>[0] }) {
  requireNoInput({ input: ctx.input });
  await routeDeps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }),
    workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: EXTERNAL_MCP_MANAGE_PERMISSION }, { entityType: EXTERNAL_MCP_ENTITY_TYPE });

  const servers = await routeDeps.listExternalMcpServerViews({ deps: { repo: routeDeps.externalMcpServerRepo, sealer: routeDeps.siteAssistantSecretSealer }, workspaceId: routeDeps.workspaceId });
  return { servers };
}

export function buildExternalMcpRegistrations(routeDeps: ExternalMcpToolDeps, surfaces: ChatDeleteSurfaceDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    external_mcp_list: async (ctx) => listExternalMcpConnections({ routeDeps, ctx }),

    /**
     * See this file's header ("`external_mcp_save`: one call, held open"). Fails closed rather than
     * degrade when this execution context cannot show a dialog — same posture `content_post_delete`
     * and `deployment_propose_custom_provider_credential` both take for the identical case: a form
     * this tool exists specifically to render cannot be skipped without abandoning the "never saves
     * silently" guarantee `agent-tools.ts`'s own description makes.
     */
    external_mcp_save: externalMcpSaveHandler({ routeDeps, surfaces }),

    /** See this file's header ("`external_mcp_test_connection` never opens a socket"). */
    external_mcp_test_connection: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      const id = requireString({ input, key: "id" });
      await routeDeps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }),
        workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: EXTERNAL_MCP_MANAGE_PERMISSION }, { entityType: EXTERNAL_MCP_ENTITY_TYPE,
        entityId: id });

      const record = await routeDeps.externalMcpServerRepo.findByServerId({ workspaceId: routeDeps.workspaceId, serverId: id });
      if (!record) return { ok: false, reason: `no external MCP server is configured as '${id}'` };
      if (!record.enabled) return { ok: false, reason: "this server is disabled" };

      if (routeDeps.externalMcpProbe) {
        const probe = await routeDeps.externalMcpProbe({ serverId: id });
        return !probe.ok && probe.body.code === "MCP_AUTH_REJECTED" && record.authMode === "static_env"
          ? { ...probe, credentialSetup: routeDeps.issueCredentialSetup({ setupToolId: "external_mcp_save", prefill: { id } }, {}) }
          : probe;
      }

      return resolveExternalMcpConfigurationCheck({ routeDeps, id });
    },

    /** See this file's header ("`external_mcp_oauth_connect` has no live HTTP request"). */
    external_mcp_oauth_connect: async (ctx) => connectExternalMcpOAuth({ routeDeps, ctx }),

    external_mcp_oauth_poll_device: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      const id = requireString({ input, key: "id" });
      await routeDeps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }),
        workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: EXTERNAL_MCP_MANAGE_PERMISSION }, { entityType: EXTERNAL_MCP_ENTITY_TYPE,
        entityId: id });

      if (!routeDeps.externalMcpOAuth) {
        throw new Error(
          "external_mcp_oauth_poll_device: this execution context has no OAuth service wired, so this device " +
            "authorization cannot be polled here.",
        );
      }

      const result = await routeDeps.externalMcpOAuth.pollDeviceAuthorization({ serverId: id });
      // Same roster-change fan-out as a completed browser OAuth callback — a device-flow connection
      // becomes usable at exactly this "connected" transition, not at every "pending" poll in between.
      if (result.status === "connected") void routeDeps.notifyExternalMcpRosterChanged();
      return result;
    },
  };

  // No `unwiredToolIds`: External MCP wires its ENTIRE catalog, same tripwire discipline as
  // Posts/Themes/Plugins — a 6th catalog entry added without a handler fails the build.
  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "external-mcp",
    catalogModule: "@jini-ai/mcp/external/agent-tools",
    catalog: indexCatalogById({ catalog: routeDeps.catalog }),
    handlers,
    derivedRisk: externalMcpDerivedRisk,
  });
}

/**
 * Contributes External MCP's AI tools to the assistant's catalog — called once by
 * `server/runtime/composition/tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`, not
 * by importing this module. See this file's header for what was unreachable before this existed.
 */
export function contributeExternalMcpTools({ probe, knownToolNames }: { probe?: ({ deps, serverId }: { deps: ExternalMcpToolDeps; serverId: string }, optional?: Record<string, never>) => Promise<{ ok: boolean; body: Readonly<Record<string, unknown>> }>; knownToolNames?: ExternalMcpToolDeps["externalMcpKnownToolNames"] } = {}, _optional = {}): ToolContributor<ExternalMcpToolDeps, ChatDeleteSurfaceDeps> {
  return { domain: "external-mcp", build: (deps, surfaces) => buildExternalMcpRegistrations({ ...deps, ...(knownToolNames ? { externalMcpKnownToolNames: knownToolNames } : {}), ...(probe ? { externalMcpProbe: ({ serverId }: { serverId: string }) => probe({ deps, serverId }) } : {}) }, surfaces), risk: externalMcpDerivedRisk };
}
