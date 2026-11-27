// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentPluginListRow } from "../../../agent-plugins/models.js";
import type { AgentPluginInstallPort } from "../../integrations/agent-plugin-ports.js";
import type { FolderZipPort } from "../../../shell/components/InstallTabCard/use-folder-upload.hooks.js";
import { AddAgentPluginPanel } from "../AddAgentPluginPanel.js";
import { AddPluginPanel } from "../AddPluginPanel.js";
import { AgentPluginUpdateControl } from "../AgentPluginUpdateControl.js";
import { useAgentPluginInstall } from "../hooks/use-agent-plugin-install.hooks.js";
import { useAgentPluginUpdate } from "../hooks/use-agent-plugin-update.hooks.js";
import { usePluginInstall, type IsInstallApiError } from "../hooks/use-plugin-install.hooks.js";
import type { PluginInstallPort, PluginInstallPreview } from "../hooks/plugin-install-port.hooks.js";
import { makeRules } from "./plugin-rules-fixture.js";

afterEach(cleanup);
const t = (key: string) => key;
const isApiError: IsInstallApiError = (error): error is { status: number } =>
  error instanceof Error && typeof (error as Error & { status?: unknown }).status === "number";
class FolderZipError extends Error { readonly reason = "unreadable" as const; }
const rules = makeRules();
const plugin: AgentPluginListRow = {
  pluginId: "packet-audit", enabled: false, version: "2.0.0", description: null, keywords: [], skills: [], mcpServerIds: [],
};
function zipper(zip = new File(["test archive"], "picked-folder.zip", { type: "application/zip" })) {
  return {
    FOLDER_EMPTY: "No files in folder", FOLDER_UNREADABLE: "Cannot read folder", FolderZipError,
    zipFolderFiles: vi.fn<FolderZipPort["zipFolderFiles"]>(async () => zip),
  } satisfies FolderZipPort;
}
const digest = "a".repeat(64);

it("installs a chosen Agent Plugin zip, retains replacement intent and shows warnings and the disabled success state", async () => {
  const file = new File(["zip fixture"], "packet-audit.zip", { type: "application/zip" });
  let finish!: (answer: Awaited<ReturnType<AgentPluginInstallPort["installZip"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<AgentPluginInstallPort["installZip"]>>>((resolve) => { finish = resolve; });
  const sha256 = vi.fn<AgentPluginInstallPort["sha256"]>(async () => digest);
  const installZip = vi.fn<AgentPluginInstallPort["installZip"]>(() => pending);
  const onInstalled = vi.fn();
  const folderZip = zipper();
  function Panel() {
    const controller = useAgentPluginInstall({ port: { installZip, sha256 }, t, onInstalled, folderZip, isApiError, rules, productName: "Acme" });
    return <AddAgentPluginPanel controller={controller} />;
  }
  const user = userEvent.setup();
  render(<Panel />);
  expect(screen.getByRole("heading", { name: "Add a plugin" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Plugin URL" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add from URL" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Install (stays off)" })).toBeDisabled();
  await user.upload(screen.getByLabelText("Upload a .zip"), file);
  expect(screen.getByText("packet-audit.zip")).toBeVisible();
  const replace = screen.getByRole("checkbox", { name: "Replace existing version" });
  await user.click(replace);
  await user.click(screen.getByRole("button", { name: "Install (stays off)" }));
  expect(screen.getByRole("button", { name: "Installing…" })).toBeDisabled();
  expect(replace).toBeDisabled();
  expect(sha256).toHaveBeenCalledExactlyOnceWith({ file });
  expect(installZip).toHaveBeenCalledExactlyOnceWith({ file, sha256: digest, replace: true });
  expect(onInstalled).not.toHaveBeenCalled();
  await act(async () => finish({ agentPlugin: plugin, alreadyInstalled: false, warnings: ["Needs report:csv"] }));
  expect(onInstalled).toHaveBeenCalledExactlyOnceWith(plugin);
  expect(screen.getByText("Needs report:csv")).toBeVisible();
  expect(screen.getByText("Packet Audit is installed and switched off. Turn it on in Installed.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Install (stays off)" })).toBeDisabled();
});

it("opens a named update upload with no install-only controls and renders an update refusal", async () => {
  const updated = { ...plugin, enabled: true, version: "3.0.0" };
  const file = new File(["upgrade manifest"], "upgrade.zip", { type: "application/zip" });
  const folderFile = new File(["{}"], "plugin.json");
  const folderZip = zipper(file);
  const sha256 = vi.fn<AgentPluginInstallPort["sha256"]>(async () => digest);
  const installZip = vi.fn<AgentPluginInstallPort["installZip"]>()
    .mockRejectedValueOnce(Object.assign(new Error("stale"), { status: 409, code: "PLUGIN_CHANGED" }))
    .mockResolvedValueOnce({ agentPlugin: updated, alreadyInstalled: false });
  const onUpdated = vi.fn();
  function Panel() {
    const update = useAgentPluginUpdate({ plugin, expectedOldDigest: "original-revision", port: { installZip, sha256 }, t, onUpdated, folderZip, isApiError, rules, productName: "Acme" });
    return <AgentPluginUpdateControl update={update} t={t} agentHandleBase="row-packet-audit" />;
  }
  const user = userEvent.setup();
  render(<Panel />);
  const toggle = screen.getByRole("button", { name: "Update Packet Audit" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: "Update Packet Audit" })).toBeNull();
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("heading", { name: "Update Packet Audit" })).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "Plugin URL" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Replace existing version" })).toBeNull();
  await user.upload(screen.getByLabelText("Choose a plugin folder"), folderFile);
  expect(folderZip.zipFolderFiles).toHaveBeenCalledExactlyOnceWith({ files: [folderFile], maxBytes: 32 * 1024 * 1024 });
  expect(await screen.findByText("upgrade.zip")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Update", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This plugin changed since this page loaded. Reload the page and try again.");
  expect(onUpdated).not.toHaveBeenCalled();
  expect(installZip).toHaveBeenCalledExactlyOnceWith({ file, sha256: digest, replace: false, update: { pluginId: "packet-audit", expectedOldDigest: "original-revision" } });
  await user.click(screen.getByRole("button", { name: "Update", exact: true }));
  expect(await screen.findByText("Packet Audit is updated.")).toBeVisible();
  expect(onUpdated).toHaveBeenCalledExactlyOnceWith(updated);
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: "Update Packet Audit" })).toBeNull();
});

it("reviews the chosen site ZIP, cancels consent before a replacement and installs only its reviewed digest", async () => {
  const file = new File(["site zip"], "site-index.zip", { type: "application/zip" });
  const preview: PluginInstallPreview = {
    id: "site-index", name: "Site Index", version: "2.3.1", tier: "tier-3", digest: "reviewed-digest",
    capabilities: ["search.lookup"], hooks: ["afterSave"], hasCode: true, contentTypes: ["index-item"],
    conflicts: [{ kind: "route", key: "/search", heldBy: "legacy-index", heldByName: "Legacy Index", heldKey: "/search" }],
  };
  const review = vi.fn<PluginInstallPort["preview"]>()
    .mockResolvedValueOnce({ plugin: { ...preview, conflicts: [] } }).mockResolvedValueOnce({ plugin: preview });
  const install = vi.fn<PluginInstallPort["install"]>(async () => ({ plugin: preview }));
  const onInstalled = vi.fn(async () => {});
  const folderZip = zipper();
  function Panel() {
    const controller = usePluginInstall({ port: { preview: review, install }, t, onInstalled, folderZip, isApiError, rules });
    return <AddPluginPanel controller={controller} productName="Acme" />;
  }
  const user = userEvent.setup();
  render(<Panel />);
  expect(screen.getByRole("button", { name: "Preview plugin" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Install (stays off)" })).toBeNull();
  await user.upload(screen.getByLabelText("Upload .zip (max 32 MiB)"), file);
  expect(screen.getByText("site-index.zip")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Preview plugin" }));
  expect(await screen.findByRole("heading", { name: "Site Index (site-index)" })).toBeVisible();
  expect(screen.queryByText(/Already in use in this workspace/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("button", { name: "Install (stays off)" })).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: "Replace existing version" }));
  await user.click(screen.getByRole("button", { name: "Preview plugin" }));
  expect(await screen.findByText("Version: 2.3.1")).toBeVisible();
  expect(screen.getByText("Capabilities: search.lookup")).toBeVisible();
  expect(screen.getByText("Hooks: afterSave")).toBeVisible();
  expect(screen.getByText("Content types: index-item")).toBeVisible();
  expect(screen.getByText(/runs code with full access/)).toBeVisible();
  expect(screen.getByText(/Legacy Index/)).toBeVisible();
  expect(review.mock.calls).toEqual([[{ source: { kind: "zip", file }, replace: false }], [{ source: { kind: "zip", file }, replace: true }]]);
  expect(install).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Install (stays off)" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Site Index is installed and switched off.");
  expect(install).toHaveBeenCalledExactlyOnceWith({ source: { kind: "zip", file }, replace: true, expectedDigest: "reviewed-digest" });
  expect(onInstalled).toHaveBeenCalledExactlyOnceWith();
});

it("submits the advanced server folder as a preview and surfaces a refusal without exposing Install", async () => {
  const preview = vi.fn<PluginInstallPort["preview"]>(async () => { throw Object.assign(new Error("no folder installs"), { code: "PLUGIN_LOCAL_INSTALL_DISABLED", status: 403 }); });
  const install = vi.fn<PluginInstallPort["install"]>(async () => { throw new Error("no authorized install"); });
  const folderZip = zipper();
  function Panel() {
    return <AddPluginPanel productName="Atlas" controller={usePluginInstall({ port: { preview, install }, t, onInstalled: async () => {}, isApiError, folderZip, rules })} />;
  }
  const user = userEvent.setup();
  render(<Panel />);
  await user.click(screen.getByText("Advanced: install from a path on this server"));
  expect(screen.getByText("The full path of a plugin folder on the computer running Atlas.")).toBeVisible();
  await user.type(screen.getByRole("textbox", { name: "Folder on this server" }), " /srv/packages/sample {Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent("Local folder installs are disabled on this server.");
  expect(preview).toHaveBeenCalledExactlyOnceWith({ source: { kind: "folder", path: "/srv/packages/sample" }, replace: false });
  expect(screen.queryByRole("button", { name: "Install (stays off)" })).toBeNull();
  expect(install).not.toHaveBeenCalled();
});
