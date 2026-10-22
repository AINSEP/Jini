import assert from "node:assert/strict";
import { test } from "../legacy-test.js";

import { rankInstalledAgentPlugins } from "../test-support.js";
import { type AgentPluginSearchCandidate } from "../../search.js";

/**
 * @file `rankInstalledAgentPlugins()` — pure field-weighted relevance ranking, no I/O. See
 * `search.ts`'s own header for the field-weight rationale this file proves out.
 */

function candidate(overrides: Partial<AgentPluginSearchCandidate> = {}): AgentPluginSearchCandidate {
  return {
    pluginId: "site-compliance",
    version: "1.0.0",
    description:
      "Evidence-based privacy, cookie/consent, and accessibility risk screening for a the host site.",
    keywords: ["compliance", "privacy", "gdpr", "ccpa", "cpra", "cookie", "consent", "wcag", "accessibility"],
    enabled: true,
    skills: [{ name: "site-compliance", summary: "Evidence-based privacy and accessibility risk screening." }],
    mcpServerIds: [],
    ...overrides,
  };
}

const UI_UX_DESIGN = candidate({
  pluginId: "ui-ux-design",
  version: undefined,
  description: "UI/UX design, interface-design-system, accessibility, and shadcn/ui component skills bundled as one portable Agent Plugin.",
  keywords: [], // the real bundled fixture ships none — see search.ts's own header
  enabled: false,
  skills: [
    { name: "ui-ux-design", summary: "Use when creating frontend design systems and visual direction." },
    { name: "shadcn-ui", summary: "Expert guidance for integrating and building applications with shadcn/ui components." },
  ],
});

test("an empty query returns no matches, even against real candidates — never 'list everything'", () => {
  assert.deepEqual(rankInstalledAgentPlugins("", [candidate(), UI_UX_DESIGN], 10), []);
  assert.deepEqual(rankInstalledAgentPlugins("   ", [candidate(), UI_UX_DESIGN], 10), []);
});

test("no candidates always returns no matches, regardless of query", () => {
  assert.deepEqual(rankInstalledAgentPlugins("compliance", [], 10), []);
});

test("a query matching nothing in any field returns no matches, not the full candidate list", () => {
  assert.deepEqual(rankInstalledAgentPlugins("zzz-nonexistent-term-zzz", [candidate(), UI_UX_DESIGN], 10), []);
});

test("an exact keyword match scores, even when the term appears nowhere else", () => {
  const matches = rankInstalledAgentPlugins("gdpr", [candidate(), UI_UX_DESIGN], 10);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.pluginId, "site-compliance");
  assert.ok(matches[0]!.score > 0);
});

test("a plugin id substring match scores even with no keywords and no description hit", () => {
  const matches = rankInstalledAgentPlugins("compliance", [candidate(), UI_UX_DESIGN], 10);
  // "compliance" matches site-compliance's id AND its keywords AND its description — must still be
  // exactly one match for that one candidate, not double-counted into two rows.
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.pluginId, "site-compliance");
});

test("a plugin with NO keywords at all (the real ui-ux-design shape) is still findable via id/description/skills", () => {
  const matches = rankInstalledAgentPlugins("shadcn", [candidate(), UI_UX_DESIGN], 10);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.pluginId, "ui-ux-design", "must be found via its shadcn-ui skill's own summary, despite zero keywords");
});

test("an id/keyword match outranks a same-term match that only appears in a skill summary", () => {
  const idMatch = candidate({ pluginId: "gdpr-helper", keywords: [], description: undefined, skills: [] });
  const skillOnlyMatch = candidate({
    pluginId: "unrelated-tool",
    keywords: [],
    description: undefined,
    skills: [{ name: "misc", summary: "mentions gdpr once, deep in a skill summary" }],
  });
  const matches = rankInstalledAgentPlugins("gdpr", [skillOnlyMatch, idMatch], 10);
  assert.equal(matches.length, 2);
  assert.equal(matches[0]?.pluginId, "gdpr-helper", "an id hit must outrank a skill-summary-only hit");
  assert.ok((matches[0]?.score ?? 0) > (matches[1]?.score ?? 0));
});

test("a multi-word query scores cumulatively across terms, not just the first term matched", () => {
  const single = rankInstalledAgentPlugins("gdpr", [candidate()], 10)[0]?.score ?? 0;
  const multi = rankInstalledAgentPlugins("gdpr cookie consent", [candidate()], 10)[0]?.score ?? 0;
  assert.ok(multi > single, "matching three terms must score higher than matching one");
});

test("results are sorted by score descending", () => {
  const strongMatch = candidate({ pluginId: "gdpr-tool", keywords: ["gdpr"] });
  const weakMatch = candidate({ pluginId: "other-tool", keywords: [], description: "mentions gdpr once", skills: [] });
  const matches = rankInstalledAgentPlugins("gdpr", [weakMatch, strongMatch], 10);
  assert.deepEqual(
    matches.map((m) => m.pluginId),
    ["gdpr-tool", "other-tool"],
  );
});

test("limit truncates the result set to the requested size", () => {
  const many = Array.from({ length: 5 }, (_, i) => candidate({ pluginId: `gdpr-tool-${i}`, keywords: ["gdpr"] }));
  const matches = rankInstalledAgentPlugins("gdpr", many, 2);
  assert.equal(matches.length, 2);
});

test("a disabled plugin still ranks and is returned — search is not gated on activation", () => {
  const matches = rankInstalledAgentPlugins("shadcn", [UI_UX_DESIGN], 10);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.enabled, false);
});

test("every field of the source candidate is carried through onto the match, plus a score", () => {
  const [match] = rankInstalledAgentPlugins("gdpr", [candidate()], 10);
  assert.ok(match);
  assert.equal(match.pluginId, "site-compliance");
  assert.equal(match.version, "1.0.0");
  assert.equal(match.enabled, true);
  assert.deepEqual(match.mcpServerIds, []);
  assert.equal(typeof match.score, "number");
});

test("a candidate with no description and no mcp servers does not throw — every optional field is genuinely optional", () => {
  const bare: AgentPluginSearchCandidate = {
    pluginId: "bare-plugin",
    keywords: [],
    enabled: true,
    skills: [],
    mcpServerIds: [],
  };
  assert.deepEqual(rankInstalledAgentPlugins("bare", [bare], 10).map((m) => m.pluginId), ["bare-plugin"]);
  assert.deepEqual(rankInstalledAgentPlugins("anything-else", [bare], 10), []);
});
