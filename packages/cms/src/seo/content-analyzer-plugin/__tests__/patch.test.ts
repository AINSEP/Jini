import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { DefinedPlugin } from "@jini-ai/core/contracts/plugin-sdk";

import * as analysis from "../../content-analysis/index.js";
import { buildContentAnalyzerPatch, createContentAnalyzerPlugin } from "../plugin.js";

type Filter = (entry: unknown, ctx: { workspaceId: string; pluginId: string }) => unknown;

/** Runs the plugin's `setup()` against a recording SDK and returns the single registered filter. */
function registerFilter({ beforeSaveHook }: { beforeSaveHook: string }): { hook: string; filter: Filter } {
  const definePlugin = (definition: DefinedPlugin["definition"]): DefinedPlugin => ({ definition });
  const plugin = createContentAnalyzerPlugin({ definePlugin, beforeSaveHook });
  const seen: { hook: string; filter: Filter }[] = [];
  void plugin.definition.setup({ addFilter: (hook: string, filter: Filter) => { seen.push({ hook, filter }); } } as never);
  expect(seen).toHaveLength(1);
  return seen[0]!;
}

it("registers its filter on the host-injected before-save hook, never a built-in name", () => {
  expect(registerFilter({ beforeSaveHook: "injected.before-save" }).hook).toBe("injected.before-save");
  expect(registerFilter({ beforeSaveHook: "other.hook" }).hook).toBe("other.hook");
});

it("absent description and renderer-style anchors preserve the six-field patch", async () => {
  const { filter } = registerFilter({ beforeSaveHook: "injected.before-save" });
  const draft = { workspaceId: "w", title: "A title that is long enough to pass the check", ext: {}, bodyJson: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Café Münster" }] }] } };
  const patch = await filter(draft, { workspaceId: "w", pluginId: "analyzer" }) as Record<string, unknown>;
  expect(JSON.stringify(patch)).toBe(JSON.stringify(buildContentAnalyzerPatch({ entry: draft, analysis })));
  expect(Object.keys(patch)).toEqual(["score", "wordCount", "readingTimeMinutes", "readability", "summary", "report"]);
  const report = JSON.parse(String(patch.report));
  expect(report.toc).toEqual([{ level: 2, text: "Café Münster", anchor: "cafe-muenster" }]);
  expect(report.checks.find((c: { id: string }) => c.id === "meta-description-length")?.status).toBe("skip");
});

it("a draft without a string title scores as untitled instead of throwing", async () => {
  const { filter } = registerFilter({ beforeSaveHook: "h" });
  const patch = await filter({ workspaceId: "w", ext: {}, bodyJson: null }, { workspaceId: "w", pluginId: "analyzer" }) as Record<string, unknown>;
  expect(Object.keys(patch)).toHaveLength(6);
});

it("built output imports no plugin SDK module: the host binds definePlugin and the hook", () => {
  const output = readFileSync(new URL("../../../../dist/seo/content-analyzer-plugin/plugin.js", import.meta.url), "utf8");
  const specifiers = Array.from(output.matchAll(/from\s+["']([^"']+)["']/g), match => match[1]);
  expect(specifiers).toEqual(["@jini-ai/cms/seo/content-analysis"]);
});

it("scores an authored description instead of reporting the length check skipped", async () => {
  const { filter } = registerFilter({ beforeSaveHook: "site.before-save" });
  const patch = await filter({
    workspaceId: "w", ext: {}, title: "How to prepare a safe and tidy workbench", bodyJson: null,
    metaDescription: "Short",
  }, { workspaceId: "w", pluginId: "analyzer" }) as Record<string, unknown>;
  const report = JSON.parse(String(patch.report));
  expect(report.checks.find((check: { id: string }) => check.id === "meta-description-length")).toEqual({
    id: "meta-description-length", status: "warn", params: { length: 5, min: 50, max: 160 },
  });
  expect(patch.summary).toEqual(expect.stringContaining("The meta description is 5 characters; aim for 50-160."));
});
