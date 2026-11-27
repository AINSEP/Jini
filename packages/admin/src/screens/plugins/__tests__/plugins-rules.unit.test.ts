import { describe, expect, it, vi } from "vitest";
import type { AdminPluginProviderSettingField } from "../api/plugins-api.types.js";
import { createPluginRules, type PluginRulesDeps } from "../rules.js";

import type { AdminPluginDto } from "@jini-ai/core/contracts/site/cms-plugins";
import { FakeApiError, makeRules } from "./plugin-rules-fixture.js";

const {
  pluginRowFacts,
  buildPluginRemoveConfirmCopy,
  describeApiError,
  pluginRemoveAriaLabel,
  pluginSubline,
  pluginToggleControl,
} = makeRules("Acme");

/**
 * @file Direct, no-React coverage for `Plugins.tsx`'s pure `rules.ts` functions added or changed by
 * the Installed/Downloaded/Marketplace tab rebuild (2026-09-09) — the `.acme-plugin` runtime
 * family's own rules, independent of `agent-plugin-rules.unit.test.ts` (the sibling screen's
 * equivalent, for a different plugin family).
 *
 * `pluginToggleControl`'s AC-21 "invisible toggle" branch (an invalid+disabled plugin gets no
 * enable-capable control) is exercised here by DIRECT invocation rather than through
 * `Plugins.unit.test.tsx`'s rendered UI: since Installed now pre-filters to `plugin.enabled ===
 * true`, that branch's precondition (`!(plugin.enabled || plugin.status === "valid")`) can never be
 * true for any row the Installed tab actually renders — `plugin.enabled` alone already satisfies
 * the OR. Per this workspace's "unreachable branch: delete vs. direct-invoke test" convention, the
 * function keeps its full contract (any future caller can still hit this precondition) and this
 * test proves the branch still behaves correctly, without pretending the current UI can reach it.
 */

function makePlugin(overrides: Partial<AdminPluginDto> = {}): AdminPluginDto {
  return {
    id: "p1",
    name: "Word Count",
    version: "1.0.0",
    source: "site",
    tier: "tier-3",
    status: "valid",
    enabled: false,
    quarantine: null,
    errors: [],
    conflicts: [],
    ...overrides,
  };
}

describe("pluginSubline", () => {
  it("joins source · tier · status verbatim, untranslated", () => {
    expect(pluginSubline(makePlugin({ source: "built-in", tier: "tier-1", status: "invalid" }))).toBe("built-in · tier-1 · invalid");
  });
});

describe("pluginToggleControl — AC-21 direct invocation (unreachable via Installed-tab-only rendering)", () => {
  it("an invalid, disabled plugin offers no enable-capable control (visible: false)", () => {
    const control = pluginToggleControl({ plugin: makePlugin({ status: "invalid", enabled: false }), rowSavingId: null, locale: "en" });
    expect(control).toEqual({ visible: false, disabled: false, label: "" });
  });

  it("an enabled plugin always stays visible regardless of status — the only case Installed can ever render", () => {
    const control = pluginToggleControl({ plugin: makePlugin({ status: "invalid", enabled: true }), rowSavingId: null, locale: "en" });
    expect(control.visible).toBe(true);
    expect(control.label).toBe("Disable");
  });

  it("a valid, disabled plugin is visible with an Enable label", () => {
    const control = pluginToggleControl({ plugin: makePlugin({ status: "valid", enabled: false }), rowSavingId: null, locale: "en" });
    expect(control).toEqual({ visible: true, disabled: false, label: "Enable" });
  });
});

describe("pluginRemoveAriaLabel", () => {
  it("names the plugin for a site plugin", () => {
    expect(pluginRemoveAriaLabel({ plugin: makePlugin({ source: "site", name: "Valid Site Plugin" }), locale: "en" })).toBe("Remove Valid Site Plugin");
  });

  it("says unavailable for a built-in plugin", () => {
    expect(pluginRemoveAriaLabel({ plugin: makePlugin({ source: "built-in", name: "Word Count" }), locale: "en" })).toBe("Remove Word Count — unavailable");
  });
});

describe("buildPluginRemoveConfirmCopy", () => {
  it("names the exact plugin and explains the shared, restorable removal", () => {
    const copy = buildPluginRemoveConfirmCopy({ name: "Valid Site Plugin" });
    expect(copy.title).toBe('Move "Valid Site Plugin" to trash?');
    expect(copy.body).toMatch(/all workspaces on this site/);
    expect(copy.body).toMatch(/restore it from the Trash for 60 days/);
  });
});

describe("describeApiError — PLUGIN_UNINSTALL's four codes", () => {
  it("maps PLUGIN_NOT_UNINSTALLABLE to a built-in-specific message", () => {
    expect(describeApiError({ e: new FakeApiError("x", "PLUGIN_NOT_UNINSTALLABLE"), fallback: "fallback" })).toBe(
      "This plugin ships with Acme and cannot be removed.",
    );
  });

  it("maps PLUGIN_ENABLED to the disable-first guidance", () => {
    expect(describeApiError({ e: new FakeApiError("x", "PLUGIN_ENABLED"), fallback: "fallback" })).toBe(
      "This plugin is enabled and must be disabled everywhere before it can be removed.",
    );
  });

  it("maps PLUGIN_IN_TRASH to restore-or-delete guidance", () => {
    expect(describeApiError({ e: new FakeApiError("x", "PLUGIN_IN_TRASH"), fallback: "fallback" })).toBe(
      "This plugin is already in the Trash. Restore or delete it there first.",
    );
  });

  it("maps PLUGIN_ID_INVALID", () => {
    expect(describeApiError({ e: new FakeApiError("x", "PLUGIN_ID_INVALID"), fallback: "fallback" })).toBe("This plugin's id is invalid.");
  });

  it("still maps PLUGIN_NOT_FOUND — shared verbatim with PLUGIN_SET_ENABLED's own error envelope", () => {
    expect(describeApiError({ e: new FakeApiError("x", "PLUGIN_NOT_FOUND"), fallback: "fallback" })).toBe("No plugin with that id is installed.");
  });

  it("falls back to the shared default for a non-Error, non-ApiError rejection", () => {
    expect(describeApiError({ e: "not an Error instance", fallback: "fallback text" })).toBe("fallback text");
  });

  it("surfaces a plain Error's own message unchanged (the shared default's behavior, not overridden here)", () => {
    expect(describeApiError({ e: new Error("network down"), fallback: "fallback text" })).toBe("network down");
  });
});

describe("describeApiError — characterization of every remaining branch", () => {
  it("maps PLUGIN_SET_ENABLED's PLUGIN_INVALID and PLUGIN_INCOMPATIBLE", () => {
    expect(describeApiError({ e: new FakeApiError("x", "PLUGIN_INVALID"), fallback: "fallback" })).toBe("This plugin failed validation and cannot be enabled.");
    expect(describeApiError({ e: new FakeApiError("x", "PLUGIN_INCOMPATIBLE"), fallback: "fallback" })).toBe("This plugin requires a different SDK version.");
  });

  it("an ApiError with an unmapped code, or no code, surfaces the server's own message", () => {
    expect(describeApiError({ e: new FakeApiError("server says no", "INTERNAL"), fallback: "fallback" })).toBe("server says no");
    expect(describeApiError({ e: new FakeApiError("server says no"), fallback: "fallback" })).toBe("server says no");
  });

  it("an ApiError with an unmapped code and an empty message uses the fallback", () => {
    expect(describeApiError({ e: new FakeApiError("", "INTERNAL"), fallback: "fallback" })).toBe("fallback");
  });

  it("a code that names an Object.prototype member is not treated as a mapped code", () => {
    expect(describeApiError({ e: new FakeApiError("server says no", "toString"), fallback: "fallback" })).toBe("server says no");
    expect(describeApiError({ e: new FakeApiError("server says no", "constructor"), fallback: "fallback" })).toBe("server says no");
  });
});

describe("pluginRowFacts (PL-2, 2026-10-06): the detail panel's always-present facts", () => {
  const identity = (key: string) => key;
  it("spells out a site tier-2 plugin that is off and incompatible", () => {
    const facts = pluginRowFacts({ plugin: makePlugin({ id: "x", source: "site", tier: "tier-2", status: "incompatible", enabled: false }), translate: identity });
    expect(facts).toEqual([
      { label: "ID", value: "x" },
      { label: "Source", value: "Installed on this site" },
      { label: "Access", value: "This plugin runs code in a separate worker, limited to the capabilities it declares." },
      { label: "Status", value: "Not compatible with this version of Acme" },
      { label: "State", value: "Off in this workspace" },
    ]);
  });

  it("uses the no-code sentence for tier-1 and points an invalid plugin at its errors", () => {
    const facts = pluginRowFacts({ plugin: makePlugin({ tier: "tier-1", status: "invalid" }), translate: identity });
    expect(facts[2]?.value).toBe("This plugin has no code; nothing in it runs on this computer. Turning it on only adds what it declares.");
    expect(facts[3]?.value).toBe("Invalid — see the errors below");
  });
});

describe("plugin row details and reviewed package trust", () => {
  const rules = makeRules();
  const translate = (key: string) => key;
  const peer = { kind: "tool", key: "export $&", heldBy: "audit", heldByName: "Audit $&", heldKey: "export $&" };
  const reserved = { kind: "route", key: "/api/report", heldBy: "core", heldByName: "Core", heldKey: "/api/*" };
  const exact = { kind: "new-kind", key: "title", heldBy: "core", heldByName: "Core", heldKey: "title" };

  it("explains exact and wildcard reservations and deduplicates peer conflicts", () => {
    const errors = [{ code: "INVALID", file: "plugin.json", message: "Missing name" }];
    expect(rules.pluginRowDetailView({ plugin: makePlugin({ conflicts: [peer, reserved, peer, exact], errors }), translate })).toEqual({
      quarantine: null, errors,
      conflicts: { heading: "Names already in use — turn the other plugin off first:", lines: [
        'Tool "export $&" is already used by Audit $&.',
        'Route "/api/report" is reserved by Acme ("/api/*").',
        'new-kind "title" is reserved by Acme.',
      ] },
    });
  });

  it("keeps healthy details empty and distinguishes boot quarantine from repeated failures", () => {
    expect(rules.pluginConflictLines({ plugin: {}, translate })).toEqual([]);
    expect(rules.pluginRowDetailView({ plugin: makePlugin(), translate })).toBeNull();
    const view = (consecutiveFailures: number) => rules.pluginRowDetailView({
      plugin: makePlugin({ quarantine: { at: "2026-10-03", reason: "Conflicting claim", consecutiveFailures } }), translate,
    });
    expect(view(0)).toEqual({ quarantine: { headline: "Turned off automatically", reason: "Conflicting claim" }, conflicts: null, errors: [] });
    expect(view(3)).toEqual({ quarantine: { headline: "Quarantined after 3 consecutive failures", reason: "Conflicting claim" }, conflicts: null, errors: [] });
  });

  it("shows the upgrade and full-access warning only for the reviewed coded package", () => {
    const manifest = { id: "count", name: "Word Count", version: "2.5", tier: "tier-1", digest: "d2",
      capabilities: [], hooks: [], contentTypes: [], conflicts: [], hasCode: false };
    expect(rules.pluginInstallPreviewDisplay({ preview: manifest, translate })).toEqual({
      title: "Word Count (count)", version: "2.5", tier: "tier-1", capabilities: "—", hooks: "—", contentTypes: "—",
      codeNotice: "This plugin has no code; nothing in it runs on this computer. Turning it on only adds what it declares.", conflicts: null,
    });
    const coded = { ...manifest, tier: "tier-3", hasCode: true, upgradeFrom: "1.8", capabilities: ["files", "content"],
      hooks: ["publish", "delete"], contentTypes: ["report", "section"], conflicts: [peer] };
    expect(rules.pluginInstallPreviewDisplay({ preview: coded, translate })).toEqual({
      title: "Word Count (count)", version: "1.8 → 2.5", tier: "tier-3", capabilities: "files, content", hooks: "publish, delete",
      contentTypes: "report, section", codeNotice: "This plugin runs code with full access to this computer and every site on it.",
      conflicts: { heading: "Already in use in this workspace (other workspaces are checked when you turn it on there):",
        lines: ['Tool "export $&" is already used by Audit $&.'] },
    });
  });
});

describe("package file presentation", () => {
  const rules = makeRules();
  const translate = (key: string) => key;
  const file = { relativePath: "file.md", sizeBytes: 12, content: null, omitted: null };

  it("retains an omitted row with the reason instead of showing its bytes", () => {
    const cases = [
      ["binary", "Binary file — not shown."],
      ["too-large", "Too large to show here."],
      ["symlink", "Symbolic link — not followed."],
      ["unreadable", "This file could not be read."],
    ] as const;
    for (const [omitted, unavailableReason] of cases) {
      expect(rules.toPackageFileView({ file: { ...file, omitted, content: "Do not show" }, translate }))
        .toEqual({ relativePath: "file.md", content: null, unavailableReason });
    }
    expect(rules.toPackageFileView({ file, translate })).toEqual({
      relativePath: "file.md", content: null, unavailableReason: "This file could not be read.",
    });
  });

  it("distinguishes loading, refusal, and a successfully read empty package", () => {
    const view = (read: ReturnType<typeof rules.packageFilesRead>) => rules.packageFilesViewState({ read, selectedPath: "", translate });
    expect(view(rules.packageFilesRead({}))).toEqual({
      files: [], selectedFile: null, status: { role: "status", text: "Loading package files…" }, listNotice: null,
    });
    expect(view(rules.packageFilesRead({ error: new Error("Manifest access denied") }))).toEqual({
      files: [], selectedFile: null, status: { role: "alert", text: "Manifest access denied" }, listNotice: null,
    });
    expect(view(rules.packageFilesRead({ data: { files: [], truncated: false }, error: new Error("Old error") }))).toEqual({
      files: [], selectedFile: null, status: { role: "status", text: "No files to show for this plugin." }, listNotice: null,
    });
  });

  it("selects the first displayed file rather than the first server entry", () => {
    const read = rules.packageFilesRead({ data: { truncated: true, files: [
      { ...file, relativePath: "docs/guide.md", content: "Guide" },
      { ...file, relativePath: "file10.md", content: "Ten" },
      { ...file, relativePath: "file2.md", content: "" },
    ] } });
    const preferred = rules.packageFilesViewState({ read, selectedPath: "docs/guide.md", translate });
    expect(preferred.selectedFile).toEqual({ relativePath: "docs/guide.md", content: "Guide" });
    const fallback = rules.packageFilesViewState({ read, selectedPath: "missing.md", translate });
    expect(fallback.selectedFile).toEqual({ relativePath: "file2.md", content: "" });
    expect(fallback.status).toBeNull();
    expect(fallback.listNotice).toBe("Some files are not listed: this package is larger than the viewer's limits.");
  });
});

it("keeps a saved secret write-only while honoring the host validation when an alternative is edited", () => {
  const field: AdminPluginProviderSettingField = { name: "token", label: "Token", required: true, saved: false, secret: true,
    requiredUnless: { field: "mode", equals: "none", orPresent: "headers", headerNames: ["Authorization"] } };
  const headers: AdminPluginProviderSettingField = { name: "headers", label: "Headers", required: false, saved: true, secret: true };
  const isProviderSettingRequired = vi.fn<PluginRulesDeps["isProviderSettingRequired"]>(({ values }) => values["mode"] === "authenticated");
  const rules = createPluginRules({ productName: "Acme", translate: ({ key }) => key, isProviderSettingRequired,
    isApiError: (e): e is Error & { code?: string } => e instanceof FakeApiError, describeApiError: ({ fallback }) => fallback,
  });
  const values = { mode: "authenticated", headers: "saved" };
  const input = { field, fields: [field, headers], entered: { headers: "  " }, values };
  expect(rules.providerSettingRequiredHere(input)).toBe(false);
  expect(isProviderSettingRequired).not.toHaveBeenCalled();
  expect(rules.providerSettingRequiredHere({ ...input, entered: { headers: "X-Trace: changed" } })).toBe(true);
  expect(isProviderSettingRequired).toHaveBeenCalledExactlyOnceWith({ field, values });
  expect(rules.providerSettingRequiredHere({ ...input, fields: [field] })).toBe(true);
  expect(rules.providerSettingRequiredHere({ ...input, fields: [field], values: { mode: "none" } })).toBe(false);
  expect(rules.providerSettingRequiredHere({ ...input, fields: [field, { ...headers, saved: false }] })).toBe(true);
  expect(rules.providerSettingRequiredHere({ ...input, fields: [field, { ...headers, secret: false }] })).toBe(true);
});

it("retains the first readable row when a malformed path cannot appear in the tree", () => {
  const value = { relativePath: "/", content: "Recoverable content" };
  const { selectPackageFile } = makeRules();
  expect(selectPackageFile({ files: [value], selectedPath: "missing.md" })).toBe(value);
});
