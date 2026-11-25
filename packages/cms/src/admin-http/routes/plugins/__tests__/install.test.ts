import { expect, it, vi } from "vitest";
import { folderPluginInstallPreviewRoute, folderPluginInstallRoute, zipPluginInstallPreviewRoute, zipPluginInstallRoute } from "../install.js";
import type { PluginInstallPreview } from "@jini-ai/core/contracts/site/host-node";

it("all four operations use their own input source and apply requires a reviewed digest before any upload read", async () => {
  const plugin = { id: "p" } as PluginInstallPreview;
  const preview = vi.fn(async () => plugin); const install = vi.fn(async () => plugin);
  const readZipUpload = vi.fn(async () => ({ ok: true as const, archive: new Uint8Array([1]) }));
  const onInstalled = vi.fn(); const authorize = vi.fn(async () => {});
  const deps = { installer: () => ({ preview, install }), readZipUpload, onInstalled };
  const context = { id: "owner" };
  const digest = `sha256-${"a".repeat(64)}`;
  await folderPluginInstallPreviewRoute.handle({ input: { body: { source: { kind: "folder", path: " folder " } }, query: {} }, deps, context, authorize });
  expect(preview).toHaveBeenLastCalledWith({ sourceDir: " folder ", replace: false });
  expect(install).not.toHaveBeenCalled(); expect(onInstalled).not.toHaveBeenCalled();
  await folderPluginInstallRoute.handle({ input: { body: { source: { kind: "folder", path: "f" }, expectedDigest: digest, replace: true }, query: {} }, deps, context, authorize });
  expect(install).toHaveBeenLastCalledWith({ sourceDir: "f", replace: true, expectedDigest: digest });
  await zipPluginInstallPreviewRoute.handle({ raw: { body: { replace: true }, query: { replace: "false" }, params: {} }, deps, context, authorize });
  expect(preview).toHaveBeenLastCalledWith({ archive: new Uint8Array([1]), replace: false });
  readZipUpload.mockClear();
  const invalid = await zipPluginInstallRoute.handle({ raw: { body: { expectedDigest: digest }, query: {}, params: {} }, deps, context, authorize });
  expect(invalid.status).toBe(400); expect(readZipUpload).not.toHaveBeenCalled();
  await zipPluginInstallRoute.handle({ raw: { body: undefined, query: { expectedDigest: digest, replace: "true" }, params: {} }, deps, context, authorize });
  expect(install).toHaveBeenLastCalledWith({ archive: new Uint8Array([1]), replace: true, expectedDigest: digest });
  expect(authorize).toHaveBeenCalledWith({ permission: "admin.plugins.enable" });
});

it("missing installer beats parser refusal", async () => {
  const readZipUpload = vi.fn(async () => ({ ok: false as const, refusal: { status: 413, code: "large", error: "large" } }));
  const response = await zipPluginInstallRoute.handle({ raw: { body: undefined, query: {}, params: {} }, deps: { installer: () => undefined, readZipUpload, onInstalled: () => {} }, context: { id: "owner" }, authorize: async () => {} });
  expect(response.status).toBe(403); expect(readZipUpload).not.toHaveBeenCalled();
});
