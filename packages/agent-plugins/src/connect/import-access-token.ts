import { resolveTarget, saveStaticAccessToken, type AgentPluginTokenTargetDeps, type TokenAuthTarget } from "./access-token-tool.js";
import { hasStoredAgentPluginCredential } from "./connect-tool.js";
import type { McpServerConfig } from "@jini-ai/agent-plugins/lifecycle";
import type { AgentPluginInstalledMcpReads, SavedTokenSwitchOutcome } from "@jini-ai/agent-plugins/connect";

/**
 * @file Saves an access token that did NOT come through `agent_plugin_set_access_token`'s form onto
 * an Agent Plugin's token-auth row, then switches the plugin on (`switch-on-saved-token.ts`, shared
 * with the tool) — the same end state as a pasted token followed by a first sign-in.
 *
 * Two callers, both at boot (`server/runtime/boot/bootstrap.ts`):
 * - {@link importAgentPluginAccessTokensFromEnv}: a plugin's `mcp.json` may name an old env var
 *   (`tokenAuth.importFromEnv`) whose token is copied over. Added 2026-09-29 when the Supabase
 *   env preset (host-provided variable names) was retired in favour of the Supabase plugin.
 * - create-site onboarding's pending tokens (`composition/pending-agent-plugin-tokens.ts`).
 *
 * Never overwrites: a row that already holds a credential (a sign-in or a saved token) keeps it; the
 * switch-on still runs, so a save whose switch-on failed is finished by the next import.
 * Not probed: the env token was already in use, and onboarding probes before it seals.
 *
 * The env import trusts only what THIS host build shipped: a declaration is read from a plugin only
 * when its installed digest is the one `seed-bundled.ts` recorded (`bundled-digests.ts`), and the
 * token only goes to a row still at that declaration's URL. Any installed package can declare
 * `importFromEnv`, so without this an operator-installed plugin could name `OPENAI_API_KEY` and an
 * endpoint of its own and be handed that secret at boot (Codex review 2026-09-29).
 */

/** @agent-note Bind the SAME repo/vault/projection pair and saved-token switch owner as the token
 * tool and sign-in callback. Imports finish an interrupted switch without replacing a credential.
 * `importActor` is YOUR stable saved principal id; no filesystem, actor or activation default exists here. */
export interface ImportAgentPluginAccessTokenDeps
  extends AgentPluginTokenTargetDeps {
  readonly importActor: string;
  readonly switchOnSavedToken: (required: { target: TokenAuthTarget }) => Promise<SavedTokenSwitchOutcome>;
}

/** `saved-left-off`: the token is saved but an operator had turned the plugin or its connection off,
 *  so it stays off (`switch-on-saved-token.ts`). */
export type ImportAgentPluginAccessTokenOutcome = "saved" | "saved-left-off" | "already-connected";

/**
 * Seals `token` onto `pluginId`'s token-auth row unless that row already has a credential, then
 * switches the plugin on (also when it already had one, to finish an earlier interrupted import).
 *
 * @throws {import("@jini-ai/core").ToolInputError} Plugin not installed, or no single token-auth server.
 * @throws Whatever the store throws on save (e.g. an unconfigured secret store).
 * @complexity O(s) in the plugin's declared servers, plus one row read and at most two writes.
 */
export async function importAgentPluginAccessToken(
  required: { readonly deps: ImportAgentPluginAccessTokenDeps; readonly input: {
    readonly pluginId: string;
    readonly token: string;
    readonly principalId?: string;
    /** When set, the token is saved only onto a row at exactly this URL (the env import's rule). */
    readonly onlyAtUrl?: string;
  } },
  _optional: Record<string, never> = {},
): Promise<ImportAgentPluginAccessTokenOutcome> {
  const { deps, input } = required;
  const principalId = input.principalId ?? deps.importActor;
  const target = await resolveTarget({ routeDeps: deps, pluginId: input.pluginId, principalId });
  const row = await deps.mcp.repo.findByServerId({ workspaceId: deps.workspaceId, serverId: target.connectionId });
  if (row && hasStoredAgentPluginCredential({ row, projections: deps.mcp.projections })) {
    // Finishes a switch-on an earlier import saved the token for but did not complete (it threw
    // after the save): idempotent, and it keeps an operator's off switch (`switch-on-saved-token.ts`).
    await deps.switchOnSavedToken({ target });
    return "already-connected";
  }
  if (input.onlyAtUrl !== undefined && (row?.url ?? target.config.url) !== input.onlyAtUrl) {
    throw new Error(`its '${target.connectionId}' connection points at a different URL than the '${input.pluginId}' plugin declares, so the token is not copied there`);
  }

  await saveStaticAccessToken({ routeDeps: deps, target, principalId, token: input.token });
  const switched = await deps.switchOnSavedToken({ target });
  return switched.state === "on" ? "saved" : "saved-left-off";
}

/** One installed plugin's id and declared servers. */
export interface InstalledAgentPluginServers {
  readonly pluginId: string;
  readonly servers: Readonly<Record<string, McpServerConfig>>;
  /** True only when this is the digest this host build seeded for the id (`bundled-digests.ts`).
   *  Absent reads as not bundled. */
  readonly bundled?: boolean;
}

/** Every installed plugin in the workspace, one per id (the bundled-preferred digest).
 * @agent-note Bind YOUR lifecycle owner's trusted workspace root and installed reads. This job
 * reads the ledger first, then lists/prefer-selects installed packages, then reads one declaration
 * per first-seen id; the SAME ledger decides bundled eligibility. Fresh reads, no cache. */
export async function listInstalledAgentPluginServers(input: { readonly workspaceRoot: string; readonly lifecycle: AgentPluginInstalledMcpReads }, _options = {}): Promise<readonly InstalledAgentPluginServers[]> {
  const ledger = await input.lifecycle.readBundledAgentPluginDigests({ workspaceRoot: input.workspaceRoot });
  const installed = input.lifecycle.preferBundledAgentPluginDigests({ installed: await input.lifecycle.listInstalledPlugins({ workspaceRoot: input.workspaceRoot }), bundled: ledger });
  const seen = new Set<string>();
  const out: InstalledAgentPluginServers[] = [];
  for (const plugin of installed) {
    if (seen.has(plugin.pluginId)) continue;
    seen.add(plugin.pluginId);
    out.push({ pluginId: plugin.pluginId, servers: await input.lifecycle.readInstalledMcpServers({ packageRoot: plugin.packageRoot }), bundled: ledger.get(plugin.pluginId) === plugin.archiveDigest });
  }
  return out;
}

/** @agent-note Your boot log sink; importer/store error text is deliberately withheld because it
 * may contain a token. Keep the safe fixed failure copy rather than logging the caught error. */
export interface TokenImportLog {
  info(message: string): void;
  warn(message: string): void;
}

/** @agent-note The host supplies environment VALUES and a fresh trusted installed listing; only
 * rows whose bundled digest belongs to that host build may import. Pending explicit tokens win. */
export interface ImportAgentPluginAccessTokensFromEnvDeps extends ImportAgentPluginAccessTokenDeps {
  /** @agent-note Bind {@link listInstalledAgentPluginServers} over your lifecycle owner and root. */
  readonly listPlugins: () => Promise<readonly InstalledAgentPluginServers[]>;
  /** @agent-note YOUR screen name and safe failure guidance. Never interpolate an importer error
   * or token; these messages go to the boot log and can outlive the current process. */
  readonly importMessages: {
    readonly pluginsScreen: string;
    failed(required: { envName: string; pluginId: string }): string;
  };
}

/** The env declarations of every token-auth server across the BUNDLED plugins (see this file's header). */
function envDeclarations(plugins: readonly InstalledAgentPluginServers[]) {
  return plugins.flatMap(({ pluginId, servers, bundled }) =>
    bundled === true
      ? Object.values(servers).flatMap((config) => (config.type !== "stdio" && config.tokenAuth ? [{ pluginId, url: config.url, auth: config.tokenAuth }] : []))
      : [],
  );
}

/**
 * Boot: for each bundled plugin whose token-auth server names `importFromEnv`, copies a set env
 * token onto its row (logged once, on the boot that copies it — later boots find the row connected
 * and say nothing), and names any set `retiredEnv` vars as no longer used. Never throws: a failed
 * import is a warning and the next boot tries again.
 *
 * @complexity O(p·s) over installed plugins and their servers, plus one import per set env token.
 */
export async function importAgentPluginAccessTokensFromEnv(
  required: { readonly deps: ImportAgentPluginAccessTokensFromEnvDeps; readonly env: Readonly<Record<string, string | undefined>>; readonly log: TokenImportLog },
  options: {
    /** Plugins with a create-site onboarding token still pending: that explicit token wins over the
     *  env one, so the env token is not copied onto them (`bootstrap.ts`). */
    readonly skipPluginIds?: ReadonlySet<string>;
  } = {},
): Promise<void> {
  const { deps, env, log } = required;
  let plugins: readonly InstalledAgentPluginServers[];
  try {
    plugins = await deps.listPlugins();
  } catch (err) {
    log.warn(`[agent-plugins] could not list plugins to import env tokens: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  for (const { pluginId, url, auth } of envDeclarations(plugins)) {
    reportRetiredEnv({ pluginId, auth, env, log });
    const token = auth.importFromEnv ? (env[auth.importFromEnv] ?? "").trim() : "";
    await importDeclaredEnvToken({ deps, pluginId, url, auth, token, log, skipPluginIds: options.skipPluginIds });
  }
}

type EnvDeclaration = ReturnType<typeof envDeclarations>[number];

/** Retirement notices are independent of whether this boot has a token to import. */
function reportRetiredEnv(input: Pick<EnvDeclaration, "pluginId" | "auth"> & { readonly env: Readonly<Record<string, string | undefined>>; readonly log: TokenImportLog }, _options = {}): void {
  const { pluginId, auth, env, log } = input;
  const retiredSet = (auth.retiredEnv ?? []).filter((name) => (env[name] ?? "").trim() !== "");
  if (retiredSet.length > 0) {
    log.info(`[agent-plugins] ${retiredSet.join(", ")} ${retiredSet.length === 1 ? "is" : "are"} no longer used; the '${pluginId}' plugin's connection replaces them. You can remove them.`);
  }
}

/** Isolate one import's failure so later declarations still run. */
async function importDeclaredEnvToken(input: EnvDeclaration & { readonly deps: ImportAgentPluginAccessTokensFromEnvDeps; readonly token: string; readonly log: TokenImportLog; readonly skipPluginIds?: ReadonlySet<string> }, _options = {}): Promise<void> {
  const { deps, pluginId, url, auth, token, log, skipPluginIds } = input;
  if (!auth.importFromEnv || token === "" || skipPluginIds?.has(pluginId)) return;
  try {
    const outcome = await importAgentPluginAccessToken({ deps, input: { pluginId, token, onlyAtUrl: url } });
    if (outcome === "saved") {
      log.info(`[agent-plugins] copied ${auth.importFromEnv} onto the '${pluginId}' plugin's connection and switched it on. The env var is no longer needed.`);
    }
    if (outcome === "saved-left-off") {
      log.info(`[agent-plugins] copied ${auth.importFromEnv} onto the '${pluginId}' plugin's connection; it stays off because an operator turned it off (${deps.importMessages.pluginsScreen}). The env var is no longer needed.`);
    }
  } catch {
    // Importer/store failures can echo the token; keep all importer text out of boot logs.
    log.warn(deps.importMessages.failed({ envName: auth.importFromEnv, pluginId }));
  }
}
