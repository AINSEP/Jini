import { buildDomainRegistrations, indexCatalogById, optionalNumber, optionalString, requireInputRecord, ToolInputError, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration, type AgentToolDefinition } from "@jini-ai/core";
import { describeAgentPluginCompatibility, agentPluginDependentWarnings } from "../compatibility.js";
import { projectAgentPluginSearchPage } from "../search-projection.js";
import type { AgentPluginSearchCandidate } from "../search.js";
import type { AgentPluginActivations } from "../activation.js";
import type { InstalledAgentPlugin } from "../types.js";
import { readInstalledAgentPluginIdentity, type PluginMaturity } from "./identity.js";
import { summarizeSkillMarkdown, type AgentPluginSkillDetail } from "./skill-tool.js";
import type { AgentPluginHostToolPorts } from "./ports.js";

/**
 * ===========================================================================================
 * `search_agent_plugin_local` — a SEPARATE, STATIC tool, not another per-plugin dynamic one
 * ===========================================================================================
 *
 * Everything above this point (`agent_plugin_<pluginId>`, `registerInstalledAgentPluginTools`) is a
 * dynamic tool PER installed, ACTIVE plugin — its id, schema, and description cannot exist until an
 * async disk read has resolved which plugins are installed, which is why that half of this file is
 * wired directly onto the `ToolRegistry` from `agent-daemon-server.ts`'s boot sequence rather than
 * through the ordinary static `ToolContributor` seam (see this file's header, "Why this is NOT a
 * ToolContributor").
 *
 * `search_agent_plugin_local` is different in kind: ONE tool, whose id/schema/description are known
 * at module load with no disk access at all — the disk read happens inside the HANDLER, at call time,
 * the same way `plugins_list`'s handler reads `discoverPlugins()` fresh on every call. That is exactly
 * the shape every OTHER domain's `contribute<Domain>Tools()` already has, so this tool is wired through
 * the ordinary static seam (`tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`) rather
 * than joining the dynamic half above — it is part of the ~171-tool native catalog `search_tools`
 * indexes at boot, not something that only exists after a workspace-scoped async load has run.
 *
 * ---------------------------------------------------------------------------
 * The gap this closes
 * ---------------------------------------------------------------------------
 * The assistant can enable/disable a discovered host-family plugin (`plugins_set_enabled`,
 * `features/plugin-runtime/tool-registrations.ts` — a DIFFERENT plugin system, see that file's own
 * 2026-08-23 header note) and can USE an already-active Agent Plugin's skills
 * (`agent_plugin_<pluginId>`, above) — but before this addition there was no way to FIND one. An
 * operator asking "is there a plugin for X" had no tool that could answer; the only paths in were
 * either already knowing the exact `agent_plugin_<pluginId>` id, or `search_tools` happening to
 * surface one of those dynamic per-plugin tools directly (which only works for plugins that are both
 * installed AND already enabled — `loadInstalledAgentPluginToolSources` filters to
 * `filterActiveAgentPlugins` before registering a single dynamic tool). A disabled-but-installed
 * plugin was invisible to every surface.
 *
 * ---------------------------------------------------------------------------
 * Local only — no marketplace/web search (by design, not by omission)
 * ---------------------------------------------------------------------------
 * This searches `listInstalledPlugins()` — packages already extracted under this workspace's own
 * `packages/sha256/*` (`layout.ts`). It does not reach a marketplace, a registry, or the web. That is
 * a deliberate scope line, not a missing follow-up bolted on later: the response shape below (a flat
 * `matches[]` of already-installed plugins) says nothing about install source, so a future marketplace
 * search can be added as a SECOND tool (or a second mode) without this one's contract having to grow a
 * "local vs remote" distinction it does not need today.
 *
 * ---------------------------------------------------------------------------
 * Ranking signal: why keywords, id, description, AND skills — not keywords alone
 * ---------------------------------------------------------------------------
 * `plugin.json`'s `keywords` array is the obvious signal — author-curated, exactly analogous to
 * `tool-search-keywords.ts`'s whole reason for existing (operators ask in words the artifact's own
 * prose does not contain). But keywords alone would under-serve this catalog for a concrete, measured
 * reason: the real bundled `ui-ux-design` package ships NO `keywords` field at all (verified —
 * `<site>/agent-plugins/ws/workspace-local/packages/sha256/.../plugin.json` has only `name`
 * and `description`), so a keywords-only ranker would make that entire installed plugin unfindable by
 * search. `id` and `description` both matter for the same reason `search_components`'s own catalog
 * ranks on id+description+capabilities together rather than one field alone. See `search.ts`'s own
 * header for the full per-field weighting rationale and why skills are folded in too, at the lowest
 * weight.
 *
 * ---------------------------------------------------------------------------
 * SECURITY — same no-host-path discipline as the dynamic tools above
 * ---------------------------------------------------------------------------
 * `loadAgentPluginSearchCandidates` below reads `plugin.packageRoot` only to pass it to
 * `resolveSkillsForPlugin`/`readInstalledMcpServerIds` — neither value, nor any other absolute path,
 * is stored on `AgentPluginSearchCandidate` or reaches the handler's response. MCP servers are
 * reported as ids only (`readInstalledMcpServerIds`'s own doc: never transport config, which MAY
 * carry secrets).
 */

const SEARCH_AGENT_PLUGIN_LOCAL_TOOL_ID = "search_agent_plugin_local";

/** Mirrors `component-catalog-tool.ts`'s local limit constants — same
 *  reasoning: the values are the contract this schema states to the model, so restating them (rather
 *  than importing a value from an unrelated domain) keeps the enforced bound and the documented one
 *  from silently drifting apart. */
const SEARCH_LIMIT_MAX = 50;
const SEARCH_LIMIT_DEFAULT = 10;

/** The narrow slice of the route-deps bag this tool's handler reads — only a workspace id, since
 *  everything else it needs (`listInstalledPlugins`, `readAgentPluginActivations`) is resolved from
 *  that id alone via `layout.ts`. Declared structurally, mirroring `PluginsToolDeps`'s own shape, so
 *  `assistant/tool-registrations.ts` can fold this into `AssistantToolRegistryDeps` without this
 *  domain importing that file's god type back. */
export interface AgentPluginSearchToolDeps {
  readonly workspaceId: string;
  readonly ports: AgentPluginHostToolPorts;
}

const SEARCH_AGENT_PLUGIN_LOCAL_DESCRIPTION =
  "Find an Agent Plugin by the task, capability, skill or MCP server you need. Searches local " +
  "agent-plugins.org packages (plugin.json, skills and optional mcp.json) in this workspace, including " +
  "inactive packages. For the full plugin inventory, use content_read.plugin. Empty, omitted or " +
  "whitespace query returns every local Agent Plugin in plugin-id order, including enabled status. " +
  "Nonblank queries return ranked matches. " +
  "Results are byte-bounded: id, pluginId, enabled, maturity when declared, and a short description. " +
  "plugins_set_enabled with family 'agent-plugin' changes enabled status. " +
  "An installed, off result is only a catalog entry. Offer its enable card, then read its guidance before connecting or requesting credentials; never guess its sign-in method. " +
  "Local packages only — never a marketplace or the web. Once you have the right id, call " +
  "load_agent_plugin({ pluginId }) for that plugin's full guidance. Page with the returned nextOffset as offset, keeping query and limit unchanged.";

const SEARCH_AGENT_PLUGIN_LOCAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      description:
        "What you're looking for, in plain language — e.g. 'a plugin for deploying a server app', " +
        "'accessibility guidance', 'gdpr compliance checks'. Matched against each installed Agent " +
        "Plugin's id, author-declared keywords, description, and bundled skills. Optional; empty, omitted or whitespace lists all installed plugins.",
    },
    offset: { type: "integer", minimum: 0, description: "Zero-based result offset. Start at 0; continue with nextOffset until null." },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: SEARCH_LIMIT_MAX,
      description: `Max results to return (1-${SEARCH_LIMIT_MAX}). Optional, defaults to ${SEARCH_LIMIT_DEFAULT}.`,
    },
  },
} as const;

/** This tool's one-entry catalog, exported (not inlined into {@link buildAgentPluginSearchRegistrations})
 *  so `assistant/__tests__/tool-registrations.contracts.test.ts`'s `CATALOGS_BY_DOMAIN` — which
 *  cross-checks every wired domain's published schema/risk/actor-class contract against this SAME
 *  source of truth — can import it the same way it imports every sibling domain's `<domain>AgentToolCatalog`. */
export function agentPluginSearchToolCatalog(required: { readonly permission: string }, _optional: Record<string, never> = {}): AgentToolDefinition[] {
  return [
    {
      name: SEARCH_AGENT_PLUGIN_LOCAL_TOOL_ID,
      description: SEARCH_AGENT_PLUGIN_LOCAL_DESCRIPTION,
      sideEffects: "none",
      authorization: { permission: required.permission },
      inputSchema: SEARCH_AGENT_PLUGIN_LOCAL_SCHEMA,
    },
  ];
}

/**
 * Resolves every installed plugin in one workspace into a search-ready {@link AgentPluginSearchCandidate}.
 *
 * UNLIKE {@link loadInstalledAgentPluginToolSources} (the dynamic per-plugin tool loader above), this
 * INCLUDES disabled plugins. Search exists so the assistant can find — and then a human can decide
 * whether to turn on — an installed-but-inactive plugin; filtering those out here would make a
 * disabled plugin permanently undiscoverable through the one tool that could report it exists.
 *
 * UNLIKE that same loader's {@link assertSingleDigestPerPlugin}, a plugin id installed under more than
 * one digest is NOT fatal here: this silently keeps the first-encountered digest for that id rather
 * than throwing, so every OTHER, unambiguous plugin in the workspace stays discoverable. The ambiguity
 * itself is still a loud, operator-actionable error the moment anything tries to actually USE the
 * plugin (`resolveOnePluginRef`/the dynamic-tool loader both refuse outright) — duplicating that
 * refusal in a read-only search tool would only make discovery unavailable too, for no safety benefit.
 *
 * @complexity O(p * s) in installed-plugin count times average skills-per-plugin — the same shape
 * {@link loadInstalledAgentPluginToolSources} already accepts for this identical catalog, plus one
 * `mcp.json` read per plugin.
 *
 * Also consumed by the admin installed-plugin listing:
 * `server/inbound/admin-http/routes/agent-plugins/list.ts` — the admin UI's read of the SAME
 * installed-plugin state this tool searches — reuses this loader rather than re-deriving it, so
 * "what plugins are installed" has one source of truth with two consumers (a tool and the admin
 * page), matching this file's own `listInstalledPlugins` precedent above.
 */
/** A search candidate whose identity was read from the installed `plugin.json`: `readPluginIdentity`
 *  always yields an `id` and a `provides` list, so this loader's callers never need a fallback for
 *  either (the shared `AgentPluginSearchCandidate` type leaves both optional for other producers). */
export type IdentifiedAgentPluginSearchCandidate = AgentPluginSearchCandidate & { readonly id: string; readonly provides: readonly string[]; readonly maturity?: PluginMaturity; readonly providerPlugin?: string };

export async function loadAgentPluginSearchCandidates(ctx: AgentPluginSearchToolDeps, _optional = {}): Promise<readonly IdentifiedAgentPluginSearchCandidate[]> {
  const { lifecycle } = ctx.ports;
  const workspaceLayout = ctx.ports.layout.forWorkspace({ workspaceId: ctx.workspaceId });
  // The first-encountered-digest rule below is a fallback for an ambiguity nothing can resolve. An
  // upgraded BUNDLED plugin is no longer one of those cases: its superseded package is dropped here,
  // so this lists the version the running build ships (`bundled-digests.ts`).
  const installed = lifecycle.preferBundledAgentPluginDigests({
    installed: await lifecycle.listInstalledPlugins({ workspaceRoot: workspaceLayout.root }),
    bundled: await lifecycle.readBundledAgentPluginDigests({ workspaceRoot: workspaceLayout.root }),
  });
  const activations = await ctx.ports.activations.readAgentPluginActivations({ workspaceRoot: workspaceLayout.root });

  const seenPluginIds = new Set<string>();
  const candidates: IdentifiedAgentPluginSearchCandidate[] = [];

  for (const plugin of installed) {
    if (seenPluginIds.has(plugin.pluginId)) continue;
    seenPluginIds.add(plugin.pluginId);

    // Per-PLUGIN isolation: a failure here that is not one skill's own read must not take every
    // OTHER installed plugin's search entry down with it — before this, one such failure threw out
    // of `loadAgentPluginSearchCandidates` entirely, which is why `search_agent_plugin_local` (and the
    // admin Agent Plugins page, the same loader's second caller) could fail outright over a single
    // bad install. Per-SKILL isolation (one unreadable SKILL.md not costing its own plugin, let alone
    // every other one) is `resolveSkillsForSearchTolerant`'s job, above. Defensive today: neither
    // call below throws on any known input (`readInstalledMcpServerIds` already collapses a missing,
    // unreadable, or invalid `mcp.json` to `[]`), so this guards a future throwing change there.
    try {
      candidates.push({ ...await buildSearchCandidate({ plugin, activations, ports: ctx.ports }),
        archiveDigest: plugin.archiveDigest,
        ...describeAgentPluginCompatibility({ plugin, installed, activations }),
        requiredBy: agentPluginDependentWarnings({ plugin, installed, activations, nextProvides: [] }),
      });
    } catch (error) {
      console.warn(`[agent-plugins] '${plugin.pluginId}': ${error instanceof Error ? error.message : String(error)} — excluded from search`);
    }
  }

  return candidates;
}

/** This tool's own risk classification: a pure read of already-installed, already-validated local
 *  content, same as every other read-only tool this domain and its siblings (`plugins_list`,
 *  `search_components`) already declare `"none"` for. */
export const agentPluginSearchDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  [SEARCH_AGENT_PLUGIN_LOCAL_TOOL_ID, "none"],
]);

/** Validate the paging hint independently of catalog I/O; invalid offsets throw ToolInputError.
 * @complexity O(1) time and space. */
function readAgentPluginSearchWindow({ input }: { input: Record<string, unknown> }, _optional = {}): { offset: number; limit: number } {
  const rawLimit = optionalNumber({ input, key: "limit" });
  const rawOffset = optionalNumber({ input, key: "offset" });
  if (rawOffset !== undefined && (!Number.isSafeInteger(rawOffset) || rawOffset < 0)) {
    throw new ToolInputError({ message: 'offset must be a non-negative safe integer' });
  }
  const offset = rawOffset ?? 0;
  // Clamped, not rejected — an out-of-range limit is an optimization hint, not part of what the
  // caller is actually asking for, mirroring `component-catalog-tool.ts`'s identical treatment of
  // `search_components`' own `limit` argument.
  const limit = rawLimit === undefined ? SEARCH_LIMIT_DEFAULT : Math.min(Math.max(Math.trunc(rawLimit), 1), SEARCH_LIMIT_MAX);

  return { offset, limit };
}

type RankedAgentPluginSearchCandidate = IdentifiedAgentPluginSearchCandidate & { readonly score: number };

/** List the existing catalog for blank input; otherwise delegate ranking to its Jini owner.
 * Does not mutate candidates. Listing assigns score zero because no query was scored.
 * @complexity Listing O(p log p) time and O(p) space in installed plugins; ranking retains Jini's cost. */
function selectAgentPluginSearchCandidates(
  { query, candidates, ports }: { query: string; candidates: readonly IdentifiedAgentPluginSearchCandidate[]; ports: AgentPluginHostToolPorts },
  _optional = {},
): readonly RankedAgentPluginSearchCandidate[] {
  if (query.trim() === "") {
    return [...candidates].sort((a, b) => a.pluginId.localeCompare(b.pluginId)).map(candidate => ({ ...candidate, score: 0 }));
  }
  // Rank the whole local catalog once, then page it; the response bound is not a discovery cap.
  // The shared ranker spreads each candidate, preserving the host's metadata.
  return ports.lifecycle.rankInstalledAgentPlugins({ query, candidates, limit: candidates.length }) as readonly RankedAgentPluginSearchCandidate[];
}

/**
 * Builds the `search_agent_plugin_local` registration — pure catalog/schema construction plus one
 * handler closure; the actual disk read happens only when the handler is invoked, matching
 * `plugins_list`'s identical "read fresh on every call" shape.
 *
 * @param routeDeps Workspace and the host-tool ports.
 * @returns One registration; its handler validates input and returns a page without host paths.
 * @example buildAgentPluginSearchRegistrations({ workspaceId, ports });
 * @complexity O(1) to build; see {@link loadAgentPluginSearchCandidates} and
 * {@link selectAgentPluginSearchCandidates} for the handler's per-call cost.
 */
export function buildAgentPluginSearchRegistrations(routeDeps: AgentPluginSearchToolDeps, _optional: Record<string, never> = {}): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    [SEARCH_AGENT_PLUGIN_LOCAL_TOOL_ID]: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      const query = optionalString({ input, key: "query" }) ?? "";
      const { offset, limit } = readAgentPluginSearchWindow({ input });
      const candidates = await loadAgentPluginSearchCandidates(routeDeps);
      const ranked = selectAgentPluginSearchCandidates({ query, candidates, ports: routeDeps.ports });
      return projectAgentPluginSearchPage({ candidates: ranked, offset, limit, totalInstalled: candidates.length });
    },
  };

  return buildDomainRegistrations({ ...(routeDeps.ports.metadata ? { metadata: routeDeps.ports.metadata } : {}),
    domain: "agent-plugin-search",
    catalogModule: "lifecycle/host-tools/search-tool.ts",
    catalog: indexCatalogById({ catalog: agentPluginSearchToolCatalog({ permission: routeDeps.ports.permissions.use }) }),
    handlers,
    derivedRisk: agentPluginSearchDerivedRisk,
  });
}

/**
 * Same per-skill work as {@link resolveSkillsForPlugin}, but tolerant of ONE skill's own read
 * failure — used only by the search loader below ({@link loadAgentPluginSearchCandidates}), which
 * must keep the plugin, and its OTHER skills, discoverable rather than losing the whole entry (and
 * every other installed plugin behind it in the same call, since one unhandled rejection here would
 * fail the entire `loadAgentPluginSearchCandidates` promise) to one skill file that is present in
 * the fresh directory walk but no longer actually readable (a permissions problem, disk corruption).
 * Logged and skipped, never fabricated.
 *
 * The dynamic-tool loader ({@link loadInstalledAgentPluginToolSources}) deliberately keeps
 * `resolveSkillsForPlugin`'s stricter, plugin-wide failure instead: a tool whose catalog description
 * silently dropped one of its skills is a worse failure mode there than refusing the whole plugin's
 * tool, so that loader's own per-plugin `catch` (below) is intentionally left alone.
 */
async function resolveSkillsForSearchTolerant(plugin: {
  readonly pluginId: string;
  readonly packageRoot: string;
  readonly skills: readonly { readonly name: string; readonly skillPath: string }[];
}, ports: AgentPluginHostToolPorts): Promise<AgentPluginSkillDetail[]> {
  const skills: AgentPluginSkillDetail[] = [];
  for (const skill of plugin.skills) {
    try {
      const markdown = await ports.lifecycle.readInstalledSkillMarkdown({ packageRoot: plugin.packageRoot, skillPath: skill.skillPath });
      skills.push({ name: skill.name, summary: summarizeSkillMarkdown(skill.name, markdown, ports), markdown,
        readFile: (_input, options = {}) => ports.lifecycle.readInstalledSkillFile({ packageRoot: plugin.packageRoot, skillPath: skill.skillPath }, options),
      });
    } catch (error) {
      console.warn(
        `[agent-plugins] '${plugin.pluginId}': skill '${skill.name}' could not be read ` +
          `(${error instanceof Error ? error.message : String(error)}) — skipped from search`,
      );
    }
  }
  return skills;
}

async function buildSearchCandidate(
  { plugin, activations, ports }: { plugin: InstalledAgentPlugin; activations: AgentPluginActivations; ports: AgentPluginHostToolPorts },
  _optional: Record<string, never> = {},
): Promise<IdentifiedAgentPluginSearchCandidate> {
  const skills = await resolveSkillsForSearchTolerant(plugin, ports);
  const mcpServerIds = await ports.lifecycle.readInstalledMcpServerIds({ packageRoot: plugin.packageRoot });
  const identity = await readInstalledAgentPluginIdentity({ plugin });

  return {
    pluginId: plugin.pluginId,
    ...(plugin.displayName !== undefined ? { displayName: plugin.displayName } : {}),
    ...(plugin.summary !== undefined ? { summary: plugin.summary } : {}),
    ...(plugin.version !== undefined ? { version: plugin.version } : {}),
    ...(plugin.description !== undefined ? { description: plugin.description } : {}),
    id: identity.id,
    ...(identity.maturity ? { maturity: identity.maturity } : {}),
    ...(identity.providerPlugin ? { providerPlugin: identity.providerPlugin } : {}),
    provides: identity.provides,
    keywords: identity.keywords,
    enabled: ports.activations.isAgentPluginActive({ activations: activations, pluginId: plugin.pluginId }),
    skills: skills.map((skill) => ({ name: skill.name, summary: skill.summary })),
    mcpServerIds,
  };
}
