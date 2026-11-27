// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { AgentPluginListRow } from "../../../agent-plugins/models.js";
import type { AgentPluginInstallPort, AgentPluginInstallResult } from "../../integrations/agent-plugin-ports.js";
import { AddAgentPluginPanel } from "../AddAgentPluginPanel.js";
import { useAgentPluginInstall } from "../hooks/use-agent-plugin-install.hooks.js";
import { useAgentPluginUpdate } from "../hooks/use-agent-plugin-update.hooks.js";
import { deferred, english, folderZipper, InstallRefusal, isInstallRefusal } from "./plugin-hook-test-fixtures.js";
import { makeRules } from "./plugin-rules-fixture.js";

const plugin: AgentPluginListRow = {
  pluginId: "research-notes", version: "2", description: null, enabled: false, displayName: "Research $& Notes",
  keywords: [], mcpServerIds: [], skills: [],
};
const rules = makeRules("Acme");
const zip = () => new File(["archive"], "notes.ZIP", { type: "application/zip" });
const baseHost = { t: english, productName: "Acme", rules, isApiError: isInstallRefusal, folderZip: folderZipper() };

function choose(file: File) {
  const input = screen.getByLabelText("Upload a .zip");
  fireEvent.change(input, { target: { files: [file] } });
}

it("hashes the selected bytes once, forwards replacement and reports an off-by-default install", async () => {
  const hash = deferred<string>();
  const upload = deferred<AgentPluginInstallResult>();
  const sha256 = vi.fn<AgentPluginInstallPort["sha256"]>(() => hash.promise);
  const installZip = vi.fn<AgentPluginInstallPort["installZip"]>(() => upload.promise);
  const onInstalled = vi.fn<(row: AgentPluginListRow) => void>();
  const file = zip();
  const user = userEvent.setup();
  const { result } = renderHook(() => useAgentPluginInstall({ ...baseHost, port: { sha256, installZip }, onInstalled,
    t: key => key === "Needs {capabilities}" ? "Requires {capabilities}" : key,
  }));
  act(() => result.current.install());
  expect(sha256).not.toHaveBeenCalled();
  render(<AddAgentPluginPanel controller={result.current} />);
  choose(file);
  await user.click(screen.getByRole("checkbox", { name: "Replace existing version" }));
  expect(result.current.replace).toBe(true);
  expect(result.current.labels.action).toBe("Install (stays off)");
  act(() => { result.current.install(); result.current.install(); });
  expect(result.current.busy).toBe(true);
  expect(result.current.installDisabled).toBe(true);
  expect(sha256).toHaveBeenCalledExactlyOnceWith({ file });
  expect(installZip).not.toHaveBeenCalled();
  await act(async () => { hash.resolve("sha-of-notes"); });
  expect(installZip).toHaveBeenCalledExactlyOnceWith({ file, sha256: "sha-of-notes", replace: true });
  await act(async () => { upload.resolve({ alreadyInstalled: false, agentPlugin: plugin, warnings: ["Needs notes:write"] }); });
  expect(onInstalled).toHaveBeenCalledExactlyOnceWith(plugin);
  expect(result.current).toMatchObject({ busy: false, replace: false, file: null, installDisabled: true,
    installedMessage: "Research $& Notes is installed and switched off. Turn it on in Installed.", warnings: ["Requires notes:write"] });
});

it("validates selected and dropped archives before any hashing and resets file-scoped replacement", async () => {
  const sha256 = vi.fn<AgentPluginInstallPort["sha256"]>();
  const installZip = vi.fn<AgentPluginInstallPort["installZip"]>();
  const port = { sha256, installZip };
  const onInstalled = vi.fn();
  function Panel() {
    return <AddAgentPluginPanel controller={useAgentPluginInstall({ ...baseHost, port, onInstalled })} />;
  }
  render(<Panel />);
  const picker = vi.fn();
  screen.getByLabelText("Upload a .zip").addEventListener("click", picker);
  await userEvent.click(screen.getByRole("button", { name: "Choose a file" }));
  expect(picker).toHaveBeenCalledTimes(1);
  choose(new File(["bytes"], "notes.tar"));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose one .zip file.");
  choose(new File([], "empty.zip"));
  expect(screen.getByRole("alert")).toHaveTextContent("This file is not a readable .zip.");
  const oversized = new File(["tiny fixture"], "big.zip");
  Object.defineProperty(oversized, "size", { value: 32 * 1024 * 1024 + 1 });
  choose(oversized);
  expect(screen.getByRole("alert")).toHaveTextContent("The .zip is larger than the 32 MiB limit.");
  expect(screen.getByRole("button", { name: "Install (stays off)" })).toBeDisabled();
  expect(sha256).not.toHaveBeenCalled();
  const first = zip();
  const second = new File(["other"], "other.zip");
  const zone = screen.getByText("Drop a .zip here").closest("[aria-busy]")!;
  fireEvent.drop(zone, { dataTransfer: { files: [first, second] } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose one .zip file.");
  expect(screen.getByRole("button", { name: "Install (stays off)" })).toBeDisabled();
  fireEvent.drop(zone, { dataTransfer: { files: [first] } });
  expect(screen.getByText("notes.ZIP")).toBeInTheDocument();
  const replace = screen.getByRole("checkbox", { name: "Replace existing version" });
  await userEvent.click(replace);
  expect(replace).toBeChecked();
  Object.defineProperty(second, "size", { value: 32 * 1024 * 1024 });
  choose(second);
  expect(screen.getByText("other.zip")).toBeInTheDocument();
  expect(replace).not.toBeChecked();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("hands the selected folder to the bounded zipper and clears a previously selected archive when zipping fails", async () => {
  const manifest = new File(["{}"], "plugin.json");
  const archived = zip();
  const generated = deferred<File>();
  const folderZip = folderZipper(vi.fn().mockImplementationOnce(() => generated.promise).mockRejectedValueOnce(new Error("read refused")));
  const port = { sha256: vi.fn(), installZip: vi.fn() };
  const { result } = renderHook(() => useAgentPluginInstall({ ...baseHost, folderZip, port, onInstalled: vi.fn() }));
  const target = { files: [manifest], value: "/picked" };
  let zipping!: Promise<void>;
  act(() => { zipping = result.current.folderUpload.onChange({ target }); });
  expect(result.current.busy).toBe(true);
  expect(result.current.installDisabled).toBe(true);
  await act(async () => { generated.resolve(archived); await zipping; });
  expect(folderZip.zipFolderFiles).toHaveBeenCalledExactlyOnceWith({ files: [manifest], maxBytes: 32 * 1024 * 1024 });
  expect(target.value).toBe("");
  expect(result.current.file).toBe(archived);
  await act(() => result.current.folderUpload.onChange({ target }));
  expect(result.current).toMatchObject({ file: null, error: "Could not read that folder.", installDisabled: true });
  act(() => result.current.onClearFile());
  expect(result.current.error).toBeNull();
});

it("opens and closes update, sends the installed digest, and distinguishes unchanged bytes from an update", async () => {
  const installZip = vi.fn<AgentPluginInstallPort["installZip"]>()
    .mockResolvedValueOnce({ alreadyInstalled: true, agentPlugin: null })
    .mockResolvedValueOnce({ alreadyInstalled: false, agentPlugin: { ...plugin, version: "3", enabled: true } });
  const onUpdated = vi.fn();
  const port = { sha256: async () => "candidate-digest", installZip };
  const { result } = renderHook(() => useAgentPluginUpdate({ ...baseHost, plugin, expectedOldDigest: "shown-v2", port, onUpdated }));
  expect(result.current.open).toBe(false);
  act(() => result.current.onToggle());
  expect(result.current.open).toBe(true);
  expect(result.current.displayName).toBe("Research $& Notes");
  expect(result.current.controller.labels).toMatchObject({ action: "Update", busyAction: "Updating…" });
  const file = zip();
  const view = render(<AddAgentPluginPanel controller={result.current.controller} title="Update Research $& Notes" />);
  choose(file);
  await act(async () => { result.current.controller.install(); });
  expect(result.current.controller.installedMessage).toBe("notes.ZIP is already installed.");
  expect(onUpdated).not.toHaveBeenCalled();
  view.rerender(<AddAgentPluginPanel controller={result.current.controller} title="Update Research $& Notes" />);
  choose(file);
  expect(result.current.controller.installedMessage).toBeNull();
  await act(async () => { result.current.controller.install(); });
  expect(installZip.mock.calls).toEqual([
    [{ file, sha256: "candidate-digest", replace: false, update: { pluginId: "research-notes", expectedOldDigest: "shown-v2" } }],
    [{ file, sha256: "candidate-digest", replace: false, update: { pluginId: "research-notes", expectedOldDigest: "shown-v2" } }],
  ]);
  expect(result.current.controller.installedMessage).toBe("Research $& Notes is updated.");
  expect(onUpdated).toHaveBeenCalledExactlyOnceWith({ ...plugin, version: "3", enabled: true });
  act(() => result.current.onToggle());
  expect(result.current.open).toBe(false);
});

const unpackedLimit = "The .zip is too big once unpacked: at most 4096 files, 16 MiB per file, 64 MiB in all.";

it.each([
  [new InstallRefusal(409, "AGENT_PLUGIN_ARCHIVE_TOO_LARGE"), false, "The .zip is larger than the 32 MiB limit."],
  [new InstallRefusal(409, "AGENT_PLUGIN_DIGEST_MISMATCH"), false, "The upload arrived damaged. Try again."],
  [new InstallRefusal(409, "AGENT_PLUGIN_MANIFEST_MISSING"), false, "No plugin.json found. Put plugin.json at the top of the .zip, or inside one folder."],
  [new InstallRefusal(409, "AGENT_PLUGIN_ARCHIVE_UNREADABLE"), false, "This file is not a readable .zip."],
  [new InstallRefusal(409, "AGENT_PLUGIN_PLUGIN_ID_TAKEN"), false, "This plugin ID is already installed. Choose Replace existing version to upgrade it."],
  [new InstallRefusal(409, "AGENT_PLUGIN_PLUGIN_ENABLED"), false, "Switch off the installed plugin before replacing its version."],
  [new InstallRefusal(409, "AGENT_PLUGIN_PLUGIN_BUNDLED"), false, "A bundled plugin owns this ID and cannot be replaced by an uploaded plugin."],
  [new InstallRefusal(409, "AGENT_PLUGIN_TOO_MANY_ENTRIES"), false, unpackedLimit],
  [new InstallRefusal(409, "AGENT_PLUGIN_FILE_TOO_LARGE"), false, unpackedLimit],
  [new InstallRefusal(409, "AGENT_PLUGIN_TOTAL_SIZE_EXCEEDED"), false, unpackedLimit],
  [new InstallRefusal(403, "AGENT_PLUGIN_ACTIVATIONS_BUSY"), false, "Could not install the plugin. Try again."],
  [new InstallRefusal(409, "PLUGIN_DOWNGRADE_REFUSED"), true, "This package is an older version than the one installed."],
  [new InstallRefusal(409, "PLUGIN_ID_MISMATCH"), true, "This package is a different plugin."],
  [new InstallRefusal(409, "PLUGIN_UPDATE_PENDING"), true, "An earlier update is still being recovered. Restart Acme and try again."],
  [new InstallRefusal(409, "PLUGIN_HOST_INCOMPATIBLE"), true, "This plugin is not made for this Acme version."],
  [new InstallRefusal(409, "PLUGIN_MCP_PROVISION_FAILED"), true, "The new version's MCP servers could not be set up; the previous version was restored."],
  [new InstallRefusal(403, "AGENT_PLUGIN_MANIFEST_INVALID"), false, "plugin.json is not a valid Agent Plugin manifest."],
  [new InstallRefusal(409, "AGENT_PLUGIN_DECOMPRESSION_BOMB"), false, unpackedLimit],
  [new InstallRefusal(409, "PLUGIN_BUNDLED"), true, "Plugins that ship with Acme update with Acme."],
  [new InstallRefusal(409, "PLUGIN_CHANGED"), true, "This plugin changed since this page loaded. Reload the page and try again."],
  [new InstallRefusal(403, "NEW_CODE"), false, "You don't have permission to install plugins."],
  [new InstallRefusal(400), false, "This .zip contains files or links that plugins may not include."],
  [new InstallRefusal(409, "NEW_CODE"), true, "Could not update the plugin. Try again."],
  [new InstallRefusal(409, "toString"), false, "Could not install the plugin. Try again."],
  ["offline", false, "Could not install the plugin. Try again."],
] as const)("describes an Agent Plugin refusal (%#) and keeps the same archive available to retry", async (failure, updating, message) => {
  const file = zip();
  const installZip = vi.fn<AgentPluginInstallPort["installZip"]>().mockRejectedValue(failure);
  const onInstalled = vi.fn();
  const port = { sha256: async () => "candidate", installZip };
  function Panel() {
    return <AddAgentPluginPanel controller={useAgentPluginInstall({ ...baseHost, port, onInstalled },
      updating ? { update: { pluginId: "research-notes", expectedOldDigest: "v1" } } : {})} />;
  }
  render(<Panel />);
  choose(file);
  const submit = screen.getByRole("button", { name: updating ? "Update" : "Install (stays off)" });
  await userEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  await waitFor(() => expect(submit).toBeEnabled());
  expect(screen.getByText("notes.ZIP")).toBeInTheDocument();
  expect(onInstalled).not.toHaveBeenCalled();
});
