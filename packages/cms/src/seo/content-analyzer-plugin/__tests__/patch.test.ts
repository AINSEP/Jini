import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

it("absent description and renderer-style anchors preserve the six-field patch", () => {
  const entry = new URL("../../../../dist/seo/content-analyzer-plugin/plugin.js", import.meta.url);
  const resolver = new URL("../../../../../plugins/dist/runtime/sdk-resolver.js", import.meta.url);
  const fixture = new URL("./fixtures/sdk.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { registerPluginSdkResolver } from ${JSON.stringify(resolver.href)};
    registerPluginSdkResolver({ sdkModulePath: ${JSON.stringify(fileURLToPath(fixture))}, sdkSpecifiers: ["@jini-ai/plugin-sdk"] });
    const { default: plugin, buildContentAnalyzerPatch } = await import(${JSON.stringify(entry.href)});
    const analysis = await import("@jini-ai/cms/seo/content-analysis");
    let hook, filter;
    plugin.definition.setup({ addFilter(name, callback) { if (filter) throw new Error("duplicate filter"); hook = name; filter = callback; } });
    const draft = { workspaceId: "w", title: "A title that is long enough to pass the check", ext: {}, bodyJson: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Café Münster" }] }] } };
    const patch = await filter(draft, { workspaceId: "w", pluginId: "analyzer" });
    const direct = buildContentAnalyzerPatch({ entry: draft, analysis });
    console.log(JSON.stringify({ hook, patch, same: JSON.stringify(patch) === JSON.stringify(direct) }));
  `], { cwd: fileURLToPath(new URL("../../../..", import.meta.url)), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const resultValue = JSON.parse(result.stdout);
  expect(resultValue.hook).toBe("injected.before-save");
  expect(resultValue.same).toBe(true);
  expect(Object.keys(resultValue.patch)).toEqual(["score", "wordCount", "readingTimeMinutes", "readability", "summary", "report"]);
  const report = JSON.parse(resultValue.patch.report);
  expect(report.toc).toEqual([{ level: 2, text: "Café Münster", anchor: "cafe-muenster" }]);
  expect(report.checks.find((c: { id: string }) => c.id === "meta-description-length")?.status).toBe("skip");
});
it("built worker output contains exactly the two approved bare specifiers", () => {
  const output = readFileSync(new URL("../../../../dist/seo/content-analyzer-plugin/plugin.js", import.meta.url), "utf8");
  const specifiers = Array.from(output.matchAll(/from\s+["']([^"']+)["']/g), match => match[1]);
  expect(specifiers).toEqual(["@jini-ai/plugin-sdk", "@jini-ai/cms/seo/content-analysis"]);
});
