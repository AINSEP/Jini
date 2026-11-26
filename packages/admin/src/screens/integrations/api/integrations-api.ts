import type { AdminExternalMcpConnectStart, AdminExternalMcpServer, AdminExternalMcpServerInput, ExternalMcpDeleteEnvelope, ExternalMcpToolApprovalDto } from "@jini-ai/core/contracts/site/cms-external-mcp";
import type { AdminExternalMcpAdmissionsSnapshot, AdminExternalMcpConfigFailure, AdminExternalMcpProbeResult, AdminFederatedAdmissionEntry, AdminToolRefusalReason } from "@jini-ai/core/contracts/hosted-mcp";
import type { AdminWebhookDeliveryResponse, AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import type { AgentPluginFiles, AgentPluginListRow } from "../../../agent-plugins/models.js";

/** The host's authenticated admin request — it owns the base URL, authentication, retries, error
 *  decoding and failure publishing, so this client only names paths, methods and bodies. */
export type IntegrationsRequestFn = <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;

/** What the host injects into {@link createIntegrationsApi}. */
export interface IntegrationsApiDeps {
  /** The host's authenticated admin request. */
  request: IntegrationsRequestFn;
  /** The workspace every integrations path is scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}

/**
 * The wire shape `GET .../mcp-servers/admissions` (C-008) actually sends, BEFORE
 * `getExternalMcpAdmissions` normalizes it into {@link AdminFederatedAdmissionEntry} — one
 * entry per connection, exactly `federation-admissions-route.ts`'s own
 * `FederationAdmissionsRouteDeps.reports` shape, serialized untouched: that daemon route "is a pure
 * serializer, never a reshape point" by its own header, and `admin-http/routes/external-mcp/
 * admissions.ts` (C-008's own proxy) deliberately treats the body as `unknown` and relays it
 * VERBATIM too — proven by `admin-external-mcp-admissions-routes.test.ts`'s "a live daemon's real
 * report is relayed verbatim" test, which this type must keep matching rather than the other way
 * around.
 *
 * So every admission field arrives nested one level deeper than {@link AdminFederatedAdmissionEntry}
 * declares — under `report`, not on the entry itself. Before `getExternalMcpAdmissions` normalized
 * this (ADM-003, 2026-09-08), `entry.admitted` (and every sibling field) was `undefined` for EVERY
 * connection the daemon ever reported, which is what crashed `<ExternalMcpSettingsPanel>`:
 * `external-mcp-admissions-rules.ts`'s several reads of it (`connectionLevelEntry`,
 * `liveOnlyEntries`, `describeConnectionDrift`, `removedButStillRunningEntry`) all assumed the flat
 * shape and none of them were guarded, because that file's contract — matching what
 * `AdminFederatedAdmissionEntry` has always declared — was never wrong; only this one wire hop
 * silently violated it. This type documents the wire's REAL shape so that hop can close the gap
 * itself, instead of every downstream reader growing a defensive `?.` that would collapse a real
 * empty admitted set and a missing one into the same silent zero (see that function's own doc on
 * why `savedAllowedToolNames === undefined` is load-bearing, not a default).
 */
interface RawAdmissionConnection {
  readonly connectionId: string;
  /** Absent for an older daemon build that predates this field — see
   *  {@link AdminFederatedAdmissionEntry.isPreset}'s own doc on why that must NOT default to `false`. */
  readonly isPreset?: boolean;
  /**
   * NOT optional here, and {@link flattenAdmissionConnection} reads into it unguarded — deliberately,
   * unlike `isPreset` above. Proven from `bootstrap.ts`'s OWN construction code, not from a type
   * declaration (a type declaration is exactly what lied about this shape last time): `attachFederatedMcpTools`
   * only ever pushes a `reports` entry from inside `if (attached.report) reports.push({ connectionId,
   * report: attached.report, isPreset })` — there is no code path that pushes an entry with no
   * `report`. That gate has existed, unchanged, since the very first commit that introduced this
   * `reports` shape (`e3843594`) — every daemon build in this repo's entire history that can produce a
   * `reports` entry at all produces one with a real `report`. `isPreset` is optional because it was
   * added LATER (`333eb70e`, 2026-09-07) and an already-running older daemon process predates it;
   * `report` has no such history — it is not a "recently added field" case.
   *
   * A future entry that somehow arrives without one anyway (corrupt payload, a hand-rolled test double
   * that skips this constraint) should throw here, not be silently read as "admitted nothing" — the
   * same "every refusal is reportable, never silent" reasoning `external-mcp-admissions-rules.ts`'s own
   * header states, and the reason `getExternalMcpAdmissions` does NOT also do `raw.report ?? {...}`
   * next to its `raw.connections ?? []` guard: `?? []` there defends a shape a REAL test in this repo
   * already sends (`api-long-tail-endpoints.unit.test.ts`'s shared empty-body fetch stub); no
   * equivalent real producer of a report-less connection exists to defend against, so adding one would
   * be a speculative branch with no provable correct behavior, not a fix for anything ever observed.
   */
  readonly report: {
    readonly admitted: readonly { readonly remoteName: string; readonly writeAuthorized: boolean }[];
    readonly refused: readonly { readonly remoteName: string; readonly reason: AdminToolRefusalReason }[];
    readonly allowlistedButAbsent: readonly string[];
    readonly writeAllowedButNotAllowlisted: readonly string[];
  };
}

/** Un-nests one {@link RawAdmissionConnection} into the flat {@link AdminFederatedAdmissionEntry}
 *  contract every other reader in this app is written against. `isPreset` is copied only when the
 *  wire actually sent it, never defaulted, for the same reason the type doc above states.
 *  `raw.report.*` below is read unguarded on purpose: the host's federation-admissions route types
 *  `report` non-optional and `:61` (`res.status(200).json({ connections: deps.reports })`) is a pure
 *  pass-through of that same typed value, in the same process — the producer's type IS the
 *  serializer's input, not a second, independently-authored type the wire could drift out of sync
 *  with (that drift, across a boundary, is what `admitted`/`refused`/etc. being nested under `report`
 *  in the first place actually was — see {@link RawAdmissionConnection}'s own doc). No guard needed.
 *  @complexity O(1) — copies four already-computed arrays, does not iterate them. */
function flattenAdmissionConnection(raw: RawAdmissionConnection): AdminFederatedAdmissionEntry {
  return {
    connectionId: raw.connectionId,
    admitted: raw.report.admitted as { remoteName: string; writeAuthorized: boolean }[],
    refused: raw.report.refused as { remoteName: string; reason: AdminToolRefusalReason }[],
    allowlistedButAbsent: raw.report.allowlistedButAbsent as string[],
    writeAllowedButNotAllowlisted: raw.report.writeAllowedButNotAllowlisted as string[],
    ...(raw.isPreset !== undefined ? { isPreset: raw.isPreset } : {}),
  };
}

/** The webhook subscription and delivery calls. */
function createWebhooksApi({ request, workspaceId }: IntegrationsApiDeps) {
  return {
  listIntegrationSubscriptions: () =>
    request<{ subscriptions: AdminWebhookSubscriptionResponse[] }>(
      { path: `/workspaces/${workspaceId}/integrations/subscriptions` }
    ),
  createIntegrationSubscription: (input: { label: string; targetUrl: string; topics: string[] }) =>
    request<{ subscription: AdminWebhookSubscriptionResponse }>(
      { path: `/workspaces/${workspaceId}/integrations/subscriptions` },
      { init: { method: "POST", body: JSON.stringify(input) } }
    ),
  pauseIntegrationSubscription: (
    { id, paused }: { id: string; paused: boolean },
    _options: Record<string, never> = {}
  ) =>
    request<{ subscription: AdminWebhookSubscriptionResponse }>(
      { path: `/workspaces/${workspaceId}/integrations/subscriptions/${encodeURIComponent(id)}/pause` },
      { init: { method: "POST", body: JSON.stringify({ paused }) } }
    ),
  deleteIntegrationSubscription: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
    request<{ subscription: AdminWebhookSubscriptionResponse }>(
      { path: `/workspaces/${workspaceId}/integrations/subscriptions/${encodeURIComponent(id)}` },
      { init: { method: "DELETE" } }
    ),
  listIntegrationDeliveries: ({ subscriptionId }: { subscriptionId: string }, _optional: Record<string, never> = {}) =>
    request<{ deliveries: AdminWebhookDeliveryResponse[] }>(
      { path: `/workspaces/${workspaceId}/integrations/subscriptions/${encodeURIComponent(subscriptionId)}/deliveries` }
    ),
  };
}

/** The external MCP server roster, probe, OAuth and tool-approval calls. */
function createExternalMcpApi({ request, workspaceId }: IntegrationsApiDeps) {
  return {
  /** The workspace's configured external MCP servers. Carries env variable NAMES only — there is no
   *  route anywhere that returns a stored env VALUE, by design. */
  listExternalMcpServers: () =>
    request<{ servers: AdminExternalMcpServer[] }>({ path: `/workspaces/${workspaceId}/mcp-servers` }),
  /** Creates or replaces one external MCP server. Omitting `env` PRESERVES the stored credentials
   *  (what an enable/disable toggle sends); passing `""` clears them. `restartRequired` is always
   *  true — federation freezes its tool set at connect, so a saved row lands at the next boot. */
  saveExternalMcpServer: ({ serverId, body }: { serverId: string; body: AdminExternalMcpServerInput }, _optional: Record<string, never> = {}) =>
    request<{ server: AdminExternalMcpServer; restartRequired: boolean }>(
      { path: `/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}` },
      { init: { method: "PUT", body: JSON.stringify(body) } }
    ),
  /** Removes one external MCP server. 404s on an id that was never configured rather than
   *  reporting success, so deleting a typo cannot read as deleting the real server. */
  deleteExternalMcpServer: ({ serverId }: { serverId: string }, _optional: Record<string, never> = {}) =>
    request<ExternalMcpDeleteEnvelope>(
      { path: `/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}` },
      { init: { method: "DELETE" } }
    ),
  /**
   * Connects to one already-saved server RIGHT NOW, lists its tools, describes them, and closes —
   * registering nothing (C-007, outline §3.1 Source A). A live snapshot of what the remote offers,
   * never a stored one: federation re-applies the allowlist against a fresh `tools/list` at connect
   * regardless, so this call cannot un-freeze anything the daemon holds.
   *
   * Also backs `useExternalMcp`'s `testSource` port method, which is what lights up Jini's existing
   * "Test" button (`useSourceConfigList.ts`'s `capabilities.canTest`) for free.
   */
  probeExternalMcpServer: ({ serverId }: { serverId: string }, _optional: Record<string, never> = {}) =>
    request<AdminExternalMcpProbeResult>(
      { path: `/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}/probe` },
      { init: { method: "POST" } }
    ),
  /** Starts an OAuth sign-in for one saved server. `redirect_required` carries the provider URL to
   *  open; `device_code` carries a code the operator types at `verificationUri`, then
   *  {@link api.pollExternalMcpOAuthDevice} reports when it lands. */
  connectExternalMcpOAuth: ({ serverId }: { serverId: string }, options: { destination?: "shared" } = {}) =>
    request<{ auth: AdminExternalMcpConnectStart }>(
      { path: `/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}/oauth/connect` },
      { init: { method: "POST", ...(options?.destination ? { body: JSON.stringify(options) } : {}) } }
    ),
  useLocalMcpConnection: ({ serverId }: { serverId: string }, _optional: Record<string, never> = {}) => request<void>({ path: `/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}/oauth/shared` }, { init: { method: "DELETE" } }),
  stopSharedMcpConnection: ({ serverId }: { serverId: string }, _optional: Record<string, never> = {}) => request<void>({ path: `/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}/oauth` }, { init: { method: "DELETE" } }),
  listSharedMcpConnections: ({ serverId }: { serverId: string }, _optional: Record<string, never> = {}) => request<{ available: boolean; connections: { credentialId: string; label: string }[]; current: { credentialId: string; status: string; granted: boolean } | null }>(
    { path: `/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}/oauth/shared` }),
  useSharedMcpConnection: (input: { serverId: string; credentialId: string }) => request<{ connected: boolean }>(
    { path: `/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(input.serverId)}/oauth/shared` }, { init: { method: "POST", body: JSON.stringify({ credentialId: input.credentialId }) } }),
  /** One poll of a device sign-in; the caller owns the loop and waits `retryAfterSeconds`. */
  pollExternalMcpOAuthDevice: ({ serverId }: { serverId: string }, _optional: Record<string, never> = {}) =>
    request<{ status: "pending"; retryAfterSeconds: number } | { status: "connected" }>(
      { path: `/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}/oauth/device/poll` },
      { init: { method: "POST" } }
    ),
  /**
   * What the RUNNING agent daemon actually admitted at its last boot, per connection (C-008,
   * outline §3.1 Source B) — the only route that can answer "you ticked 3 tools; the assistant is
   * running with 1." A stopped or unreachable daemon is a 503 (thrown as an `ApiError`), never a
   * silently empty `connections` array — a caller must not read "cannot reach the daemon" as "the
   * daemon is running with nothing admitted".
   */
  getExternalMcpAdmissions: async (): Promise<AdminExternalMcpAdmissionsSnapshot> => {
    const raw = await request<{ connections?: RawAdmissionConnection[]; configFailures?: AdminExternalMcpConfigFailure[] }>(
      { path: `/workspaces/${workspaceId}/mcp-servers/admissions` },
    );
    // `?? []` guards a malformed 200 (no `connections` key at all) — never reachable against the
    // real C-008 route, which always sends `{ connections: [...] }` on 200 and answers a down/
    // unreachable daemon with a 503 that `request()` already throws as an `ApiError` before this
    // line runs (see this function's own doc). Kept anyway: a 200 with a missing `connections` key
    // is a "we don't know" case, same as the 503 branch, not "the daemon reported zero admissions".
    return {
      connections: (raw.connections ?? []).map(flattenAdmissionConnection),
      // Not defaulted to `[]` here — see `AdminExternalMcpAdmissionsSnapshot.configFailures`'s own
      // doc on why "absent" and "empty" must stay distinguishable one more hop upstream too.
      ...(raw.configFailures !== undefined ? { configFailures: raw.configFailures } : {}),
    };
  },
  /** Every saved "Always allow" on this site, sorted by server then tool. */
  listExternalMcpToolApprovals: () =>
    request<{ approvals: ExternalMcpToolApprovalDto[] }>({ path: `/workspaces/${workspaceId}/mcp-servers/tool-approvals` }),
  /** Revokes one "Always allow", so that tool asks again. 404s when none is saved. */
  revokeExternalMcpToolApproval: ({ serverId, toolName }: { serverId: string; toolName: string }, _optional: Record<string, never> = {}) =>
    request<{ removed: boolean }>(
      { path: `/workspaces/${workspaceId}/mcp-servers/${encodeURIComponent(serverId)}/tool-approvals/${encodeURIComponent(toolName)}` },
      { init: { method: "DELETE" } }
    ),
  };
}

/** The Agent Plugins list, files and activation calls. */
function createAgentPluginsApi({ request, workspaceId }: IntegrationsApiDeps) {
  return {
  // 2026-09-09 — AGENT_PLUGINS_LIST: the `agent-plugins` screen's read of real installed Agent
  // Plugins (a separate family from listPlugins/setPluginEnabled above — see AgentPluginListRow's doc).
  listAgentPlugins: () => request<{ agentPlugins: AgentPluginListRow[] }>({ path: `/workspaces/${workspaceId}/agent-plugins` }),
  /** AGENT_PLUGIN_FILES (2026-09-13) — `GET /workspaces/:id/agent-plugins/:pluginId/files`: one
   *  installed Agent Plugin's files, switched on or off, behind the Agent Plugins eye button.
   *  Refuses `AGENT_PLUGIN_NOT_FOUND` (404). */
  getAgentPluginFiles: ({ pluginId }: { pluginId: string }, _optional: Record<string, never> = {}) =>
    request<AgentPluginFiles>({ path: `/workspaces/${workspaceId}/agent-plugins/${encodeURIComponent(pluginId)}/files` }),
  /**
   * AGENT_PLUGIN_SET_ENABLED — turns one installed Agent Plugin on or off for this workspace.
   *
   * Returns the SINGLE updated row rather than a `changeSetId`, deliberately unlike
   * `setPluginEnabled` above: that family's route is `executeCommand`-wrapped and its client
   * re-fetches the whole list afterwards, while this one writes one JSON activation record and
   * hands back the row in `listAgentPlugins`' own shape, so the caller replaces it in place with no
   * second GET. See the route's own header for what skipping the gateway costs.
   *
   * `enabled` is validated server-side, not coerced — an omitted or non-boolean value is 400
   * `VALIDATION_ERROR` instead of a silent disable.
   */
  setAgentPluginEnabled: ({ pluginId, enabled }: { pluginId: string; enabled: boolean }, _optional: Record<string, never> = {}) =>
    request<{ agentPlugin: AgentPluginListRow; warnings?: string[] }>({ path: `/workspaces/${workspaceId}/agent-plugins/${encodeURIComponent(pluginId)}` }, { init: {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    } }),
  };
}

/** The admin API calls of the integrations feature, bound to the host's injected collaborators.
 *  @example const integrationsApi = createIntegrationsApi({ request, workspaceId }); */
export function createIntegrationsApi(deps: IntegrationsApiDeps, _optional: Record<string, never> = {}) {
  return { ...createWebhooksApi(deps), ...createExternalMcpApi(deps), ...createAgentPluginsApi(deps) };
}
