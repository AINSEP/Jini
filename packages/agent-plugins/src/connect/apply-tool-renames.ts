import { type Clock as ClockPort, nowIso as clockNowIso } from "@jini-ai/core/primitives";
import { deriveAgentPluginConnectionId, type AgentPluginMcpRecord, type AgentPluginMcpRepo } from "@jini-ai/agent-plugins/connect";
import type { McpServerConfig } from "@jini-ai/agent-plugins/lifecycle";

/** One installed plugin's declared MCP servers, as the host's installed-package reads list them. */
interface InstalledAgentPluginServers { readonly pluginId: string; readonly servers: Readonly<Record<string, McpServerConfig>> }
/** Boot log the host routes to its own sink. */
interface TokenImportLog { info(message: string): void; warn(message: string): void }

/**
 * @file Carries saved tool selections across a vendor's tool rename, so an operator never has to
 * re-tick a tool the server now offers under a new name.
 *
 * A plugin's `mcp.json` declares the rename on the server entry (`renamedTools: { "get_logs":
 * "query_logs" }`, parsed by `manifest.ts`). At boot, every row that plugin provisioned has each old
 * name in `allowedToolNames` and `writeAllowedToolNames` replaced by the new one. Added 2026-09-29
 * when Supabase renamed `get_logs` to `query_logs` and the saved dev row kept asking for a tool the
 * server no longer offers.
 *
 * Applied only to a row that names this plugin as its provisioner AND sits at the url the plugin
 * declares — the same match `apply-connect-defaults.ts` uses — so an operator's own row, or one
 * pointed elsewhere, is never touched.
 *
 * Never widens access: a new name takes exactly the grants its old name had (read stays read, write
 * stays write), and a rename whose old name is not in a list adds nothing to that list. Idempotent:
 * once rewritten, the old names are gone and later boots write nothing. Reversible: declaring the
 * opposite rename puts the old names back.
 */

export interface ApplyAgentPluginToolRenamesDeps {
  readonly workspaceId: string;
  readonly externalMcpServerRepo: AgentPluginMcpRepo;
  readonly clock: ClockPort;
  /** Recorded as the row's write-grant attribution when a rename changes its write list.
   * @agent-note Second host: a stable system actor id of YOUR vocabulary; it is saved on the row
   * (`writeGrantsUpdatedByPrincipalId`), so changing it changes saved bytes for later renames. */
  readonly actor: string;
  /** The host's installed-plugin reads (a pre-seam default listed them from the plugin layout).
   * @agent-note Second host: list only trusted installed packages; rows are matched by provisioner AND url. */
  readonly listPlugins: () => Promise<readonly InstalledAgentPluginServers[]>;
  /** Announces a changed roster so live runtimes reload — the composition root passes
   *  `notifyExternalMcpRosterChanged`. A port rather than a value import: a feature module may not
   *  value-import `#src/assistant/` (`domain-no-direct-tool-registration.boundary.test.ts`). */
  readonly notifyRosterChanged: () => Promise<void>;
}

/** A stored JSON tool list as names, or `null` when it is not a JSON array of strings (left alone). */
function readToolList(raw: string | null): string[] | null {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((name): name is string => typeof name === "string") ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * `names` with every renamed entry replaced, order kept, duplicates dropped — or `null` when
 * nothing in it was renamed.
 * @complexity O(n) in the list length.
 */
export function renameToolNames(required: { readonly names: readonly string[]; readonly renames: Readonly<Record<string, string>> }, _optional: Record<string, never> = {}): string[] | null {
  const { names, renames } = required;
  if (!names.some((name) => Object.hasOwn(renames, name))) return null;
  return [...new Set(names.map((name) => (Object.hasOwn(renames, name) ? renames[name]! : name)))];
}

/** The matching provisioned row with its two tool lists renamed, or `null` when neither list
 * changed (or either is unreadable). */
function renameRowTools(
  input: {
    readonly row: AgentPluginMcpRecord;
    readonly renames: Readonly<Record<string, string>>;
    readonly clock: ClockPort;
    readonly actor: string;
    readonly pluginId: string;
    readonly url: string;
  },
  _options = {},
): AgentPluginMcpRecord | null {
  const { row, renames, clock, pluginId, url, actor } = input;
  if (row.provisionedByPluginId !== pluginId || row.url !== url) return null;
  const nowIso = clockNowIso({ clock });
  const allow = readToolList(row.allowedToolNames);
  const write = readToolList(row.writeAllowedToolNames);
  if (allow === null || write === null) return null;
  const renamedAllow = renameToolNames({ names: allow, renames });
  const renamedWrite = renameToolNames({ names: write, renames });
  if (renamedAllow === null && renamedWrite === null) return null;
  return {
    ...row,
    ...(renamedAllow === null ? {} : { allowedToolNames: JSON.stringify(renamedAllow) }),
    ...(renamedWrite === null
      ? {}
      : { writeAllowedToolNames: JSON.stringify(renamedWrite), writeGrantsUpdatedByPrincipalId: actor, writeGrantsUpdatedAt: nowIso }),
    updatedAt: nowIso,
  };
}

/** Applies one declaration only to its provisioned row at the declared endpoint. */
async function applyServerToolRenames(
  input: {
    readonly deps: ApplyAgentPluginToolRenamesDeps;
    readonly pluginId: string;
    readonly serverKey: string;
    readonly config: McpServerConfig;
    readonly log: TokenImportLog;
  },
  _options = {},
): Promise<boolean> {
  const { deps, pluginId, serverKey, config, log } = input;
  if (config.type === "stdio" || !config.renamedTools) return false;
  const serverId = deriveAgentPluginConnectionId(serverKey);
  if (serverId === null) return false;
  const result = { changed: false };
  try {
    const row = await deps.externalMcpServerRepo.findByServerId({ workspaceId: deps.workspaceId, serverId });
    if (!row) return false;
    const renamed = renameRowTools({ row, renames: config.renamedTools, clock: deps.clock, actor: deps.actor, pluginId, url: config.url });
    if (!renamed) return false;
    await deps.externalMcpServerRepo.upsert(renamed);
    result.changed = true;
    const renames = Object.entries(config.renamedTools).map(([from, to]) => `${from} -> ${to}`).join(", ");
    log.info(`[agent-plugins] '${serverId}': renamed saved tools to follow the '${pluginId}' plugin (${renames}).`);
    return true;
  } catch (err) {
    log.warn(`[agent-plugins] could not apply the '${pluginId}' plugin's tool renames to '${serverId}': ${err instanceof Error ? err.message : String(err)}`);
  }
  return result.changed;
}

/**
 * Boot: rewrites renamed tool names on every row an installed plugin provisioned. Logs each rewrite
 * once (the next boot finds nothing to do) and notifies the roster when any row changed. Never
 * throws: a failure is a warning and the next boot tries again.
 *
 * @complexity O(p·s) over installed plugins and their servers, plus one row read per declared rename
 * and at most one write per row.
 */
export async function applyAgentPluginToolRenames(required: { readonly deps: ApplyAgentPluginToolRenamesDeps; readonly log: TokenImportLog }, _optional: Record<string, never> = {}): Promise<void> {
  const { deps, log } = required;
  let plugins: readonly InstalledAgentPluginServers[];
  try {
    plugins = await deps.listPlugins();
  } catch (err) {
    log.warn(`[agent-plugins] could not list plugins to apply tool renames: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  let changed = false;
  for (const { pluginId, servers } of plugins) {
    for (const [serverKey, config] of Object.entries(servers)) {
      if (await applyServerToolRenames({ deps, pluginId, serverKey, config, log })) changed = true;
    }
  }
  if (changed) await deps.notifyRosterChanged();
}
