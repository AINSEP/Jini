/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */

import type { AgentPluginLifecyclePorts } from "./ports.js";

export interface AgentPluginSearchSkill {
  readonly name: string;
  readonly summary: string;
}

export interface AgentPluginSearchCandidate {
  readonly pluginId: string;
  readonly version?: (string) | undefined;
  readonly description?: (string) | undefined;
  readonly keywords: readonly string[];

  readonly enabled: boolean;
  readonly skills: readonly AgentPluginSearchSkill[];

  readonly mcpServerIds: readonly string[];
}

export interface AgentPluginSearchMatch extends AgentPluginSearchCandidate {
  readonly score: number;
}

function buildModule(ports: AgentPluginLifecyclePorts) {

  const ID_FIELD_WEIGHT = 5;
  const KEYWORD_FIELD_WEIGHT = 4;
  const DESCRIPTION_FIELD_WEIGHT = 2;
  const SKILL_FIELD_WEIGHT = 1;

  function tokenize(query: string): readonly string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0);
  }

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

  function scoreCandidate(candidate: AgentPluginSearchCandidate, terms: readonly string[]): number {
    const haystacks = fieldHaystacks(candidate);
    return terms.reduce(
      (total, term) => total + haystacks.reduce((fieldTotal, haystack) => (haystack.text.includes(term) ? fieldTotal + haystack.weight : fieldTotal), 0),
      0,
    );
  }

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
