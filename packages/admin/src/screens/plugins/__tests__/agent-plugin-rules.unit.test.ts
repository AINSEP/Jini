import { describe, expect, it } from "vitest";

import { FakeApiError, makeRules } from "./plugin-rules-fixture.js";

const { agentPluginDisplayName, agentPluginGlyphKind, agentPluginToggleAriaLabel, buildAgentPluginDisableConfirmCopy, humanizeAgentPluginId } = makeRules("Acme");

/**
 * @file The Agent Plugins row's two pure derivations — which glyph identifies a package, and how
 * its id becomes a display name. Both are `rules.ts` functions with no React, so they are tested
 * directly rather than through a render (`posts/rules.ts` convention).
 *
 * These exist because the redesign asked for per-plugin icons "so each row is identifiable at a
 * glance". That is only true if two different packages get two different glyphs — which is the one
 * property a render test would happily pass while failing, since it would see two icons either way.
 */

/** Only the three fields `agentPluginGlyphKind` reads. */
function pkg(pluginId: string, keywords: string[] = [], skills: string[] = []) {
  return { pluginId, keywords, skills: skills.map((name) => ({ name })) };
}

describe("agentPluginGlyphKind", () => {
  it("gives the three really-installed packages three DIFFERENT glyphs", () => {
    // The real installed set, with the fields `AGENT_PLUGINS_LIST` actually reports for each
    // (verified against the live route, 2026-09-09). Asserted as a set, not one at a time: the
    // requirement is that they can be told apart, and three identical-but-correct-looking glyphs
    // would satisfy three separate equality assertions.
    const kinds = [
      agentPluginGlyphKind(pkg("site-compliance", ["compliance", "privacy", "gdpr", "accessibility", "wcag"], ["site-compliance"])),
      agentPluginGlyphKind(pkg("acme-deploy-example", ["deploy", "example-host.io", "hosting"], ["acme-deploy-example"])),
      agentPluginGlyphKind(pkg("ui-ux-design", [], ["frontend-accessibility", "interface-design", "shadcn-ui", "ui-ux-design"])),
    ];

    expect(kinds).toEqual(["compliance", "deploy", "design"]);
    expect(new Set(kinds).size).toBe(3);
  });

  it("prefers the package's own id over a skill it merely bundles", () => {
    // The regression this tiering exists for: `ui-ux-design` bundles a `frontend-accessibility`
    // skill, and a flat one-bag match classified it as a COMPLIANCE package — the same shield as
    // `site-compliance`, on the two rows the list most needs to tell apart.
    expect(agentPluginGlyphKind(pkg("ui-ux-design", [], ["frontend-accessibility"]))).toBe("design");
    // ...and the tier below the id still works when the id itself says nothing.
    expect(agentPluginGlyphKind(pkg("acme-toolkit", ["accessibility"], []))).toBe("compliance");
    expect(agentPluginGlyphKind(pkg("acme-toolkit", [], ["frontend-accessibility"]))).toBe("compliance");
  });

  it("falls back to the generic package glyph rather than guessing a category", () => {
    expect(agentPluginGlyphKind(pkg("acme-widget", ["widgets", "things"], ["do-stuff"]))).toBe("package");
    expect(agentPluginGlyphKind(pkg("x", [], []))).toBe("package");
  });

  it("matches whole words only, so an id that merely contains a keyword is not miscategorised", () => {
    // "guide" contains "ui"; "shipping" contains "ship"; neither is a design or deploy package.
    expect(agentPluginGlyphKind(pkg("style-guide", [], []))).toBe("package");
    expect(agentPluginGlyphKind(pkg("shipping-labels", [], []))).toBe("package");
  });
});

describe("humanizeAgentPluginId", () => {
  it("title-cases word segments", () => {
    expect(humanizeAgentPluginId({ pluginId: "site-compliance" })).toBe("Site Compliance");
  });

  it("uppercases acronym segments instead of title-casing them", () => {
    // Rendered as "Ui Ux Design" before this, on the one screen whose job is recognizing a package
    // at a glance.
    expect(humanizeAgentPluginId({ pluginId: "ui-ux-design" })).toBe("UI UX Design");
    expect(humanizeAgentPluginId({ pluginId: "mcp-bridge" })).toBe("MCP Bridge");
    expect(humanizeAgentPluginId({ pluginId: "seo-api-tools" })).toBe("SEO API Tools");
  });

  it("does not uppercase a word that merely starts with an acronym's letters", () => {
    expect(humanizeAgentPluginId({ pluginId: "uid-generator" })).toBe("Uid Generator");
    expect(humanizeAgentPluginId({ pluginId: "apiary-sync" })).toBe("Apiary Sync");
  });

  it("names no plugin by hand: every id takes the generic transform", () => {
    expect(humanizeAgentPluginId({ pluginId: "acme-deploy-example" })).toBe("Acme Deploy Example");
  });
});

describe("agentPluginDisplayName", () => {
  it("prefers the package's own display name over the id", () => {
    expect(agentPluginDisplayName({ pluginId: "deploy", displayName: "Deploy Online" })).toBe("Deploy Online");
  });

  it("falls back to the title-cased id when the name is absent, null or blank", () => {
    expect(agentPluginDisplayName({ pluginId: "ui-ux-design" })).toBe("UI UX Design");
    expect(agentPluginDisplayName({ pluginId: "deploy", displayName: null })).toBe("Deploy");
    expect(agentPluginDisplayName({ pluginId: "deploy", displayName: "   " })).toBe("Deploy");
  });
});

describe("agentPluginToggleAriaLabel", () => {
  it("names the target action and the plugin, so two rows' switches are distinguishable", () => {
    expect(agentPluginToggleAriaLabel({ plugin: { pluginId: "site-compliance", enabled: true }, locale: "en" })).toBe("Disable Site Compliance");
    expect(agentPluginToggleAriaLabel({ plugin: { pluginId: "acme-deploy-example", enabled: false }, locale: "en" })).toBe("Enable Acme Deploy Example");
  });

  it("hands the locale to the injected translator, which picks the verb", () => {
    const spanish = makeRules("Acme", ({ locale, key }) => (locale === "es" && key === "Disable" ? "Desactivar" : key));
    expect(spanish.agentPluginToggleAriaLabel({ plugin: { pluginId: "site-compliance", enabled: true }, locale: "es" })).toBe("Desactivar Site Compliance");
  });

  it("names the plugin by its display name when it has one", () => {
    expect(agentPluginToggleAriaLabel({ plugin: { pluginId: "deploy", enabled: false, displayName: "Deploy Online" }, locale: "en" })).toBe("Enable Deploy Online");
  });
});

describe("buildAgentPluginDisableConfirmCopy without a translator", () => {
  it("renders the English disable copy, naming the plugin and the bundled-package fact", () => {
    const copy = buildAgentPluginDisableConfirmCopy({ name: "Writer", variant: "disable" });
    expect(copy.title).toBe("Disable Writer for this site?");
    expect(copy.body).toBe(
      "Its skills stop reaching the assistant on the next run. The package stays on disk and can be enabled again. This package ships with Acme — it can't be deleted outright, only turned off.",
    );
  });

  it("renders the English remove (turn off) copy", () => {
    const copy = buildAgentPluginDisableConfirmCopy({ name: "Writer", variant: "remove" });
    expect(copy.title).toBe("Turn off Writer?");
    expect(copy.body).toContain("It stays right here on Downloaded and can be enabled again any time.");
  });
});
