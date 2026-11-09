import { ToolInputError, redactSecrets } from '@jini-ai/core';

import { createApplyConnectDefaults, type ApplyConnectDefaultsDeps } from "@jini-ai/agent-plugins/connect";
import { hasStoredAgentPluginCredential } from "./connect-tool.js";
import { deriveAgentPluginConnectionId, type AgentPluginMcpProjectionPorts } from "@jini-ai/agent-plugins/connect";
import type { InstalledAgentPluginServers, TokenImportLog } from "./import-access-token.js";
import type { McpServerConfig } from "@jini-ai/agent-plugins/lifecycle";

/**
 * @file "Plugin on + account connected" grants the plugin's declared tools, whichever of the two
 * happens LAST — not only when the sign-in happens last.
 *
 * `apply-connect-defaults.ts` grants a plugin's declared `defaultTools` (allowlist and "may
 * write") when the operator's sign-in finishes, and `agent_plugin_connect` re-runs that grant for an
 * already signed-in row. Both are sign-in moments. Bug 2026-11-04 (jared-floyd, Higgsfield Media):
 * the owner turned the plugin on and signed in, yet the connection stayed off with zero tools, and
 * the chat could only tell them to tick 8 tools and 3 writes by hand. Whenever the sign-in grant
 * skipped or failed at sign-in time (the plugin was off then, the plugin did not declare the tools
 * yet, a post-connect step failed and was only logged), nothing ever tried again: switching the
 * plugin on and restarting the host both left the signed-in row empty. This file is the two other
 * moments, and both reuse the sign-in grant itself (`createApplyConnectDefaults`) so every rule it
 * enforces still holds — only a still-empty row this plugin provisioned, at the url it still
 * declares, never for a plugin an operator turned off, exactly the declared lists:
 *
 * - {@link grantDeclaredToolsToSignedInRows} — the operator switching the plugin on (the admin
 *   toggle and `plugins_set_enabled`). Switching on is the operator's consent, the sign-in already
 *   was; a row that is not signed in gets nothing, because enabling alone is not a connection.
 * - {@link grantDeclaredToolsAtBoot} — boot, for every plugin that is on. Heals a site whose grant
 *   was missed before this file existed, with no action from the owner. Narrower than the toggle: a
 *   row whose write grants were ever set by anyone (`writeGrantsUpdatedByPrincipalId`) is skipped,
 *   so a boot never re-grants what an operator emptied on purpose after an earlier grant.
 *
 * Automatic healing never widens a grant: a row with any tool already listed is left alone (the
 * sign-in grant's own rule), so an update cannot silently reach a row that already has its tools.
 * An explicit enable card is the exception: the owner reviewed the source and resulting lists,
 * so its approvedEnable option can add those declared names even before sign-in.
 * The grant writes the row on and notifies the roster, so the running assistant admits the
 * connection's tools without a restart (Jini `federation/reload.ts` admits a not-yet-admitted row).
 */

/** @agent-note Bind the SAME repo/private context, projection/error pair, stable saved actor ids
 * and activation queue as the sign-in grant/admin toggle. Projections are pure; approval key and
 * principal pass through unchanged. No host defaults or extra store/activation instance here. */
export type GrantSignedInDefaultsDeps = ApplyConnectDefaultsDeps & {
  /** Injected for tests. Defaults to the sign-in's own grant, {@link createApplyConnectDefaults}. */
  readonly onConnected?: (serverId: string) => Promise<void>;
  /** @agent-note Your diagnostic sink. Advisory failures remain warnings and later rows still run. */
  readonly warn: (message: string) => void;
  /** @agent-note YOUR enable-tool retry guidance; detail is bounded and the complete result is
   * redacted before becoming a public ToolInputError. Do not add credential material. */
  readonly approvedFailure: (required: { connectionId: string; detail: string }) => string;
};

interface GrantDeclaredToolsOptions {
  readonly onlyNeverGranted?: boolean;
  /** Servers whose provisioning just failed (their row could not even be read or written): nothing to grant. */
  readonly skipServerKeys?: readonly string[];
  /** The enable card already named these sources and grants; sign-in can happen afterwards. */
  readonly approvedEnable?: { readonly principalId: string; readonly accessKey: string };
}

/** Bind the existing sign-in grant to its explicit approval occasion; test ports retain precedence.
 * @complexity O(1) construction, no I/O.
 */
function connectGrantFor({ deps, options, ports }: { deps: GrantSignedInDefaultsDeps; options: GrantDeclaredToolsOptions; ports: AgentPluginMcpProjectionPorts }): (serverId: string) => Promise<void> {
  return deps.onConnected ?? createApplyConnectDefaults({ ...deps, ...ports }, options.approvedEnable ? { approvedEnable: options.approvedEnable } : {});
}

/** Run the existing grant owner for one eligible row, then report its actual durable change.
 * @complexity Two indexed row reads plus the existing grant's own point read/write and reload.
 */
async function grantConnection({ deps, pluginId, connectionId, onConnected, options, ports }: { deps: GrantSignedInDefaultsDeps; pluginId: string; connectionId: string; onConnected: (serverId: string) => Promise<void>; options: GrantDeclaredToolsOptions; ports: AgentPluginMcpProjectionPorts }): Promise<boolean> {
  const row = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId: connectionId });
  if (!row || !eligibleGrantRow({ row, pluginId, approvedEnable: options.approvedEnable !== undefined, ports })) return false;
  if (!options.approvedEnable && row.writeGrantsUpdatedByPrincipalId === deps.actors.connectDeclined) return false;
  if (options.onlyNeverGranted && row.writeGrantsUpdatedByPrincipalId !== null) return false;
  await onConnected(connectionId);
  const after = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId: connectionId });
  return after !== null && (after.enabled !== row.enabled || after.allowedToolNames !== row.allowedToolNames || after.writeAllowedToolNames !== row.writeAllowedToolNames);
}

/** Explicit approvals must report a partial failure to the caller; boot healing remains advisory.
 * @throws ToolInputError for the approved enable path, with bounded redacted cause.
 * @complexity O(e) in error-message bytes; no I/O beyond the injected warning port.
 */
function grantFailure({ error, pluginId, connectionId, approved, warn, approvedFailure }: { error: unknown; pluginId: string; connectionId: string; approved: boolean; warn: (message: string) => void; approvedFailure: GrantSignedInDefaultsDeps['approvedFailure'] }): void {
  const detail = error instanceof Error ? error.message : String(error);
  if (approved) throw new ToolInputError({ message: redactSecrets({ input: approvedFailure({ connectionId, detail: detail.slice(0, 2000) }) }) });
  warn(`[agent-plugins] '${pluginId}': could not turn on the '${connectionId}' connection with the tools the plugin declares — ${detail}`);
}

/**
 * Runs the sign-in grant on each of `pluginId`'s declared remote servers whose row this plugin
 * provisioned and that already holds a credential (finished sign-in or saved access token).
 *
 * @returns The connection ids whose tools the grant actually turned on (its own rules may skip one).
 * @throws Nothing: a failing row is a warning naming the row and the cause; the others still run.
 * @complexity O(s) in declared servers: one row read each, plus at most one grant and one re-read.
 */
export async function grantDeclaredToolsToSignedInRows(
  required: { readonly deps: GrantSignedInDefaultsDeps; readonly pluginId: string; readonly servers: Readonly<Record<string, McpServerConfig>> },
  optional: GrantDeclaredToolsOptions = {},
): Promise<readonly string[]> {
  const { deps, pluginId, servers } = required;
  const warn = deps.warn;
  // Resolved once per call: the eligibility check and the grant use the host's same pair.
  const ports: AgentPluginMcpProjectionPorts = deps;
  const onConnected = connectGrantFor({ deps, options: optional, ports });
  const granted: string[] = [];
  for (const [serverKey, config] of Object.entries(servers)) {
    const connectionId = config.type === "stdio" || optional.skipServerKeys?.includes(serverKey) ? null : deriveAgentPluginConnectionId(serverKey);
    if (connectionId === null) continue;
    try {
      if (await grantConnection({ deps, pluginId, connectionId, onConnected, options: optional, ports })) granted.push(connectionId);
    } catch (error) {
      grantFailure({ error, pluginId, connectionId, approved: optional.approvedEnable !== undefined, warn, approvedFailure: deps.approvedFailure });
    }
  }
  return granted;
}

/** Explicit activation consent can precede sign-in; automatic healing still requires credentials.
 * @complexity O(1), no I/O. */
function eligibleGrantRow({ row, pluginId, approvedEnable, ports }: { row: NonNullable<Awaited<ReturnType<GrantSignedInDefaultsDeps['repo']['findByServerId']>>>; pluginId: string; approvedEnable: boolean; ports: AgentPluginMcpProjectionPorts }, _options = {}): boolean {
  if (row.provisionedByPluginId !== pluginId) return false;
  return approvedEnable || hasStoredAgentPluginCredential({ row, projections: ports.projections });
}

/**
 * Boot: {@link grantDeclaredToolsToSignedInRows} for every installed plugin that is on (no record
 * reads as on, as everywhere else; the seeder's default-off and an operator's off are both skipped,
 * so a boot never switches a plugin on), limited to rows nobody ever granted write access on.
 *
 * @throws Nothing: a listing or activation-read failure is one warning, and the next boot retries.
 * @complexity O(p·s) over installed plugins and their servers.
 */
export async function grantDeclaredToolsAtBoot(
  required: { readonly deps: GrantSignedInDefaultsDeps & {
    /** @agent-note Fresh installed declarations from your lifecycle owner; no filesystem default. */
    readonly listPlugins: () => Promise<readonly InstalledAgentPluginServers[]>;
    /** @agent-note ONE activation snapshot from the SAME activation owner/queue as enablePlugin;
     * read after listing, absent records mean enabled, explicit off never grants at boot. */
    readonly readActivations: () => Promise<{ readonly plugins: Readonly<Record<string, { readonly enabled: boolean } | undefined>> }>;
  }; readonly log: TokenImportLog },
  _optional: Record<string, never> = {},
): Promise<void> {
  const { deps, log } = required;
  let plugins: readonly InstalledAgentPluginServers[];
  let activations: Awaited<ReturnType<typeof deps.readActivations>>;
  try {
    plugins = await deps.listPlugins();
    activations = await deps.readActivations();
  } catch (error) {
    log.warn(`[agent-plugins] could not check signed-in plugin connections for their declared tools: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  for (const { pluginId, servers } of plugins) {
    if (activations.plugins[pluginId]?.enabled === false) continue;
    const granted = await grantDeclaredToolsToSignedInRows({ deps: { ...deps, warn: (message) => log.warn(message) }, pluginId, servers }, { onlyNeverGranted: true });
    if (granted.length > 0) log.info(`[agent-plugins] '${pluginId}': turned on its signed-in connection(s) ${granted.join(", ")} with the tools the plugin declares.`);
  }
}
