// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { usePluginPackageFiles } from "../hooks/use-plugin-package-files.hooks.js";
import type { PackageFilesListing } from "../rules.js";
import { makeRules } from "./plugin-rules-fixture.js";
import { deferred, english, PluginQueryHarness } from "./plugin-hook-test-fixtures.js";

const rules = makeRules();
const listing = (path: string, content: string): PackageFilesListing => ({
  truncated: false, files: [{ relativePath: path, sizeBytes: content.length, content, omitted: null }],
});

it("never exposes a previous plugin's late listing under the current viewer", async () => {
  const old = deferred<PackageFilesListing>();
  const next = deferred<PackageFilesListing>();
  const getPluginFiles = vi.fn(({ id }: { id: string }) => {
    if (id === "old-site") return old.promise;
    if (id === "new-site") return next.promise;
    throw new Error(`unexpected plugin ${id}`);
  });
  const { result, rerender } = renderHook(({ pluginId }) => usePluginPackageFiles({
    pluginId, port: { getPluginFiles }, t: english, rules,
  }), { initialProps: { pluginId: "old-site" }, wrapper: PluginQueryHarness });
  await waitFor(() => expect(getPluginFiles).toHaveBeenCalledWith({ id: "old-site" }));
  expect(result.current.status).toEqual({ role: "status", text: "Loading package files…" });
  rerender({ pluginId: "new-site" });
  await waitFor(() => expect(getPluginFiles).toHaveBeenCalledWith({ id: "new-site" }));
  await act(async () => { next.resolve({ truncated: true, files: [
    ...listing("readme.md", "Instructions").files, ...listing("plugin.json", "New manifest").files,
  ] }); });
  expect(result.current.selectedFile).toEqual({ relativePath: "plugin.json", content: "New manifest" });
  act(() => result.current.selectFile("readme.md"));
  expect(result.current.selectedFile).toEqual({ relativePath: "readme.md", content: "Instructions" });
  await act(async () => { old.resolve(listing("old.md", "Old notes")); });
  expect(result.current.files.map(file => file.relativePath)).toEqual(["readme.md", "plugin.json"]);
  expect(result.current.selectedFile).toEqual({ relativePath: "readme.md", content: "Instructions" });
});

it("separates site and agent packages with the same id and displays a described read refusal", async () => {
  const sitePort = { getPluginFiles: vi.fn(async () => listing("plugin.json", "Site manifest")) };
  const agentPort = { getPluginFiles: vi.fn(async () => { throw "agent gateway refused"; }) };
  const translator = (key: string) => `ui: ${key}`;
  const { result } = renderHook(() => ({
    site: usePluginPackageFiles({ pluginId: "notes", port: sitePort, t: english, rules }),
    agent: usePluginPackageFiles({ pluginId: "notes", queryRoot: "agent-plugins", port: agentPort, t: translator, rules }),
  }), { wrapper: PluginQueryHarness });
  await waitFor(() => expect(result.current.agent.status).toEqual({ role: "alert", text: "ui: failed to load package files" }));
  expect(result.current.agent.files).toEqual([]);
  expect(result.current.site.selectedFile).toEqual({ relativePath: "plugin.json", content: "Site manifest" });
  expect(sitePort.getPluginFiles).toHaveBeenCalledWith({ id: "notes" });
  expect(agentPort.getPluginFiles).toHaveBeenCalledWith({ id: "notes" });
});
