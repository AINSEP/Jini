import type { AgentPluginMcpPort } from "../service-ports.js";
import type { AgentPluginMcpRecord, AgentPluginMcpContext, AgentPluginMcpProjections, AgentPluginMcpProjectionPorts } from "../service-ports.js";

import { classifyAgentPluginMcpServerTrust, readInstalledMcpServers } from "../capability-projection.js";
import type { AgentPluginLayout } from "../layout.js";
import type { AgentPluginDefaultTools } from "@jini-ai/agent-plugins/lifecycle";
import type { McpServerConfig } from "../mcp-metadata.js";
import { preferBundledAgentPluginDigests, readBundledAgentPluginDigests } from "../lifecycle.js";
import { listInstalledPlugins } from "../lifecycle.js";

/**
 * @file Phase 4 of the 2026-09-10 plugin-MCP-wiring work: PROVISIONS an activated Agent Plugin's
 * auto-admitted remote MCP servers as real rows in the SAME external-MCP store
 * (`features/external-mcp/external-mcp-store.ts`) Settings → External MCP already owns — reusing that path
 * rather than building a parallel one. A provisioned row appears in Settings → External MCP exactly
 * like an operator-typed one: the same allowlist/"may write" tool picker, the same enable toggle,
 * the same revoke button. There is no second, plugin-only registration path.
 *
 * ---------------------------------------------------------------------------
 * 2026-09-10, owner refinement — three collision rules, and why each exists
 * ---------------------------------------------------------------------------
 * A `higgsfield` row already exists on the live dev site with connected OAuth tokens, an allowlist,
 * and write grants — created by hand, by an operator following the bundled skill's old instructions,
 * before this file existed. That row is the concrete case every rule below defends:
 *
 * 1. **NEVER CLOBBER AN EXISTING ROW — ADOPT IT INSTEAD.** {@link provisionAgentPluginMcpServers}
 *    calls `deps.repo.findByServerId` BEFORE ever calling {@link saveExternalMcpServer}. A row
 *    already at the derived id is NEVER passed through {@link saveExternalMcpServer} — no field an
 *    operator or an earlier boot wrote (url, transport, auth mode, allowlist, write grants, any
 *    oauth/sealed column) is ever recomputed or overwritten here. This is why
 *    {@link deriveAgentPluginConnectionId} below no longer hashes or namespaces the id: an id
 *    genuinely equal to what an operator would have hand-typed (the plugin's own declared server
 *    key, e.g. `higgsfield`) is what lets this rule recognize the ACTUAL pre-existing row, rather
 *    than shadowing it with a second, uniquely-derived connection beside it. There is deliberately no
 *    hash-suffixed fallback id — one id, verbatim, always; a vendor's own SKILL.md documents
 *    `mcp__<serverKey>__<tool>` and cannot predict any suffix Tovu might mint, so a fallback scheme
 *    would defeat the exact "no guessing" goal this feature exists for.
 *
 *    A row already at that id splits into two cases, neither of which ever calls
 *    `saveExternalMcpServer`:
 *      - `provisionedByPluginId === input.pluginId` — this same plugin provisioned it on an earlier
 *        enable; nothing has changed. Reported {@link ProvisionAgentPluginMcpServersResult
 *        .alreadyProvisioned}.
 *      - anything else (`null`, or a DIFFERENT plugin's id) — an operator's own hand-configured
 *        connection (with its earned OAuth tokens, allowlist, and write grants), or another plugin's
 *        row. This is ADOPTION: `deps.repo.upsert({ ...existing, provisionedByPluginId: input.pluginId })`
 *        is called directly against the repo port — the raw record, spread, with only that one field
 *        changed — never `saveExternalMcpServer`, which has no way to leave every other field
 *        untouched while changing just this one (even its "tri-state" fields resolve a default the
 *        caller must supply). Reported {@link ProvisionAgentPluginMcpServersResult.adopted}. The
 *        operator's own configuration and any live tokens always outrank a package's declaration —
 *        that is this rule, applied to the id-collision case specifically.
 *      - EXCEPT a row owned by a DIFFERENT plugin whose url, transport, or auth mode DIFFERS from the
 *        declaration — a different server whose key merely normalized to the same id. Rewriting that
 *        plugin's provenance would leave calls for this plugin pointing at the other plugin's
 *        endpoint, so the collision is refused, never adopted, and reported
 *        {@link ProvisionAgentPluginMcpServersResult.failed}. Two plugins declaring the identical key
 *        AND endpoint therefore share one row (whichever enabled most recently owns
 *        `provisionedByPluginId`); two declaring the same key but different endpoints do not. An
 *        operator's row (`provisionedByPluginId === null`) is still adopted unconditionally — the
 *        operator typed the endpoint they wanted, so recording the association is not a rewrite of
 *        another plugin's provenance.
 *    KNOWN RACE: the existence check and the create/adopt are not one atomic operation (no
 *    compare-and-set primitive exists on `ExternalMcpServerRepoPort` today, unlike
 *    `tryClaimOAuthRefreshLease`'s purpose-built one). Two concurrent provisioning attempts for the
 *    SAME id are harmless — creation races write the identical disabled/empty-allowlist config, and
 *    adoption races both write the same one field. A provisioning attempt racing an operator's
 *    concurrent hand-edit of the same id is the one real gap, and it is the same class of risk any two
 *    concurrent saves to this store already have — not a new one, but also not eliminated by this
 *    file. Closing it fully needs a new repo primitive, deliberately not added here as disproportionate
 *    to this feature's scope.
 *
 * 1b. **EXCEPT A STALE ROW THIS SAME PLUGIN PROVISIONED AND NOBODY USED.** When a plugin update
 *    changes a server's url or auth mode, a row the plugin provisioned earlier is re-provisioned from
 *    the new declaration (deleted, then saved fresh) — but only while it is still exactly what
 *    provisioning left behind: never enabled, both tool lists empty. Otherwise the new url could
 *    never reach an existing site, and `apply-connect-defaults.ts` (which grants defaults only when
 *    the row's url equals the declared one) would never fire there. Any sign-in state on such a row
 *    was minted for the old endpoint and is dropped with it. A saved access token on a server that
 *    declares `tokenAuth` counts as the declared auth mode, so it is only dropped when the url
 *    itself changes. A row that is enabled or has any tool
 *    granted is the operator's, and stays byte-identical as above.
 *
 * 2. **SEED DISABLED, LIKE BUNDLED PLUGINS ALREADY DO.** Mirrors `activation.ts`'s
 *    `recordBundledAgentPluginIfAbsent`: idempotent, create-if-absent, and — because rule 1 already
 *    means an existing row is never revisited — a row this file created is never re-enabled by a
 *    later boot or a later plugin toggle either. `enabled: false` is passed on the ONE
 *    {@link saveExternalMcpServer} call that creates a brand-new row; there is no code path here that
 *    ever sets `enabled: true` on any row, new or existing.
 *
 * 3. **PROVISIONING IS NOT AUTHORIZATION.** `allowedToolNames`/`writeAllowedToolNames` are always
 *    `""` on a newly created row, even though a plugin's `mcp.json`/skill content might suggest
 *    names. A downloaded marketplace package must not be able to grant itself tool access — the same
 *    trust argument Phase 3's stdio split makes, applied here to the allowlist instead of to
 *    execution. The operator ticks tools in Settings → External MCP's picker, which already lets
 *    them choose from a live, server-advertised list (`probe.ts`) rather than guessing names. The one
 *    other writer is the operator's own first sign-in, which grants the plugin's declared
 *    `defaultTools` to a still-empty row (`apply-connect-defaults.ts`) — the sign-in, not this
 *    file, is what authorizes.
 *
 * ---------------------------------------------------------------------------
 * What happens on plugin disable or uninstall: THE ROW SURVIVES
 * ---------------------------------------------------------------------------
 * Nothing in this file, and nothing this dispatch added to `set-enabled.ts` or
 * `features/agent-plugins/uninstall.ts`, ever deletes or disables a provisioned row when its plugin
 * is turned off or removed. This is a deliberate position, not an oversight: a provisioned row may
 * already hold OAuth tokens the operator earned through a real browser sign-in, and deleting an
 * external MCP connection is UNRECOVERABLE in this app (`project_external_mcp_delete_is_unrecoverable`
 * — no soft-delete, no undo). Silently destroying that on a disable/uninstall would be a strictly
 * worse failure mode than leaving an inert, disabled row behind. `provisioned_by_plugin_id`
 * (`schema.sqlite.ts`) records which plugin created a surviving row, so a FUTURE uninstall flow can offer
 * to remove it explicitly — an operator decision, never an automatic side effect of this file.
 *
 * ---------------------------------------------------------------------------
 * What this does NOT do
 * ---------------------------------------------------------------------------
 * - Never touches a `stdio` server. `classifyAgentPluginMcpServerTrust` (`capability-projection.ts`)
 *   is consulted first, and only an `"auto-admit"` (remote) server ever reaches
 *   {@link saveExternalMcpServer}. There is no code path in this file that can launch a local
 *   process on a plugin's say-so — see Phase 3's own gate for the full argument.
 * - Never completes an OAuth handshake. `authMode: "oauth"` rows still need the operator's own
 *   browser-interactive consent (Higgsfield's authorization_code + PKCE flow has no other kind) —
 *   this file only makes sure the row EXISTS with the right URL and transport so that consent step
 *   is the operator's only remaining action.
 * - Does not run at request time and makes no live network call. Only the row's own data is
 *   written. The daemon's boot-time federation read (`resolveStoredExternalMcpConnections`) is what
 *   actually connects, and per that module's own doc, requires an assistant restart to pick up a
 *   newly-provisioned (and since-enabled) row.
 *
 * ---------------------------------------------------------------------------
 * Why authMode defaults to "none", not "oauth"
 * ---------------------------------------------------------------------------
 * The real Agent Plugins v1.0.0 mcp.schema.json defines NO auth field at all (verified live,
 * 2026-09-10 — see `manifest.ts`'s header). Guessing "oauth" for every remote server would attempt
 * RFC 8414 discovery against a plugin's server even when it needs no auth at all, failing where a
 * plain connection would have worked. `"none"` is the safe default; a plugin author who KNOWS their
 * server requires OAuth (Higgsfield's own `mcp.json` does) sets the `authMode` extension
 * (`manifest.ts`) to say so explicitly.
 */

/** `mcp-federation/trust.ts`'s `CONNECTION_ID_PATTERN` caps a connection id at 40 characters. */
const MAX_CONNECTION_ID_LENGTH = 40;

/**
 * Derives the `external_mcp_servers.serverId` one plugin-declared server maps to: its OWN declared
 * server key (the `mcp.json` object member name), sanitized into `CONNECTION_ID_PATTERN`'s
 * `[a-z0-9][a-z0-9-]{0,39}` charset — lowercased, every run of other characters collapsed to one
 * `-`, leading/trailing `-` trimmed, truncated to 40.
 *
 * Deliberately NOT namespaced by `pluginId` and NOT hash-suffixed (an earlier revision of this file
 * did both, for collision safety) — see this file's header, rule 1: the id must equal what an
 * operator would have hand-typed, because matching that exact id is what lets a pre-existing,
 * hand-configured row (e.g. `higgsfield`) be recognized and left untouched rather than shadowed by a
 * second, uniquely-derived connection beside it.
 *
 * @returns The derived id, or `null` when the server key sanitizes to nothing usable (e.g. a key
 * made entirely of characters outside `[a-z0-9-]`) — reported as a skip by
 * {@link classifyAgentPluginMcpServerForFederation}, never thrown.
 * @complexity O(n) in the server key's length.
 */
export function deriveAgentPluginConnectionId(serverKey: string): string | null {
  const sanitized = serverKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_CONNECTION_ID_LENGTH)
    .replace(/-$/, "");
  return sanitized.length > 0 ? sanitized : null;
}

/** One server this plugin declared that {@link planAgentPluginMcpFederation} will not attempt to
 *  provision, and why — reported rather than silently dropped, matching `mcp-federation/trust.ts`'s
 *  own "every refusal is reportable, never silent" discipline. */
export interface SkippedAgentPluginMcpServer {
  readonly serverKey: string;
  readonly reason: string;
}

/** One server {@link planAgentPluginMcpFederation} determined should be provisioned (subject to
 *  rule 1's existence check at apply time). Carries the derived id and the resolved config, but not
 *  yet `workspaceId`/`principalId` — those are per-CALL, not per-server. */
/** The shape of `classifyAgentPluginMcpServerTrust` (`capability-projection.ts`). */
export type AgentPluginMcpTrustClassifier = (server: Pick<McpServerConfig, "type">) => "auto-admit" | "requires-confirmation";

export interface PlannedAgentPluginMcpUpsert {
  readonly connectionId: string;
  readonly serverKey: string;
  readonly url: string;
  readonly authMode: "oauth" | "none";
  /** The server declares `tokenAuth`, so a `static_env` row holding a saved access token is one
   *  of its declared sign-ins, not a changed auth mode. */
  readonly acceptsAccessToken: boolean;
}

export interface AgentPluginMcpFederationPlan {
  readonly toUpsert: readonly PlannedAgentPluginMcpUpsert[];
  readonly skipped: readonly SkippedAgentPluginMcpServer[];
}

/** One server's classification result — either it is planned for provisioning, or it is skipped
 *  with a reason. Split out of {@link planAgentPluginMcpFederation}'s loop so that function has
 *  exactly one branch point per entry instead of several sequential early-exits.
 *
 * Narrows on the server's OWN `type` first — not merely on `classifyAgentPluginMcpServerTrust`'s
 * return value — so `config.url` below is real TypeScript narrowing, not an assertion. The
 * classifier is still consulted right after: if its rule ever changes to reclassify a remote
 * transport as "requires-confirmation" without this file being updated to match, that mismatch is
 * caught here and refused rather than silently auto-wired against stale reasoning.
 *
 * @complexity O(1).
 */
function classifyAgentPluginMcpServerForFederation(
  serverKey: string,
  config: McpServerConfig,
  classifyTrust: AgentPluginMcpTrustClassifier,
): { readonly kind: "upsert"; readonly planned: PlannedAgentPluginMcpUpsert } | { readonly kind: "skip"; readonly reason: string } {
  if (config.type === "stdio") {
    return { kind: "skip", reason: "declares a 'stdio' local process — requires explicit operator confirmation, never auto-wired from a plugin" };
  }
  if (classifyTrust(config) !== "auto-admit") {
    return {
      kind: "skip",
      reason: "this server's trust classification is not 'auto-admit' — refusing to wire it until this file is re-verified against classifyAgentPluginMcpServerTrust's current rule",
    };
  }
  if (config.type === "sse") {
    return {
      kind: "skip",
      reason: "declares the legacy 'sse' transport, which this Tovu version's external-MCP store does not support (only stdio/streamable_http)",
    };
  }
  // `headers` is validated and preserved by `manifest.ts` but has no column in the external-MCP
  // store, so a non-empty set would otherwise vanish without a skip, warning, or failure. Refuse it
  // explicitly rather than silently provisioning a row that omits configuration the plugin declared —
  // and never copy a header that may carry authorization material into a row this store cannot seal.
  if (config.headers !== undefined && Object.keys(config.headers).length > 0) {
    return {
      kind: "skip",
      reason: "declares HTTP headers, which this Tovu version's external-MCP store does not persist — refusing to provision a row that silently drops them",
    };
  }

  const connectionId = deriveAgentPluginConnectionId(serverKey);
  if (connectionId === null) {
    return { kind: "skip", reason: `server key '${serverKey}' has no valid characters to derive a connection id from` };
  }

  return {
    kind: "upsert",
    planned: { connectionId, serverKey, url: config.url, authMode: config.authMode ?? "none", acceptsAccessToken: config.tokenAuth !== undefined },
  };
}

/**
 * Pure classification pass over one plugin's full mcp.json server configs — no I/O, no
 * `saveExternalMcpServer` call, so this is independently testable from the store's own DB-shaped
 * dependencies.
 *
 * @complexity O(s) in the declared server count.
 */
export function planAgentPluginMcpFederation(input: {
  readonly servers: Readonly<Record<string, McpServerConfig>>;
}, options: {
  /** The trust rule consulted after the stdio narrowing. Defaults to the real
   *  `classifyAgentPluginMcpServerTrust`; injectable so the drift guard above (a remote transport
   *  reclassified as "requires-confirmation") stays verifiable while today's rule never trips it. */
  readonly classifyTrust?: AgentPluginMcpTrustClassifier;
} = {}): AgentPluginMcpFederationPlan {
  const classifyTrust = options.classifyTrust ?? classifyAgentPluginMcpServerTrust;
  const toUpsert: PlannedAgentPluginMcpUpsert[] = [];
  const skipped: SkippedAgentPluginMcpServer[] = [];

  for (const [serverKey, config] of Object.entries(input.servers)) {
    const result = classifyAgentPluginMcpServerForFederation(serverKey, config, classifyTrust);
    if (result.kind === "upsert") toUpsert.push(result.planned);
    else skipped.push({ serverKey, reason: result.reason });
  }

  return { toUpsert, skipped };
}

/**
 * Resolves one installed plugin's full, validated `mcp.json` server configs, given only its
 * `workspaceId`/`pluginId` — the pair a route naturally has, rather than the `packageRoot`
 * `readInstalledMcpServers` actually needs (`AgentPluginSearchCandidate`, the admin route's own read
 * model, deliberately never carries `packageRoot`: an absolute host path, per
 * `tool-registrations.ts`'s own header). Mirrors the identical `listInstalledPlugins` lookup
 * `set-enabled.ts`'s `setAgentPluginEnabled` already performs for its own installed-check — kept as
 * an independent, small duplication rather than widening that function's settled, tested return
 * shape just to smuggle a path through it.
 *
 * @returns `{}` for a plugin id not installed in this workspace — the caller (a route that already
 * 404s on that condition via `setAgentPluginEnabled`'s own precondition) never actually reaches this
 * case, but this function fails closed rather than throwing a second, redundant error for it.
 * @complexity O(d) in installed-digest count, plus one `mcp.json` read.
 */
export async function resolveAgentPluginMcpServers(input: {
  readonly agentPluginLayout: AgentPluginLayout;
  readonly workspaceId: string;
  readonly pluginId: string;
  /** Read-only trust grants require the build's bundled digest, never an arbitrary install. */
  readonly bundledOnly?: boolean;
}, _optional = {}): Promise<Readonly<Record<string, McpServerConfig>>> {
  const workspaceLayout = input.agentPluginLayout.forWorkspace(input.workspaceId);
  // A bundled plugin that was upgraded in place has its superseded package dropped here, so the
  // servers this provisions come from the digest the running build published rather than whichever
  // one the directory walk happened to reach first (`bundled-digests.ts`).
  const bundledDigests = await readBundledAgentPluginDigests(workspaceLayout.root);
  if (input.bundledOnly && !bundledDigests.has(input.pluginId)) return {};
  const installed = preferBundledAgentPluginDigests(
    await listInstalledPlugins(workspaceLayout.root),
    bundledDigests,
  );
  const plugin = installed.find((candidate) => candidate.pluginId === input.pluginId);
  if (input.bundledOnly && plugin?.archiveDigest !== bundledDigests.get(input.pluginId)) return {};
  return plugin ? readInstalledMcpServers(plugin.packageRoot) : {};
}

/**
 * Matches a declaration to the stored server identity AND exact endpoint. A URL edit or
 * normalized-name collision must never inherit another endpoint's defaults.
 * @returns The matching defaults, or `null`.
 * @complexity O(s) time, O(1) space in declared servers.
 */
export function findAgentPluginMcpServerDefaults(
  servers: Readonly<Record<string, McpServerConfig>>,
  row: { readonly serverId: string; readonly url: string | null },
): AgentPluginDefaultTools | null {
  for (const [serverKey, config] of Object.entries(servers)) {
    if (config.type === "stdio" || deriveAgentPluginConnectionId(serverKey) !== row.serverId) continue;
    return config.url === row.url ? config.defaultTools ?? null : null;
  }
  return null;
}

/**
 * Reads the bundled plugin's current manifest on every roster load. Only a build-seeded
 * digest supplies read trust; URL-only connections and arbitrary installed packages cannot.
 * @returns Reviewed remote names for this exact stored endpoint, otherwise an empty set.
 * @complexity One installed-package scan and manifest read, plus O(s + r) matching/list conversion.
 */
export async function resolveAgentPluginReadOnlyRemoteNames(input: {
  readonly agentPluginLayout: AgentPluginLayout;
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly serverId: string;
  readonly url: string;
}, _optional = {}): Promise<ReadonlySet<string>> {
  const servers = await resolveAgentPluginMcpServers({ ...input, bundledOnly: true });
  return new Set(findAgentPluginMcpServerDefaults(servers, input)?.read ?? []);
}

export interface ProvisionAgentPluginMcpServersInput {
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly servers: Readonly<Record<string, McpServerConfig>>;
  /** Attributed on the row exactly as an operator's own Settings → External MCP save would be —
   *  `saveExternalMcpServer`'s own `principalId` doc. */
  readonly principalId: string;
}

export interface ProvisionAgentPluginMcpServersResult {
  /** Connection ids for which a brand-new, disabled row was created this call. */
  readonly provisioned: readonly string[];
  /** Connection ids that already had a row THIS SAME plugin provisioned on an earlier enable, left
   *  completely untouched — rule 1's first case. */
  readonly alreadyProvisioned: readonly string[];
  /** Connection ids that already had a row belonging to an operator, or to a DIFFERENT plugin whose
   *  url, transport, and auth mode match this declaration, left byte-identical except for
   *  `provisionedByPluginId`, which now names this plugin — rule 1's adoption case. Every other field
   *  (url, transport, auth mode, allowlist, write grants, any oauth/sealed column) is exactly what it
   *  was before this call. A different plugin's row at a non-matching endpoint is refused instead —
   *  see {@link failed}. */
  readonly adopted: readonly string[];
  readonly skipped: readonly SkippedAgentPluginMcpServer[];
  readonly failed: readonly SkippedAgentPluginMcpServer[];
}

/** Builds the ONE-TIME creation input for a planned server that rule 1's existence check already
 *  confirmed has no row yet. Split out of {@link provisionAgentPluginMcpServers} purely to keep that
 *  function's complexity under the shop ceiling. `enabled: false` and empty allowlists are rules 2
 *  and 3 — see this file's header. */
function buildProvisioningSaveInput(
  planned: PlannedAgentPluginMcpUpsert,
  input: {
    readonly workspaceId: string;
    readonly pluginId: string;
    readonly principalId: string;
  },
) {
  return {
    workspaceId: input.workspaceId,
    serverId: planned.connectionId,
    label: `${input.pluginId} · ${planned.serverKey}`,
    transport: "streamable_http" as const,
    authMode: planned.authMode,
    enabled: false,
    command: "",
    url: planned.url,
    args: "",
    allowedToolNames: "",
    writeAllowedToolNames: "",
    // A brand-new oauth row structurally REQUIRES a grant (`external-mcp-store.ts`'s
    // `assertOAuthGrant`) even though nothing else is set — `authorization_code` is the only grant
    // Tovu's own RFC 8414/7591 discovery-then-DCR flow can complete without a device-code endpoint,
    // which the Agent Plugins spec has no field to declare anyway.
    ...(planned.authMode === "oauth" ? { oauth: { grant: "authorization_code" as const } } : {}),
    principalId: input.principalId,
    provisionedByPluginId: input.pluginId,
  };
}

/** Whether a row this same plugin provisioned still sits at an endpoint or auth mode the plugin no
 *  longer declares AND nobody has used it yet (never enabled, both tool lists empty, no saved
 *  secret). Such a row holds nothing an operator chose, only provisioning's own defaults plus, at
 *  most, a registered OAuth client minted for the OLD endpoint, which must not carry over to the new
 *  one. It is re-provisioned from the current declaration (rule 1b in this file's header).
 *  @complexity O(1) plus two short JSON parses. */
function isStaleUntouchedProvisioning({ existing, planned, projections }: { existing: AgentPluginMcpRecord; planned: PlannedAgentPluginMcpUpsert; projections: AgentPluginMcpProjections }, _options = {}): boolean {
  // Saved tokens (OAuth or a pasted access token) mean someone signed in: the row may differ from
  // the declaration because an operator edited its URL or auth mode, and deleting it would throw
  // away those edits and the sign-in (Gemini triage T15).
  if (existing.sealedOAuth) return false;
  // A saved access token on a server that declares token sign-in is that declaration in use, not a
  // changed auth mode: treating it as stale deleted the token whenever the row was still disabled
  // (e.g. saved while an operator keeps the plugin off) — Codex review 2026-09-29.
  const authModeMatches = existing.authMode === planned.authMode || (planned.acceptsAccessToken && projections.hasStaticAccessToken(existing));
  const declarationChanged = existing.url !== planned.url || !authModeMatches;
  return declarationChanged && !existing.enabled && isEmptyJsonList(existing.allowedToolNames) && isEmptyJsonList(existing.writeAllowedToolNames);
}

/** A stored JSON tool list that is null, blank, `[]`, or unreadable (the store reads those as `[]`).
 *  Shared with `apply-connect-defaults.ts`. */
export function isEmptyJsonList(raw: string | null): boolean {
  if (!raw) return true;
  try {
    const parsed: unknown = JSON.parse(raw);
    return !Array.isArray(parsed) || parsed.length === 0;
  } catch {
    return true;
  }
}

/** One outcome of handling a planned server for which rule 1's existence check found a row already
 *  present. `alreadyProvisioned` and `adopted` leave every field but `provisionedByPluginId`
 *  untouched (see this file's header); `failed` reports either a refused collision (a DIFFERENT
 *  plugin's row whose endpoint/transport/auth differ from this declaration) or an upsert error. Split
 *  out of {@link provisionAgentPluginMcpServers} purely to keep that function's complexity under the
 *  shop ceiling: the loop gets exactly one branch point per planned server instead of a nested
 *  try/catch inline.
 *  @complexity O(1) plus at most one `repo.upsert` for the adoption case. */
async function adoptOrRecognizeExistingAgentPluginMcpServer(
  deps: AgentPluginMcpProjectionPorts & Pick<AgentPluginMcpPort, "repo">,
  existing: AgentPluginMcpRecord,
  planned: PlannedAgentPluginMcpUpsert,
  pluginId: string,
): Promise<
  | { readonly kind: "alreadyProvisioned" }
  | { readonly kind: "stale" }
  | { readonly kind: "adopted" }
  | { readonly kind: "failed"; readonly reason: string }
> {
  if (existing.provisionedByPluginId === pluginId) {
    return { kind: isStaleUntouchedProvisioning({ existing, planned, projections: deps.projections }) ? "stale" : "alreadyProvisioned" };
  }
  // The connection id is unnamespaced and normalized, so a row already owned by a DIFFERENT plugin
  // may belong to a different server whose key merely sanitized to the same id. Adopting it would
  // rewrite that plugin's provenance while the endpoint stayed put — calls this plugin expects at
  // `mcp__<serverKey>__*` would still reach the other plugin's server (finding 5-2). Such a collision
  // is adopted only when the declared endpoint, transport, and auth mode match exactly; otherwise it
  // is refused and reported, never silently rebound. An operator's own row (`provisionedByPluginId
  // === null`) is still adopted unconditionally: recording an association where none existed is the
  // documented rule-1 behavior, not a rewrite of another plugin's provenance.
  if (
    existing.provisionedByPluginId !== null &&
    (existing.url !== planned.url ||
      existing.transport !== "streamable_http" ||
      existing.authMode !== planned.authMode)
  ) {
    return {
      kind: "failed",
      reason: `connection id '${planned.connectionId}' is owned by plugin '${existing.provisionedByPluginId}' at a different endpoint (url='${existing.url ?? ""}', transport='${existing.transport}', authMode='${existing.authMode}') — refusing to rebind it to plugin '${pluginId}' (declared url='${planned.url}', transport='streamable_http', authMode='${planned.authMode}')`,
    };
  }
  // Direct repo write, never `saveExternalMcpServer` — that function has no way to leave every
  // other field untouched while changing only this one (even its "tri-state" fields resolve a
  // default the caller must supply). Spreading `existing` and changing one property is the only
  // way to guarantee byte-identical preservation of the operator's url/transport/auth/allowlist/
  // write-grants/oauth state.
  await deps.repo.upsert({ ...existing, provisionedByPluginId: pluginId });
  return { kind: "adopted" };
}

/**
 * Idempotently provisions one plugin's auto-admitted remote MCP servers into the external-MCP
 * store, called when an operator ENABLES the plugin (never on disable — see this file's header:
 * disabling a plugin has no effect on any row).
 *
 * Rule 1 is enforced per server, right here: `deps.repo.findByServerId` runs BEFORE any write. A row
 * already at the derived id is NEVER passed through `saveExternalMcpServer` — it is either
 * recognized as this same plugin's earlier work (`alreadyProvisioned`), adopted byte-identical
 * except for `provisionedByPluginId` via a direct `repo.upsert` (`adopted`), or, when it belongs to a
 * DIFFERENT plugin at a non-matching endpoint/transport/auth mode, refused as a genuine collision
 * (`failed`). See {@link adoptOrRecognizeExistingAgentPluginMcpServer}.
 *
 * Per-server failures (a store validation error, an unconfigured secret store, a refused collision,
 * or an adoption's upsert failing) are caught and reported rather than thrown, matching
 * `readEnabledExternalMcpConfigs`'s own fail-open posture: one unwritable row must not stop every
 * other server in the same plugin, or the plugin's own activation, from succeeding.
 *
 * @complexity O(s) in the plugin's declared server count, each one an existence check plus at most
 * one create or adopt.
 */
export async function provisionAgentPluginMcpServers(
  deps: AgentPluginMcpProjectionPorts & Pick<AgentPluginMcpPort, "repo" | "saveServer"> & Partial<Pick<AgentPluginMcpPort, "notifyRosterChanged">>,
  input: ProvisionAgentPluginMcpServersInput,
): Promise<ProvisionAgentPluginMcpServersResult> {
  const plan = planAgentPluginMcpFederation(input);
  const provisioned: string[] = [];
  const alreadyProvisioned: string[] = [];
  const adopted: string[] = [];
  const failed: SkippedAgentPluginMcpServer[] = [];
  // Resolved once per call: every stale-row check uses the host's own projections (required: a
  // portable body never falls back to one host's projections; Tovu's legacy shim adds its pair).
  const bound = { repo: deps.repo, saveServer: (save: Parameters<AgentPluginMcpPort['saveServer']>[0]) => deps.saveServer(save), projections: deps.projections, classifyError: deps.classifyError };

  for (const planned of plan.toUpsert) {
    const outcome = await provisionPlannedServer({ deps: bound, input, planned });
    if (outcome.kind === "failed") failed.push({ serverKey: planned.serverKey, reason: outcome.reason });
    else if (outcome.kind === "provisioned") provisioned.push(planned.connectionId);
    else if (outcome.kind === "adopted") adopted.push(planned.connectionId);
    else alreadyProvisioned.push(planned.connectionId);
  }

  // Both admin and chat enable use this owner. Even a plugin with no MCP servers contributes
  // guidance, so notify after provisioning settles rather than only after a connection write.
  await deps.notifyRosterChanged?.({}, {});
  return { provisioned, alreadyProvisioned, adopted, skipped: plan.skipped, failed };
}

/** Execute one planned write, keeping lookup, adoption and replacement failures isolated. */
async function provisionPlannedServer(
  required: {
    readonly deps: AgentPluginMcpProjectionPorts & Pick<AgentPluginMcpPort, "repo" | "saveServer">;
    readonly input: ProvisionAgentPluginMcpServersInput;
    readonly planned: PlannedAgentPluginMcpUpsert;
  },
  _options = {},
): Promise<{ readonly kind: "provisioned" | "alreadyProvisioned" | "adopted" } | { readonly kind: "failed"; readonly reason: string }> {
  const { deps, input, planned } = required;
  try {
    const existing = await deps.repo.findByServerId({ workspaceId: input.workspaceId, serverId: planned.connectionId });
    if (existing) {
      const outcome = await adoptOrRecognizeExistingAgentPluginMcpServer(deps, existing, planned, input.pluginId);
      if (outcome.kind !== "stale") return outcome;
      // Rule 1b: replaced by a fresh row, exactly as a first enable would write it.
      await deps.repo.deleteByServerId({ workspaceId: input.workspaceId, serverId: planned.connectionId });
    }

    await deps.saveServer(buildProvisioningSaveInput(planned, input));
    return { kind: "provisioned" };
  } catch (err) {
    return { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}
