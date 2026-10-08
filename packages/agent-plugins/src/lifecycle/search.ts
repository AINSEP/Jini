/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */

import type { AgentPluginLifecyclePorts } from "./ports.js";

/**
 * @file Pure relevance ranking for `search_agent_plugin_local` — turns one workspace's already-
 * resolved installed Agent Plugins into scored matches for a free-text query. No filesystem or
 * network I/O; `tool-registrations.ts` is the caller that reads disk and hands this module already-
 * resolved {@link AgentPluginSearchCandidate}s.
 *
 * ---------------------------------------------------------------------------
 * Why field-weighted substring matching, not FTS5/BM25
 * ---------------------------------------------------------------------------
 * `assistant/tool-catalog-query.ts` (the `search_tools` index this tool itself is found through)
 * seeds a real SQLite FTS5 table because its catalog is runtime-registered and can be large (170+
 * tools, changing per boot/workspace). The catalog THIS function ranks over is different in kind:
 * one workspace's own installed Agent Plugins, read fresh off disk on every call, realistically a
 * handful of entries. `assistant/component-catalog-query.ts` (`search_components`) already
 * establishes the house precedent for exactly this shape — "a handful of manifests doesn't warrant
 * a database for substring matching" — and ranks with plain `haystack.includes(term)` scoring. This
 * module reuses that same technique rather than inventing a second one, with one deliberate
 * difference from that precedent: per-field WEIGHTS instead of one flat merged haystack.
 *
 * The weights are not decorative. `plugin.json` (agent-plugins.org) carries a `keywords` array
 * that `component-catalog-query.ts`'s manifests have no equivalent of — author-curated discovery
 * terms, the exact same "operator asks in different words than the code uses" gap
 * `tool-search-keywords.ts`'s own header describes at length for native tools. A keyword hit is a
 * stronger, more deliberate signal than an incidental word landing inside free-form prose, so it is
 * scored higher. The id (`pluginId`) is scored highest of all: it is what a caller actually types
 * back to `plugins_set_enabled`-shaped tools next, so an exact or near match on it (a caller typing
 * "site-compliance" or "compliance") must win outright — mirroring `tool-catalog.ts`'s own
 * documented "id weighted 6x description" ratio for the identical reason (id IS the thing quoted
 * back). Skill name/summary text is weighted lowest: it is the broadest, noisiest vocabulary (every
 * bundled skill's own frontmatter description folded in), valuable for recall on a query that names
 * a capability rather than a plugin ("shadcn components") but not something that should let one
 * verbose plugin outrank a plugin whose own id/keywords/description directly named the query.
 * Plugin `description` sits in between: real author prose, but not curated tags and not the
 * identity string itself.
 *
 * A plugin's own `version`, `enabled` state, and MCP server ids are carried through on every match
 * for the caller to report, but are NOT scored — none of them are text a caller plausibly searches
 * for ("find me the plugin on version 1.1.0" is not a real query), and an MCP server id is often an
 * arbitrary machine-chosen string with no natural-language relationship to what an operator would
 * type.
 *
 * @complexity `rankInstalledAgentPlugins` is O(c * t * f) — c candidates, t query terms, f fields
 * (a fixed constant, 4) — so effectively O(c * t): linear in the installed-plugin count and query
 * length, both small and locally bounded (there is no user-controlled upper bound on installed-
 * plugin count today, matching the same unbounded-but-locally-small shape
 * `loadInstalledAgentPluginToolSources` already accepts for the very same catalog).
 */
/** One installed plugin's skill, reduced to what search ranks and reports on — never the full
 *  SKILL.md body (that stays behind `agent_plugin_<pluginId>`'s own tool, which a caller reaches
 *  once search has told it which plugin to ask). */
export interface AgentPluginSearchSkill {
  readonly name: string;
  /** Plain-language explainer from the host extension namespace in `plugin.json`: `summary`, for the admin list
   *  route only — not ranked, and the search tool's own response projection leaves it out. */
  readonly summary: string;
}

/** One installed plugin, already resolved into everything the ranker and the response need — no
 *  `packageRoot`/`skillPath`/any other host-filesystem detail (see `tool-registrations.ts`'s own
 *  SECURITY note for why: this candidate shape is what actually reaches the model). */
export interface AgentPluginSearchCandidate {
  readonly pluginId: string;
  readonly version?: (string) | undefined;
  /** Human-facing title from the host extension namespace in `plugin.json`: `displayName`, when the package set one. */
  readonly displayName?: string | undefined;
  readonly summary?: string | undefined;
  readonly description?: (string) | undefined;
  readonly keywords: readonly string[];

  /** Whether this workspace currently has the plugin enabled — reflects `activation.ts`'s
   *  absent-means-active default, same as everywhere else this codebase reads activation state. */
  readonly enabled: boolean;
  readonly skills: readonly AgentPluginSearchSkill[];

  /** Server ids only, from the package's own `mcp.json` — never transport config (`command`/`args`/
   *  `env` can carry secrets; see `capability-projection.ts`'s identical restraint). */
  readonly mcpServerIds: readonly string[];
}

/** One ranked result: a candidate plus the score it earned against a specific query. */
export interface AgentPluginSearchMatch extends AgentPluginSearchCandidate {
  readonly score: number;
}

function buildModule(ports: AgentPluginLifecyclePorts) {

  const ID_FIELD_WEIGHT = 5;
  const KEYWORD_FIELD_WEIGHT = 4;
  const DESCRIPTION_FIELD_WEIGHT = 2;
  const SKILL_FIELD_WEIGHT = 1;

  /** Lowercase, whitespace-split query terms — mirrors `component-catalog-query.ts`'s identical
 *  `query.toLowerCase().split(/\s+/).filter(Boolean)`, the house tokenizer for this "small local
 *  catalog, plain string matching" shape. Empty/whitespace-only input yields no terms. */
  function tokenize(query: string): readonly string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0);
  }

  /** One candidate's scoreable text, one entry per weighted field — see this file's header for why
 *  each weight is what it is. Split out of {@link scoreCandidate} so the field/weight pairing is a
 *  plain, independently-readable list rather than interleaved with the scoring loop itself. */
  function fieldHaystacks(candidate: AgentPluginSearchCandidate): readonly { readonly text: string; readonly weight: number }[] {
    return [
      { text: candidate.pluginId.toLowerCase(), weight: ID_FIELD_WEIGHT },
      { text: candidate.keywords.join(" ").toLowerCase(), weight: KEYWORD_FIELD_WEIGHT },
      { text: (candidate.description ?? "").toLowerCase(), weight: DESCRIPTION_FIELD_WEIGHT },
      {
        text: candidate.skills.map((skill) => `${skill.name} ${skill.summary}`).join(" ").toLowerCase(),
        weight: SKILL_FIELD_WEIGHT,
      },
    ];
  }

  /** Sums, over every query term and every weighted field, the field's weight whenever that field's
 *  text contains the term as a substring — the same `includes()` test `component-catalog-query.ts`
 *  uses, just per-field instead of one merged haystack. A term can score against more than one field
 *  (e.g. a keyword that is also echoed in the description) — that is intentional: a plugin whose
 *  author reinforced a concept in both its keywords and its prose is a genuinely stronger match, not
 *  a bug to dedupe away. */
  function scoreCandidate(candidate: AgentPluginSearchCandidate, terms: readonly string[]): number {
    const haystacks = fieldHaystacks(candidate);
    return terms.reduce(
      (total, term) => total + haystacks.reduce((fieldTotal, haystack) => (haystack.text.includes(term) ? fieldTotal + haystack.weight : fieldTotal), 0),
      0,
    );
  }

  /**
 * Ranks already-resolved installed-plugin candidates against a free-text query.
 *
 * @param query - Free-text search phrase. An empty or whitespace-only query has no terms to match
 * against and always returns no matches — this function never falls back to "return everything",
 * matching `search_components`' own "no query, no hits" behavior rather than the different (and
 * here wrong) choice of treating an empty query as "list all installed".
 * @param candidates - One workspace's installed plugins, already resolved (disk already read).
 * @param limit - Max matches to return, already clamped by the caller (mirrors
 * `component-catalog-tool.ts`'s handler, which owns the clamp so this function can stay a pure
 * "given these inputs, rank them" step with no knowledge of the tool's own schema bounds).
 * @returns Matches with score > 0, sorted by score descending, truncated to `limit`. A candidate
 * that scores 0 (no term matched anything) is dropped, not returned at the bottom — the caller's own
 * "N installed, 0 matched" framing is what tells the model the workspace is not empty even when a
 * query matches nothing.
 * @complexity See this file's header.
 */
  function rankInstalledAgentPlugins(
    query: string,
    candidates: readonly AgentPluginSearchCandidate[],
    limit: number,
  ): readonly AgentPluginSearchMatch[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    return candidates
      .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, terms) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(limit, 0));
  }

  return { rankInstalledAgentPlugins };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createSearchModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
