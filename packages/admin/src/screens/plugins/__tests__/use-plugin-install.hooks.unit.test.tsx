// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AddPluginPanel } from "../AddPluginPanel.js";
import type { PluginInstallPort, PluginInstallPreview } from "../hooks/plugin-install-port.hooks.js";
import { usePluginInstall } from "../hooks/use-plugin-install.hooks.js";
import { deferred, english, folderZipper, InstallRefusal, isInstallRefusal } from "./plugin-hook-test-fixtures.js";
import { makeRules } from "./plugin-rules-fixture.js";

const pkg: PluginInstallPreview = {
  id: "metrics", name: "Metrics $&", version: "2", tier: "tier-1", digest: "reviewed-v2",
  capabilities: [], hooks: [], contentTypes: ["report"], conflicts: [], hasCode: false,
};
const defaultHost = { t: english, folderZip: folderZipper(), rules: makeRules(), isApiError: isInstallRefusal };
const source = { source: { kind: "folder", path: "/srv/plugins/metrics" }, replace: false } as const;
const zip = () => new File(["archive"], "metrics.zip");
function mount(port: PluginInstallPort, onInstalled = vi.fn(async () => {})) {
  return renderHook(() => usePluginInstall({ ...defaultHost, port, onInstalled }));
}

it("requires a current review, then installs only the digest and inputs the operator reviewed", async () => {
  const user = userEvent.setup();
  const preview = vi.fn<PluginInstallPort["preview"]>().mockResolvedValue({ plugin: pkg });
  const install = vi.fn<PluginInstallPort["install"]>().mockResolvedValue({ plugin: { ...pkg, name: "Unreviewed response" } });
  const reload = deferred<void>();
  const onInstalled = vi.fn(() => reload.promise);
  const port = { preview, install };
  function Panel() { return <AddPluginPanel controller={usePluginInstall({ ...defaultHost, port, onInstalled })} productName="Acme" />; }
  render(<Panel />);
  expect(screen.getByRole("button", { name: "Preview plugin" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Install (stays off)" })).toBeNull();
  await user.click(screen.getByText("Advanced: install from a path on this server"));
  const folder = screen.getByRole("textbox", { name: "Folder on this server" });
  await user.type(folder, "  /srv/plugins/metrics  {Enter}");
  expect(await screen.findByRole("heading", { name: "Metrics $& (metrics)" })).toBeInTheDocument();
  expect(preview).toHaveBeenCalledExactlyOnceWith(source);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("heading", { name: "Metrics $& (metrics)" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Preview plugin" }));
  await screen.findByRole("heading", { name: "Metrics $& (metrics)" });
  const replace = screen.getByRole("checkbox", { name: "Replace existing version" });
  await user.click(replace);
  expect(screen.queryByRole("button", { name: "Install (stays off)" })).toBeNull();
  expect(install).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Preview plugin" }));
  expect(preview).toHaveBeenLastCalledWith({ ...source, replace: true });
  const submit = await screen.findByRole("button", { name: "Install (stays off)" });
  await user.click(submit);
  expect(install).toHaveBeenCalledExactlyOnceWith({ ...source, replace: true, expectedDigest: "reviewed-v2" });
  expect(onInstalled).toHaveBeenCalledExactlyOnceWith();
  expect(submit).toBeDisabled();
  expect(screen.queryByText(/^Metrics .* is installed/)).toBeNull();
  await act(async () => { reload.resolve(); });
  expect(screen.getByRole("status")).toHaveTextContent("Metrics $& is installed and switched off. Turn it on in Downloaded.");
  expect(folder).toHaveValue("");
  expect(replace).not.toBeChecked();
});

it.each(["resolve", "reject"] as const)("discards a superseded review %s and keeps installation locked until it settles", async (outcome) => {
  const pending = deferred<{ plugin: PluginInstallPreview }>();
  const preview = vi.fn<PluginInstallPort["preview"]>().mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce({ plugin: { ...pkg, digest: "different", name: "Next" } });
  const install = vi.fn<PluginInstallPort["install"]>();
  const { result } = mount({ preview, install });
  await act(async () => { await result.current.install(); });
  expect(install).not.toHaveBeenCalled();
  act(() => result.current.setFolder({ value: "/srv/plugins/metrics" }));
  let work!: Promise<void>;
  act(() => { work = result.current.review(); });
  const file = zip();
  act(() => result.current.setZipFile({ file }));
  expect(result.current.folder).toBe("");
  await act(async () => { await result.current.review(); });
  expect(preview).toHaveBeenCalledExactlyOnceWith(source);
  await act(async () => {
    if (outcome === "resolve") pending.resolve({ plugin: pkg }); else pending.reject(new Error("old failure"));
    await work;
  });
  expect(result.current).toMatchObject({ busy: false, preview: null, error: null, zipFile: file });
  await act(async () => { await result.current.install(); });
  expect(install).not.toHaveBeenCalled();
  await act(() => result.current.review());
  expect(preview).toHaveBeenLastCalledWith({ source: { kind: "zip", file }, replace: false });
  expect(result.current.previewDisplay?.title).toBe("Next (metrics)");
});

it("does not publish stale success when the source changes during install or its reload", async () => {
  const upload = deferred<{ plugin: PluginInstallPreview }>();
  const reload = deferred<void>();
  const install = vi.fn<PluginInstallPort["install"]>().mockImplementationOnce(() => upload.promise).mockResolvedValueOnce({ plugin: pkg });
  const preview = vi.fn<PluginInstallPort["preview"]>().mockResolvedValue({ plugin: pkg });
  const onInstalled = vi.fn(() => reload.promise);
  const { result } = mount({ preview, install }, onInstalled);
  act(() => result.current.setFolder({ value: "/srv/plugins/metrics" }));
  await act(() => result.current.review());
  let writing!: Promise<void>;
  act(() => { writing = result.current.install(); });
  act(() => result.current.setFolder({ value: "/srv/plugins/other" }));
  await act(async () => { upload.resolve({ plugin: pkg }); await writing; });
  expect(onInstalled).not.toHaveBeenCalled();
  expect(result.current.installedMessage).toBeNull();
  await act(() => result.current.review());
  await act(async () => { writing = result.current.install(); });
  expect(onInstalled).toHaveBeenCalledExactlyOnceWith();
  act(() => result.current.setFolder({ value: "/srv/plugins/third" }));
  await act(async () => { reload.resolve(); await writing; });
  expect(result.current).toMatchObject({ folder: "/srv/plugins/third", installedMessage: null, busy: false, preview: null });
});

it("rejects oversized input but routes dropped and folder-zipped archives through preview", async () => {
  const dropped = zip();
  const generated = new File(["zipped notes"], "generated.zip");
  const oversized = zip();
  Object.defineProperty(oversized, "size", { value: 32 * 1024 * 1024 + 1 });
  const zipping = deferred<File>();
  const zipFolderFiles = vi.fn().mockImplementationOnce(() => zipping.promise).mockRejectedValueOnce("read refused");
  const folderZip = folderZipper(zipFolderFiles);
  const preview = vi.fn<PluginInstallPort["preview"]>().mockResolvedValue({ plugin: pkg });
  const port = { preview, install: vi.fn<PluginInstallPort["install"]>() };
  const onInstalled = vi.fn(async () => {});
  function Panel() { return <AddPluginPanel productName="Acme" controller={usePluginInstall({ ...defaultHost, port, folderZip, onInstalled })} />; }
  render(<Panel />);
  const input = screen.getByLabelText("Upload .zip (max 32 MiB)");
  const picker = vi.fn();
  input.addEventListener("click", picker);
  await userEvent.click(screen.getByRole("button", { name: "Choose a file" }));
  expect(picker).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { files: [oversized] } });
  expect(screen.getByRole("alert")).toHaveTextContent("ZIP exceeds the upload or expanded package size limit.");
  expect(screen.getByRole("button", { name: "Preview plugin" })).toBeDisabled();
  expect(preview).not.toHaveBeenCalled();
  fireEvent.drop(screen.getByText("Drop a .zip here").closest("[aria-busy]")!, { dataTransfer: { files: [dropped] } });
  expect(screen.getByText("metrics.zip")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  const file = new File(["{}"], "plugin.json");
  const folder = screen.getByLabelText("Choose a plugin folder");
  fireEvent.change(folder, { target: { files: [file] } });
  expect(screen.getByRole("button", { name: "Preview plugin" })).toBeDisabled();
  await act(async () => { zipping.resolve(generated); });
  expect(await screen.findByText("generated.zip")).toBeInTheDocument();
  expect(zipFolderFiles).toHaveBeenCalledExactlyOnceWith({ files: [file], maxBytes: 32 * 1024 * 1024 });
  await userEvent.click(screen.getByRole("button", { name: "Preview plugin" }));
  expect(preview).toHaveBeenCalledExactlyOnceWith({ source: { kind: "zip", file: generated }, replace: false });
  fireEvent.change(folder, { target: { files: [file] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not read that folder.");
  expect(screen.queryByRole("button", { name: "Install (stays off)" })).toBeNull();
  expect(screen.getByRole("button", { name: "Preview plugin" })).toBeDisabled();
});

it.each([
  [new InstallRefusal(400, "PLUGIN_CHANGED_SINCE_PREVIEW"), "Package changed. Review it again before installing."],
  [new InstallRefusal(403, "PLUGIN_LOCAL_INSTALL_DISABLED"), "Local folder installs are disabled on this server."],
  [new InstallRefusal(409, "PLUGIN_IN_TRASH"), "This plugin is already in the Trash. Restore or delete it there first."],
  [new InstallRefusal(409, "PLUGIN_ENABLED"), "Turn this plugin off in every workspace before installing."],
  [new InstallRefusal(400, "PLUGIN_PACKAGE_TOO_LARGE"), "ZIP exceeds the upload or expanded package size limit."],
  [new InstallRefusal(413), "ZIP exceeds the upload or expanded package size limit."],
  [new InstallRefusal(409, "UNKNOWN"), "Installation conflicts with an existing plugin. Check its version and replacement option."],
  [new InstallRefusal(400), "Invalid plugin package. Check its manifest, integrity and folder."],
  [new InstallRefusal(500), "Failed to preview plugin."],
  [new InstallRefusal(400, "toString"), "Invalid plugin package. Check its manifest, integrity and folder."],
  ["offline", "Failed to preview plugin."],
] as const)("localizes a failed preview (%#) and leaves no reviewed install", async (failure, message) => {
  const preview = vi.fn<PluginInstallPort["preview"]>().mockRejectedValue(failure);
  const install = vi.fn<PluginInstallPort["install"]>();
  const { result } = mount({ preview, install });
  act(() => result.current.setFolder({ value: source.source.path }));
  await act(() => result.current.review());
  expect(preview).toHaveBeenCalledExactlyOnceWith(source);
  expect(result.current).toMatchObject({ preview: null, error: message, busy: false, reviewDisabled: false });
  await act(() => result.current.install());
  expect(install).not.toHaveBeenCalled();
});

it("clears consent on an install failure and requires a new review before retrying", async () => {
  const preview = vi.fn<PluginInstallPort["preview"]>().mockResolvedValueOnce({ plugin: pkg })
    .mockResolvedValueOnce({ plugin: { ...pkg, digest: "reviewed-v3" } });
  const install = vi.fn<PluginInstallPort["install"]>().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ plugin: pkg });
  const { result } = mount({ preview, install });
  act(() => result.current.setFolder({ value: source.source.path }));
  await act(() => result.current.review());
  await act(() => result.current.install());
  expect(result.current).toMatchObject({ preview: null, error: "Failed to install plugin.", busy: false, folder: source.source.path });
  await act(() => result.current.install());
  expect(install).toHaveBeenCalledExactlyOnceWith({ ...source, expectedDigest: "reviewed-v2" });
  await act(() => result.current.review());
  await act(() => result.current.install());
  expect(install).toHaveBeenLastCalledWith({ ...source, expectedDigest: "reviewed-v3" });
  expect(result.current.installedMessage).toBe("Metrics $& is installed and switched off. Turn it on in Downloaded.");
});
