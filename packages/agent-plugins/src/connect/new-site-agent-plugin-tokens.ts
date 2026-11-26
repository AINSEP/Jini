import type { Dirent } from "node:fs";
import path from "node:path";

import { parsePluginTokenMap, type TokenMapLimits } from "./token-map.js";
import type { TokenCheckOutcome, TokenSignInPlugin } from "./token-sign-in.js";
import type { ResolvedAgentPluginForConnect } from "./installed-plugin.js";
import { orFallback } from "@jini-ai/core/errors/idioms";


import type { createAgentPluginLifecycle } from "../lifecycle/index.js";
import { titleCaseFromPluginId } from "./connect-tool.js";
import type { InstalledAgentPluginServers } from "./import-access-token.js";
import { listTokenSignInPlugins } from "./token-sign-in.js";

/**
 * @file The rules for access tokens given while CREATING a site, shared by every create path: the
 * admin's `POST .../system/sites` (`routes/system/sites.ts`) and the host CLI's create command
 * (`cli/commands/init.ts`, which the desktop app's "Create website" runs). Added 2026-09-29 so the
 * desktop create form offers the same optional "Connect services" step as the admin's.
 *
 * Generic: keyed by plugin id; a plugin qualifies by declaring `tokenAuth` (`token-sign-in.ts`).
 * Nothing here ever returns or logs a token.
 */

/**
 * `{ [pluginId]: token }`, trimmed, blanks dropped. `null`/`undefined` is "none given".
 * @complexity O(n) in the entry count (bounded).
 */
export function parseNewSiteAgentPluginTokens({ raw, limits: TOKEN_LIMITS, shapeError: NEW_SITE_AGENT_PLUGIN_TOKENS_SHAPE_ERROR }: { raw: unknown; limits: TokenMapLimits; shapeError: string }, _optional: Record<string, never> = {}): { ok: true; tokens: Record<string, string> } | { ok: false; error: string } {
  const parsed = parsePluginTokenMap({ raw, limits: TOKEN_LIMITS }, {});
  return parsed.ok ? { ok: true, tokens: { ...parsed.tokens } } : { ok: false, error: NEW_SITE_AGENT_PLUGIN_TOKENS_SHAPE_ERROR };
}

/** Why a token given at create time stops the create, or `null` when it may be stored. A token the
 *  vendor could not be reached to check is still stored: the new site's first use tells. */
export function describeNewSiteAgentPluginTokenRefusal({ pluginId, outcome, copy }: { pluginId: string; outcome: TokenCheckOutcome; copy: Record<"refused" | "invalid" | "unsupported", (input: { name: string }) => string> }, _optional: Record<string, never> = {}
): { code: "AGENT_PLUGIN_TOKEN_INVALID" | "AGENT_PLUGIN_TOKEN_REFUSED" | "AGENT_PLUGIN_TOKEN_UNSUPPORTED"; error: string } | null {
  const name = titleCaseFromPluginId({ pluginId });
  // A purpose refusal must still stop a pre-save check, without mislabelling a usable key.
  if (outcome === "refused") {
    return { code: "AGENT_PLUGIN_TOKEN_REFUSED", error: copy.refused({ name }) };
  }
  if (outcome === "invalid") {
    return { code: "AGENT_PLUGIN_TOKEN_INVALID", error: copy.invalid({ name }) };
  }
  if (outcome === "unsupported") {
    return { code: "AGENT_PLUGIN_TOKEN_UNSUPPORTED", error: copy.unsupported({ name }) };
  }
  return null;
}

/**
 * The first refusal across `tokens`, checked in order, or `null` when every token may be stored.
 * @complexity One check (at most one outbound GET) per token.
 */
export async function firstNewSiteAgentPluginTokenRefusal({ check, tokens, copy }: { copy: Parameters<typeof describeNewSiteAgentPluginTokenRefusal>[0]["copy"]; check: (input: { pluginId: string; token: string }) => Promise<TokenCheckOutcome>; tokens: Readonly<Record<string, string>> }, _optional: Record<string, never> = {}
): Promise<{ pluginId: string; code: string; error: string } | null> {
  for (const [pluginId, token] of Object.entries(tokens)) {
    const refusal = describeNewSiteAgentPluginTokenRefusal({ pluginId, outcome: await check({ pluginId, token }), copy });
    if (refusal) return { pluginId, ...refusal };
  }
  return null;
}

/** The plugin's manifest `name`, or `null` when `plugin.json` is missing or unreadable. */
async function readBundledPluginId({ pluginDir, readFile, pluginIdPattern: PLUGIN_ID_PATTERN }: { pluginDir: string; readFile(path: string, encoding: "utf8"): Promise<string>; pluginIdPattern: RegExp }, _optional: Record<string, never> = {}): Promise<string | null> {
  return orFallback({
    work: async () => {
      const manifest = JSON.parse(await readFile(path.join(pluginDir, "plugin.json"), "utf8")) as { name?: unknown };
      return typeof manifest.name === "string" && PLUGIN_ID_PATTERN.test(manifest.name) ? manifest.name : null;
    },
    fallback: null,
    step: "read bundled token plugin ID",
  });
}

/**
 * The bundled plugins shipped with this host (`content/agent-plugins/`, `deps.ts`'s
 * `bundledAgentPluginsDir()`), for a create path that runs before the new site has a workspace to
 * install them into — the new site's first boot seeds exactly these. An absent dir is an empty list.
 * The host supplies its bundled-source override, else `<product>/content/agent-plugins`;
 * importing composition here would pull its whole server graph into a feature for one path.
 *
 * @complexity O(p) plugin dirs, one manifest and one `mcp.json` read each.
 */
export async function listBundledAgentPluginServers(
  required: {
    bundledSourceRoot: string; retired: Pick<ReadonlySet<string>, 'has'>; pluginIdPattern: RegExp;
    readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
    readFile(path: string, encoding: 'utf8'): Promise<string>;
    readInstalledMcpServers: ReturnType<typeof createAgentPluginLifecycle>['readInstalledMcpServers'];
  },
  _optional = {},
): Promise<readonly InstalledAgentPluginServers[]> {
  const { bundledSourceRoot: sourceRoot, retired: RETIRED_BUNDLED_AGENT_PLUGINS, readdir, readInstalledMcpServers } = required;
  const entries = await orFallback<Dirent[]>({
    work: () => readdir(sourceRoot, { withFileTypes: true }),
    fallback: [],
    step: "list bundled token plugins",
  });
  const out: InstalledAgentPluginServers[] = [];
  for (const entry of entries) {
    // Same skip as `seed-bundled.ts`: a retired id is never seeded, so it is never offered.
    if (!entry.isDirectory() || RETIRED_BUNDLED_AGENT_PLUGINS.has(entry.name)) continue;
    const pluginDir = path.join(sourceRoot, entry.name);
    const pluginId = await readBundledPluginId({ pluginDir, readFile: required.readFile, pluginIdPattern: required.pluginIdPattern });
    if (pluginId !== null) out.push({ pluginId, servers: await readInstalledMcpServers({ packageRoot: pluginDir }) });
  }
  return out;
}

/** `checkAgentPluginAccessToken`'s `resolveInstalledPlugin`, answered from the bundled plugins. */
export function resolveBundledAgentPlugin(
  paths: Parameters<typeof listBundledAgentPluginServers>[0],
  _optional = {},
): (pluginId: string) => Promise<ResolvedAgentPluginForConnect | null> {
  return async (pluginId) => {
    const found = (await listBundledAgentPluginServers(paths)).find((plugin) => plugin.pluginId === pluginId);
    return found ? { servers: found.servers } : null;
  };
}

/**
 * The plugins a NEW site can be connected to with a pasted token: the bundled ones its first boot
 * seeds. Not the creating site's installs — a plugin only that site has would be offered, pass the
 * check, and then never exist on the new site.
 *
 * @complexity O(p) bundled plugin dirs.
 */
export function listNewSiteAgentPluginTokenSignInPlugins(
  paths: Parameters<typeof listBundledAgentPluginServers>[0],
  _optional = {},
): Promise<readonly TokenSignInPlugin[]> {
  return listTokenSignInPlugins({ workspaceId: "new-site", listPlugins: () => listBundledAgentPluginServers(paths) });
}
