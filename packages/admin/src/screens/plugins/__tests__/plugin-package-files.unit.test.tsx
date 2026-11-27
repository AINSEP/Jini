// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { FetchQueryProvider, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { useCodeWrap } from "@jini-ai/ui";
import type { AgentPluginFiles } from "../../../agent-plugins/models.js";
import { useAgentPluginFileTree } from "../../../agent-plugins/react/hooks/AgentPluginInspector.hooks.js";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { PackageFilesModal } from "../PackageFilesModal.js";
import { PluginPackageFilesModal } from "../PluginPackageFilesModal.js";
import { useAgentPluginDetailsModal, useAgentPluginDetailsView } from "../hooks/use-agent-plugin-details-modal.hooks.js";
import { usePluginPackageFiles } from "../hooks/use-plugin-package-files.hooks.js";
import type { PackageFileView, PackageFilesListing } from "../rules.js";
import { makeRules } from "./plugin-rules-fixture.js";

afterEach(cleanup);
const t = (key: string) => key;
const rules = makeRules();
const kit = fakeAdminKit({
  hooks: {
    useAgentPluginFileTree: (required, optional) => useAgentPluginFileTree(required, optional?.locale === undefined ? {} : { locale: optional.locale }),
    useCodeWrap,
  },
  query: { useFetchQuery },
});
function wrapper({ children }: { children: ReactNode }) {
  return <AdminKitProvider kit={kit}><FetchQueryProvider>{children}</FetchQueryProvider></AdminKitProvider>;
}

it("selects nested package files by full path, resets wrap per file, and explains omitted content", async () => {
  const files = [
    { relativePath: "plugin.json", content: '{"name":"catalog"}' },
    { relativePath: "skills/guide.md", content: "# Data entry guide" },
    { relativePath: "skills/preview.bin", content: null, unavailableReason: "Binary contents are unavailable." },
  ] satisfies PackageFileView[];
  const select = vi.fn();
  const close = vi.fn();
  function Viewer() {
    const [path, setPath] = useState("plugin.json");
    return <PluginPackageFilesModal plugin={{ id: "catalog-tool", name: "Catalog" }} onClose={() => close()}
      useFiles={({ pluginId }) => {
        if (pluginId !== "catalog-tool") throw new Error(`Unexpected file list id: ${pluginId}`);
        return { files, selectedFile: files.find((file) => file.relativePath === path) ?? null,
          selectFile: (next) => { select(next); setPath(next); }, t, status: null, listNotice: "Some large files were omitted." };
      }} />;
  }
  const user = userEvent.setup();
  render(<Viewer />, { wrapper });
  const view = within(screen.getByRole("dialog", { name: "Catalog package files" }));
  expect(view.getByRole("note")).toHaveTextContent("Some large files were omitted.");
  const tree = within(view.getByRole("tree", { name: "Package files" }));
  const root = tree.getByRole("treeitem", { name: "plugin.json" });
  expect(root).toHaveAttribute("aria-selected", "true");
  expect(root.getAttribute("data-agent-element")).toMatch(/^plugin-file-.*-select$/);
  expect(view.getByText('{"name":"catalog"}')).toHaveAttribute("data-wrap", "true");
  let wrap = view.getByRole("button", { name: "Wrap lines" });
  await user.click(wrap);
  expect(wrap).toHaveAttribute("aria-pressed", "false");
  expect(view.getByText('{"name":"catalog"}')).toHaveAttribute("data-wrap", "false");

  const skills = tree.getByRole("treeitem", { name: "skills" });
  expect(skills).toHaveAttribute("aria-expanded", "false");
  expect(tree.queryByRole("treeitem", { name: "guide.md" })).toBeNull();
  await user.click(skills);
  expect(skills).toHaveAttribute("aria-expanded", "true");
  expect(select).not.toHaveBeenCalled();
  const guide = tree.getByRole("treeitem", { name: "guide.md" });
  expect(guide).toHaveAttribute("aria-level", "2");
  await user.click(guide);
  expect(select).toHaveBeenCalledExactlyOnceWith("skills/guide.md");
  expect(guide).toHaveAttribute("aria-selected", "true");
  expect(root).toHaveAttribute("aria-selected", "false");
  expect(view.getByRole("heading", { level: 3 }).textContent).toBe("skills/guide.md");
  expect(view.getByRole("heading", { level: 3 }).querySelectorAll("wbr")).toHaveLength(1);
  wrap = view.getByRole("button", { name: "Wrap lines" });
  expect(wrap).toHaveAttribute("aria-pressed", "true");
  expect(view.getByText("# Data entry guide")).toHaveAttribute("data-wrap", "true");
  await user.click(tree.getByRole("treeitem", { name: "preview.bin" }));
  expect(view.getByRole("status")).toHaveTextContent("Binary contents are unavailable.");
  expect(view.queryByRole("button", { name: "Wrap lines" })).toBeNull();
  expect(select.mock.calls).toEqual([["skills/guide.md"], ["skills/preview.bin"]]);
  await user.click(skills);
  expect(tree.queryByRole("treeitem", { name: "preview.bin" })).toBeNull();
  expect(view.getByRole("status")).toHaveTextContent("Binary contents are unavailable.");
  await user.click(view.getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalledExactlyOnceWith();
});

it("shows a load failure in an empty file viewer and retains extra content", () => {
  render(<PackageFilesModal title="Agent package" t={t} handlePrefix="agent-plugin-file" files={[]} selectedFile={null}
    onClose={vi.fn()} onSelectFile={vi.fn()} status={{ role: "alert", text: "Package no longer exists" }}
    headerExtras={<span>Read only</span>} additionalViews={[{ id: "plugin-memory", label: "Memory", custom: <p>Project note</p> }]} />, { wrapper });
  const dialog = within(screen.getByRole("dialog", { name: "Agent package" }));
  expect(dialog.getByRole("alert")).toHaveTextContent("Package no longer exists");
  expect(dialog.getByText("Read only")).toBeVisible();
  expect(within(dialog.getByRole("region", { name: "Memory" })).getByText("Project note")).toBeVisible();
  expect(dialog.queryByRole("treeitem")).toBeNull();
});

it("rejects a selected file that does not belong to the package listing", () => {
  expect(() => render(<PackageFilesModal title="Agent package" t={t} handlePrefix="agent-plugin-file"
    files={[{ relativePath: "plugin.json", content: "{}" }]} selectedFile={{ relativePath: "unlisted.md", content: "wrong package" }}
    onClose={vi.fn()} onSelectFile={vi.fn()} status={null} />, { wrapper })).toThrow("package file unlisted.md has no handle");
});

it("keeps same-id agent and site file reads separate and selects agent files by path", async () => {
  const files = [
    { relativePath: "plugin.json", content: "agent manifest", sizeBytes: 14, omitted: null },
    { relativePath: "usage.md", content: "agent usage", sizeBytes: 11, omitted: null },
  ];
  const getAgentPluginFiles = vi.fn(async (): Promise<AgentPluginFiles> => ({
    pluginId: "catalog", files, truncated: true, limits: { maxFiles: 2, maxEntries: 23, maxFileBytes: 50, maxTotalBytes: 120 },
  }));
  const getPluginFiles = vi.fn(async (): Promise<PackageFilesListing> => ({
    files: [{ relativePath: "plugin.json", content: "site manifest", sizeBytes: 13, omitted: null }], truncated: false,
  }));
  const cmsPort = { getPluginFiles };
  const agentPort = { getAgentPluginFiles };
  const { result } = renderHook(() => ({
    cms: usePluginPackageFiles({ pluginId: "catalog", port: cmsPort, t, rules }),
    agent: useAgentPluginDetailsModal({ pluginId: "catalog", port: agentPort, t, rules }),
  }), { wrapper });
  await waitFor(() => {
    expect(result.current.cms.selectedFile?.content).toBe("site manifest");
    expect(result.current.agent.selectedFile?.content).toBe("agent manifest");
  });
  expect(getPluginFiles).toHaveBeenCalledExactlyOnceWith({ id: "catalog" });
  expect(getAgentPluginFiles).toHaveBeenCalledExactlyOnceWith({ pluginId: "catalog" });
  act(() => result.current.agent.selectFile("usage.md"));
  expect(result.current.agent.selectedFile?.content).toBe("agent usage");
  expect(result.current.cms.selectedFile?.content).toBe("site manifest");
  act(() => result.current.agent.selectFile("nonexistent.md"));
  expect(result.current.agent.selectedFile?.relativePath).toBe("plugin.json");
});

it("updates the popup title only when the selected view is plugin memory", () => {
  const { result } = renderHook(() => useAgentPluginDetailsView({ displayName: "Index", t, memoryT: () => "Notes" }));
  expect(result.current.title).toBe("Index package files");
  act(() => result.current.onView("plugin-memory"));
  expect(result.current.title).toBe("Index Notes");
  act(() => result.current.onView("dashboard"));
  expect(result.current.title).toBe("Index package files");
});
