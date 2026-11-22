import assert from "node:assert/strict";
import { test } from "vitest";

import type { PluginInstallPreview } from "../../host/node/index.js";

import { PLUGIN_INSTALL_STAYS_OFF, pluginInstallConsent, pluginInstallRiskSentence } from "../install-consent.js";

/** The trust disclosure a human (CLI prompt) or the assistant (`plugins_install` warning) reads
 *  before a site plugin is installed: identity, tier, capabilities, hooks, warnings, the upgrade it
 *  replaces, what it does to this computer, and that it stays off. */

function preview(overrides: Partial<PluginInstallPreview> = {}): PluginInstallPreview {
  return {
    id: "word-count",
    name: "Word Count",
    version: "1.2.0",
    tier: "tier-2",
    capabilities: ["content.read", "widgets"],
    hooks: ["entry.saved"],
    hasCode: true,
    digest: "d".repeat(64),
    contentTypes: [],
    conflicts: [],
    ...overrides,
  };
}

test("a package that ships code is disclosed as running with full access", () => {
  assert.equal(pluginInstallRiskSentence({ preview: preview() }), "This plugin runs code with full access to this computer and every site on it.");
});

test("a code-free package says so, and names the content types it adds when there are any", () => {
  assert.equal(pluginInstallRiskSentence({ preview: preview({ hasCode: false }) }), "This plugin contains no code.");
  assert.equal(
    pluginInstallRiskSentence({ preview: preview({ hasCode: false, contentTypes: ["recipe", "review"] }) }, {}),
    "This plugin contains no code. It adds content types: recipe, review.",
  );
});

test("the full consent lists every disclosure line in order, ending with stays-off and a blank line", () => {
  const text = pluginInstallConsent({ preview: preview({ warnings: ["Declares an outbound host."], upgradeFrom: "1.1.0" }) });
  assert.deepEqual(text.split("\n"), [
    "Word Count (word-count) 1.2.0",
    "Trust: tier-2 (local / unverified publisher)",
    "Capabilities: content.read, widgets",
    "Hooks: entry.saved",
    "Declares an outbound host.",
    "Replaces installed version 1.1.0.",
    "This plugin runs code with full access to this computer and every site on it.",
    PLUGIN_INSTALL_STAYS_OFF,
    "",
  ]);
});

test("empty capabilities and hooks render as a dash; no warnings or upgrade adds no lines", () => {
  const text = pluginInstallConsent({ preview: preview({ capabilities: [], hooks: [], hasCode: false, tier: "tier-1" }) }, {});
  assert.deepEqual(text.split("\n"), [
    "Word Count (word-count) 1.2.0",
    "Trust: tier-1 (local / unverified publisher)",
    "Capabilities: —",
    "Hooks: —",
    "This plugin contains no code.",
    "It stays off in every workspace until you turn it on.",
    "",
  ]);
});
