import type { AgentPluginIdentityReadOptions } from "../core/identity-namespace.js";
/**
 * @file "Soon" Agent Plugins are locked off (owner, 2026-11-10). The owner has not tested them and does
 * not want anyone trying them, so nothing may switch one on: the admin switch, `plugins_set_enabled`,
 * a sign-in's connect defaults and a provider plugin's face mirror all refuse, a backup import writes
 * them off, and boot switches off any that an older build left on. "untested" stays a warning only.
 * The files stay installed, so people can still open the plugin and read them.
 *
 * Maturity is the manifest flag (Jini's `readPluginMaturity`) plus the host's own list of Soon plugin
 * ids (`hostSoonPluginIds`, injected from the host's bundled catalog). This module imports no lifecycle
 * code: the host's lifecycle binds it into the enable paths of the activation owner, and boot passes the
 * same ports.
 */
import { readPluginMaturity } from "../lifecycle/host-tools/identity.js";
import type { PluginMaturity } from "@jini-ai/core/contracts/site/lifecycle-host-tools";
import { orFallback } from "@jini-ai/core/errors/idioms";

/** Recorded as `updatedBy` when boot switches a Soon plugin off, so the audit says why. */
export const SOON_LOCK_ACTOR = "system:soon-lock";

/** Turning on a Soon plugin was refused. Nothing was written. */
export class AgentPluginNotReadyError extends Error {
  readonly code = "AGENT_PLUGIN_NOT_READY";
  readonly pluginId: string;
  constructor({ pluginId, name }: { pluginId: string; name: string }) {
    super(`${name} isn't ready yet, so it can't be turned on. You can still view its files.`);
    this.name = "AgentPluginNotReadyError";
    this.pluginId = pluginId;
  }
}

/** The manifest's maturity flag wins; an unflagged plugin on the host's list reads "soon".
 *  Jini's reader takes no plugin id, so the host list is applied here, not in `identity.ts`.
 *  @complexity O(1). */
export function readHostPluginMaturity({ manifest, pluginId, hostSoonPluginIds }: { manifest: unknown; pluginId: string; hostSoonPluginIds: ReadonlySet<string> }, options: Pick<AgentPluginIdentityReadOptions, "legacyIdentity"> & { warn?: (message: string) => void } = {}): PluginMaturity | undefined {
  return readPluginMaturity({ manifest }, options) ?? (hostSoonPluginIds.has(pluginId) ? "soon" : undefined);
}

type SoonPlugin = { readonly pluginId: string; readonly displayName?: string | undefined };

/** The installed packages of one workspace and their manifests: the lifecycle owner's own reads. */
export interface SoonCatalogPort<P extends SoonPlugin = SoonPlugin> {
  readonly list: (required: { readonly workspaceRoot: string }) => Promise<readonly P[]>;
  readonly readManifest: (required: { readonly plugin: P }) => Promise<string>;
}

/**
 * The Soon plugin `pluginId` names, or undefined when it may be switched on. Any installed revision
 * flagged "soon" locks the id; an unreadable manifest reads as unflagged (the host list still applies),
 * and an id not installed here is judged by the host list alone.
 * @complexity One package listing plus one manifest read per installed revision of `pluginId`.
 */
export async function findSoonAgentPlugin<P extends SoonPlugin>(
  { catalog, workspaceRoot, pluginId, hostSoonPluginIds }: { catalog: SoonCatalogPort<P>; workspaceRoot: string; pluginId: string; hostSoonPluginIds: ReadonlySet<string> },
  optional: Pick<AgentPluginIdentityReadOptions, "legacyIdentity"> = {},
): Promise<{ readonly name: string } | undefined> {
  const revisions = (await catalog.list({ workspaceRoot })).filter(plugin => plugin.pluginId === pluginId);
  const name = revisions.find(plugin => plugin.displayName)?.displayName ?? pluginId;
  if (revisions.length === 0) return readHostPluginMaturity({ manifest: undefined, pluginId, hostSoonPluginIds }, optional) === "soon" ? { name } : undefined;
  for (const plugin of revisions) {
    const manifest: unknown = await orFallback({
      work: async () => JSON.parse(await catalog.readManifest({ plugin })),
      fallback: undefined,
      step: "read plugin maturity manifest",
    });
    if (readHostPluginMaturity({ manifest, pluginId, hostSoonPluginIds }, optional) === "soon") return { name };
  }
  return undefined;
}

/** @throws {AgentPluginNotReadyError} `pluginId` is a Soon plugin. @complexity As {@link findSoonAgentPlugin}. */
export async function assertAgentPluginReady<P extends SoonPlugin>(required: { catalog: SoonCatalogPort<P>; workspaceRoot: string; pluginId: string; hostSoonPluginIds: ReadonlySet<string> }, optional: Pick<AgentPluginIdentityReadOptions, "legacyIdentity"> = {}): Promise<void> {
  const soon = await findSoonAgentPlugin(required, optional);
  if (soon) throw new AgentPluginNotReadyError({ pluginId: required.pluginId, name: soon.name });
}

/**
 * Boot: switches off every installed Soon plugin that is currently on (an older build, a retirement
 * successor, an import, or a record that never existed, which reads as on). Nothing is uninstalled.
 * @returns The plugin ids it switched off. @complexity O(p) installed packages, one manifest read each.
 */
export async function lockSoonAgentPlugins<P extends SoonPlugin>(
  { catalog, activations, workspaceRoot, hostSoonPluginIds }: {
    catalog: SoonCatalogPort<P>;
    activations: {
      readonly resolveAgentPluginActivation: (required: { workspaceRoot: string; pluginId: string }) => Promise<{ readonly verdict: string }>;
      readonly setAgentPluginActivation: (required: { workspaceRoot: string; pluginId: string; enabled: boolean; actor: string }) => Promise<unknown>;
    };
    workspaceRoot: string;
    hostSoonPluginIds: ReadonlySet<string>;
  },
  optional: Pick<AgentPluginIdentityReadOptions, "legacyIdentity"> = {},
): Promise<readonly string[]> {
  const switched: string[] = [];
  for (const pluginId of new Set((await catalog.list({ workspaceRoot })).map(plugin => plugin.pluginId))) {
    if (!(await findSoonAgentPlugin({ catalog, workspaceRoot, pluginId, hostSoonPluginIds }, optional))) continue;
    if ((await activations.resolveAgentPluginActivation({ workspaceRoot, pluginId })).verdict === "inactive") continue;
    await activations.setAgentPluginActivation({ workspaceRoot, pluginId, enabled: false, actor: SOON_LOCK_ACTOR });
    switched.push(pluginId);
  }
  return switched;
}
