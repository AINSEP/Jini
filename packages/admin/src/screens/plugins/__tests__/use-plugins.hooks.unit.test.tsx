// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { AdminPluginDto } from "@jini-ai/core/contracts/site/cms-plugins";
import { publishContentRefresh } from "../../../shell/lib/content-refresh-bus.js";
import type { PluginInstallPort } from "../hooks/plugin-install-port.hooks.js";
import type { PluginsPort } from "../hooks/plugins-port.hooks.js";
import { usePlugins, type PluginsDependencies } from "../hooks/use-plugins.hooks.js";
import { deferred, english, folderZipper, isInstallRefusal, PluginQueryHarness } from "./plugin-hook-test-fixtures.js";
import { FakeApiError, makeRules } from "./plugin-rules-fixture.js";

function row(id: string, name: string): AdminPluginDto {
  return { id, name, version: "1.4", source: "site", tier: "tier-3", status: "valid", enabled: false,
    errors: [], conflicts: [], quarantine: null };
}
const metrics = row("metrics", "Site Metrics");
const search = row("search", "Search Tools");

function setup(deps: Pick<PluginsPort, "listPlugins"> & Partial<PluginsPort>, installPort?: PluginInstallPort) {
  const port: PluginsPort = {
    setPluginEnabled: async () => { throw new Error("unexpected activation"); },
    uninstallPlugin: async () => { throw new Error("unexpected removal"); },
    getPluginFiles: async () => { throw new Error("unexpected file read"); },
    getProviderSettings: async () => { throw new Error("unexpected settings read"); },
    saveProviderSettings: async () => { throw new Error("unexpected settings write"); },
    ...deps,
  };
  const options: PluginsDependencies = {
    port, locale: "fr", t: english, translate: ({ locale, key }) => `${locale}: ${key}`, folderZip: folderZipper(),
    isApiError: isInstallRefusal, rules: makeRules(), installPort: installPort ?? {
      preview: async () => { throw new Error("unexpected review"); }, install: async () => { throw new Error("unexpected install"); },
    },
  };
  return renderHook(() => usePlugins(options), { wrapper: PluginQueryHarness });
}

it("keeps expansion, inspection and settings scoped to the chosen ids through a bus refresh", async () => {
  const initial = deferred<Awaited<ReturnType<PluginsPort["listPlugins"]>>>();
  const newer = { ...metrics, name: "New Metrics", version: "2" };
  const listPlugins = vi.fn<PluginsPort["listPlugins"]>().mockImplementationOnce(() => initial.promise)
    .mockResolvedValue({ plugins: [newer, search], installSources: ["zip"] });
  const { result } = setup({ listPlugins });
  expect(result.current.plugins).toBeNull();
  expect(result.current.canInstallFolder).toBe(false);
  await act(async () => { initial.resolve({ plugins: [metrics, search], installSources: ["zip", "folder"] }); });
  expect(result.current.canInstallFolder).toBe(true);
  expect(result.current.locale).toBe("fr");
  act(() => {
    result.current.onToggleExpanded({ id: "metrics" });
    result.current.onToggleExpanded({ id: "search" });
    result.current.onInspectPlugin("metrics");
    result.current.onOpenSettings("metrics");
  });
  expect(result.current.expandedIds).toEqual(new Set(["metrics", "search"]));
  expect(result.current.inspectedPlugin).toEqual(metrics);
  expect(result.current.settingsPlugin).toEqual(metrics);
  const readsBefore = listPlugins.mock.calls.length;
  await act(async () => { publishContentRefresh({ resources: ["pages"] }); });
  expect(listPlugins).toHaveBeenCalledTimes(readsBefore);
  await act(async () => { publishContentRefresh({ resources: ["plugins"] }); });
  await waitFor(() => expect(result.current.inspectedPlugin).toEqual(newer));
  expect(result.current.settingsPlugin).toEqual(newer);
  expect(result.current.canInstallFolder).toBe(false);
  act(() => {
    result.current.onToggleExpanded({ id: "metrics" });
    result.current.onCloseInspector();
    result.current.onSettingsSaved();
  });
  expect(result.current.expandedIds).toEqual(new Set(["search"]));
  expect(result.current.inspectedPlugin).toBeNull();
  expect(result.current.settingsPlugin).toBeNull();
  expect(result.current.settingsNotice).toBe("New Metrics settings saved");
  act(() => result.current.dismissSettingsNotice());
  expect(result.current.settingsNotice).toBeNull();

  act(() => result.current.onOpenSettings("legacy"));
  expect(result.current.settingsPlugin).toBeNull();
  act(() => result.current.onSettingsSaved());
  expect(result.current.settingsNotice).toBe("legacy settings saved");
  act(() => result.current.onOpenSettings("search"));
  expect(result.current.settingsPlugin).toEqual(search);
  act(() => result.current.onCloseSettings());
  expect(result.current.settingsPlugin).toBeNull();
});

it.each(["toggle", "remove"] as const)("keeps the other row busy when %s settles first and refreshes accepted changes", async (first) => {
  let rows = [metrics, search];
  const toggle = deferred<void>();
  const remove = deferred<void>();
  const setPluginEnabled = vi.fn<PluginsPort["setPluginEnabled"]>(async ({ id, patch }) => {
    if (id !== "metrics") throw new Error("wrong toggle target");
    await toggle.promise;
    rows = rows.map(plugin => plugin.id === id ? { ...plugin, enabled: patch.enabled } : plugin);
    return { plugin: { id, version: "1.4", enabled: patch.enabled, updatedAt: "2026-11-01" }, changeSetId: "add-1" };
  });
  const uninstallPlugin = vi.fn<PluginsPort["uninstallPlugin"]>(async ({ id }) => {
    if (id !== "search") throw new Error("wrong removal target");
    await remove.promise;
    rows = rows.filter(plugin => plugin.id !== id);
    return { pluginId: id, trashed: true };
  });
  const { result } = setup({ listPlugins: async () => ({ plugins: rows }), setPluginEnabled, uninstallPlugin });
  await waitFor(() => expect(result.current.plugins).toEqual([metrics, search]));
  const startToggle = () => result.current.onToggleEnabled(metrics);
  const startRemove = () => result.current.onRemovePlugin(search);
  const [startA, startB] = first === "toggle" ? [startToggle, startRemove] : [startRemove, startToggle];
  const [pendingA, pendingB] = first === "toggle" ? [toggle, remove] : [remove, toggle];
  const secondId = first === "toggle" ? "search" : "metrics";
  let a!: Promise<void>;
  let b!: Promise<void>;
  await act(async () => { a = startA(); });
  await act(async () => { b = startB(); });
  expect(result.current.rowSavingId).toBe(secondId);
  let duplicate!: Promise<void>;
  await act(async () => { duplicate = startB(); });
  expect(setPluginEnabled).toHaveBeenCalledExactlyOnceWith({ id: "metrics", patch: { enabled: true } });
  expect(uninstallPlugin).toHaveBeenCalledExactlyOnceWith({ id: "search" });
  await act(async () => { pendingA.resolve(); await a; });
  expect(result.current.rowSavingId).toBe(secondId);
  await act(async () => { pendingB.resolve(); await Promise.all([b, duplicate]); });
  expect(result.current.rowSavingId).toBeNull();
  expect(result.current.plugins).toEqual([{ ...metrics, enabled: true }]);
  expect(result.current.rowError).toBeNull();
});

it("requires explicit confirmation and refreshes the list after removing the selected row", async () => {
  let rows = [metrics, search];
  const uninstallPlugin = vi.fn<PluginsPort["uninstallPlugin"]>(async ({ id }) => {
    rows = rows.filter(plugin => plugin.id !== id);
    return { pluginId: id, trashed: true };
  });
  const { result } = setup({ listPlugins: async () => ({ plugins: rows }), uninstallPlugin });
  await waitFor(() => expect(result.current.plugins).toEqual([metrics, search]));
  act(() => result.current.onRequestRemove(search));
  expect(result.current.pendingRemovePlugin).toEqual(search);
  act(() => result.current.onCancelRemove());
  expect(result.current.pendingRemovePlugin).toBeNull();
  expect(uninstallPlugin).not.toHaveBeenCalled();
  act(() => result.current.onRequestRemove(metrics));
  expect(result.current.pendingRemovePlugin).toEqual(metrics);
  act(() => result.current.onConfirmRemove(metrics));
  expect(result.current.pendingRemovePlugin).toBeNull();
  await waitFor(() => expect(result.current.plugins).toEqual([search]));
  expect(uninstallPlugin).toHaveBeenCalledExactlyOnceWith({ id: "metrics" });
});

it("distinguishes failed writes from failed refresh and recovers after a matching content event", async () => {
  const enabled = { ...metrics, enabled: true };
  const listPlugins = vi.fn<PluginsPort["listPlugins"]>()
    .mockRejectedValueOnce("initial read").mockResolvedValueOnce({ plugins: [metrics] })
    .mockRejectedValueOnce("refresh read").mockResolvedValue({ plugins: [enabled] });
  const setPluginEnabled = vi.fn<PluginsPort["setPluginEnabled"]>()
    .mockRejectedValueOnce(new FakeApiError("server", "PLUGIN_INCOMPATIBLE"))
    .mockResolvedValueOnce({ plugin: { ...enabled, updatedAt: "2026-11-01" }, changeSetId: "ok" });
  const uninstallPlugin = vi.fn<PluginsPort["uninstallPlugin"]>().mockRejectedValueOnce("remove transport failed");
  const { result } = setup({ listPlugins, setPluginEnabled, uninstallPlugin });
  await waitFor(() => expect(result.current.error).toBe("fr: failed to load plugins"));
  await act(async () => { publishContentRefresh(); });
  await waitFor(() => expect(result.current.plugins).toEqual([metrics]));
  expect(result.current.error).toBeNull();
  await act(() => result.current.onToggleEnabled(metrics));
  expect(result.current.rowError).toBe("This plugin requires a different SDK version.");
  expect(result.current.rowSavingId).toBeNull();
  await act(() => result.current.onRemovePlugin(metrics));
  expect(result.current.rowError).toBe("fr: failed to remove plugin");
  expect(uninstallPlugin).toHaveBeenCalledExactlyOnceWith({ id: "metrics" });
  expect(result.current.plugins).toEqual([metrics]);
  await act(() => result.current.onToggleEnabled(metrics));
  expect(setPluginEnabled.mock.calls).toEqual([
    [{ id: "metrics", patch: { enabled: true } }], [{ id: "metrics", patch: { enabled: true } }],
  ]);
  expect(result.current.error).toBe("fr: failed to load plugins");
  expect(result.current.rowError).toBeNull();
  await act(async () => { publishContentRefresh(); });
  await waitFor(() => expect(result.current.plugins).toEqual([enabled]));
  expect(result.current.error).toBeNull();
});

it("reloads authoritative rows after accepting a newly installed package", async () => {
  let rows = [search];
  const reviewed = { id: "metrics", name: "Site Metrics", version: "1.4", tier: "tier-3", digest: "new-sha",
    capabilities: [], hooks: [], hasCode: true, contentTypes: [], conflicts: [] };
  const preview = vi.fn<PluginInstallPort["preview"]>().mockResolvedValue({ plugin: reviewed });
  const install = vi.fn<PluginInstallPort["install"]>(async () => { rows = [search, metrics]; return { plugin: reviewed }; });
  const { result } = setup({ listPlugins: async () => ({ plugins: rows, installSources: ["folder"] }) }, { preview, install });
  await waitFor(() => expect(result.current.plugins).toEqual([search]));
  act(() => result.current.install!.setFolder({ value: "/srv/plugins/metrics" }));
  await act(() => result.current.install!.review());
  await act(() => result.current.install!.install());
  expect(install).toHaveBeenCalledExactlyOnceWith({ source: { kind: "folder", path: "/srv/plugins/metrics" }, replace: false, expectedDigest: "new-sha" });
  expect(result.current.plugins).toEqual([search, metrics]);
  expect(result.current.plugins?.find(plugin => plugin.id === "metrics")?.enabled).toBe(false);
});
