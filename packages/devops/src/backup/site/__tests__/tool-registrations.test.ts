import { expect, it, vi } from "vitest";
import { indexCatalogById } from "@jini-ai/core";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { buildSiteBackupRegistrations, contributeSiteBackupTools, createSiteBackupCatalog, siteBackupDerivedRisk, type SiteBackupToolDeps } from "../tool-registrations.js";

it("preserves the eight catalog IDs, required fields and independent risk map with injected descriptions", () => {
  const catalog = createSiteBackupCatalog({ importDescription: "Import site", commitDescription: "Commit copy", shareDescription: "Share archive" });
  expect(catalog.map(tool => tool.name)).toEqual(["site_import_backup", "site_import_list", "site_backup_plan", "site_backup_push", "site_share_create", "site_export_static", "site_share_list", "site_share_revoke"]);
  for (const tool of catalog) expect(tool.sideEffects).toBe(siteBackupDerivedRisk.get(tool.name));
  const byId = indexCatalogById({ catalog });
  expect(byId.get("site_import_backup")).toMatchObject({ description: "Import site", inputSchema: { oneOf: [{ required: ["url"] }, { required: ["uploadId"] }] } });
  expect(byId.get("site_backup_plan")).toMatchObject({ inputSchema: { required: ["owner", "repo"], properties: { commitMessage: { description: "Commit copy" } } } });
  expect(byId.get("site_backup_push")).toMatchObject({ inputSchema: { required: ["planId"] } });
  expect(byId.get("site_share_revoke")).toMatchObject({ inputSchema: { required: ["shareId"] } });
  expect(byId.get("site_share_create")?.description).toBe("Share archive");
});

it("authorizes import and share handlers before any backend effect", async () => {
  const importBackup = vi.fn(); const listPage = vi.fn(); const create = vi.fn(); const list = vi.fn(); const revoke = vi.fn();
  const deps = { catalogModule: "site-backup", catalog: indexCatalogById({ catalog: createSiteBackupCatalog({ importDescription: "Import site", commitDescription: "Commit copy", shareDescription: "Share archive" }) }),
    toolMetadata: {}, modelFacingErrors: [], authorize: vi.fn(async () => ({ allowed: false, reason: "denied" })), workspaceId: "w",
    siteImportBackend: { importBackup, listPage }, siteShareBackend: { create, list, revoke } } as unknown as SiteBackupToolDeps;
  const registrations = buildSiteBackupRegistrations(deps, {} as AssistantSurfaceDeps);
  const ctx = { input: {}, principal: { id: "owner" }, signal: new AbortController().signal } as ToolExecutionContext;
  for (const id of ["site_import_backup", "site_import_list", "site_share_create", "site_export_static", "site_share_list", "site_share_revoke"]) {
    const registration = registrations.find(tool => tool.descriptor.id === id);
    if (!registration) throw new Error(`missing ${id}`);
    await expect(registration.handler(ctx)).rejects.toThrow();
  }
  for (const effect of [importBackup, listPage, create, list, revoke]) expect(effect).not.toHaveBeenCalled();
  expect(deps.authorize).toHaveBeenCalledTimes(6);
});

it("binds host service deps at registration without requiring collaborators on aggregate deps", () => {
  const catalog = createSiteBackupCatalog({ importDescription: "Import", commitDescription: "Commit", shareDescription: "Share" });
  const service = {} as SiteBackupToolDeps;
  const readSources = vi.fn();
  Object.defineProperty(service, "siteBackupSources", { get: readSources });
  const bindServiceDeps = vi.fn(() => service);
  const contributor = contributeSiteBackupTools({ catalog, catalogModule: "site-backup", toolMetadata: {}, modelFacingErrors: [],
    parseSiteImportInput: vi.fn(), parseStaticExportInput: vi.fn(), parseSiteImportListQuery: vi.fn(), bindServiceDeps });
  const host = { workspaceId: "workspace" };
  const registrations = contributor.build(host, {} as AssistantSurfaceDeps);
  expect(bindServiceDeps).toHaveBeenCalledWith(host);
  expect(readSources).not.toHaveBeenCalled();
  expect(registrations.map(tool => tool.descriptor.id)).toEqual(catalog.map(tool => tool.name));
});
