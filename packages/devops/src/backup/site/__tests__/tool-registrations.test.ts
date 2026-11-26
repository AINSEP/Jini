import { expect, it, vi } from "vitest";
import { indexCatalogById } from "@jini-ai/core";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { bindSiteBackupTools, createSiteBackupCatalog, siteBackupDerivedRisk, type SiteBackupToolDeps } from "../tool-registrations.js";

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
  const bound = bindSiteBackupTools({ importDescription: "Import site", commitDescription: "Commit copy", shareDescription: "Share archive",
    catalogModule: "site-backup", toolMetadata: {}, modelFacingErrors: [], resolveDeps: ({ deps }: { deps: SiteBackupToolDeps }) => deps,
    planSiteBackup: vi.fn(), pushSiteBackup: vi.fn(), parseStaticExportInput: vi.fn(), parseSiteImportInput: vi.fn(), parseSiteImportListQuery: vi.fn() });
  const registrations = bound.buildSiteBackupRegistrations({ deps, surfaces: {} as AssistantSurfaceDeps });
  const ctx = { input: {}, principal: { id: "owner" }, signal: new AbortController().signal } as ToolExecutionContext;
  for (const id of ["site_import_backup", "site_import_list", "site_share_create", "site_export_static", "site_share_list", "site_share_revoke"]) {
    const registration = registrations.find(tool => tool.descriptor.id === id);
    if (!registration) throw new Error(`missing ${id}`);
    await expect(registration.handler(ctx)).rejects.toThrow();
  }
  for (const effect of [importBackup, listPage, create, list, revoke]) expect(effect).not.toHaveBeenCalled();
  expect(deps.authorize).toHaveBeenCalledTimes(6);
});

it("resolves live request deps once per dispatch and push poll (mutation: resolve-deps-at-registration)", async () => {
  const copy = { importDescription: "Import", commitDescription: "Commit", shareDescription: "Share" };
  const mounted = { current: { workspaceId: "first", authorize: vi.fn(async () => ({ allowed: true, reason: "test" })) } };
  const first = mounted.current;
  const resolveDeps = vi.fn(({ deps }: { deps: typeof mounted; ctx: ToolExecutionContext }) => deps.current);
  const planSiteBackup = vi.fn(async (_required: { deps: typeof first; call: ToolExecutionContext }, _optional: Record<string, never>) => ({ planned: true }));
  const pushSiteBackup = vi.fn(async (_required: { deps: typeof first; call: ToolExecutionContext }, _optional: Record<string, never>) => ({ pushed: false as const, cancelled: true as const }));
  const bound = bindSiteBackupTools({ ...copy, catalogModule: "site-backup", toolMetadata: {}, modelFacingErrors: [], resolveDeps,
    parseSiteImportInput: vi.fn(), parseStaticExportInput: vi.fn(), parseSiteImportListQuery: vi.fn(), planSiteBackup, pushSiteBackup });
  const contributor = bound.contributeSiteBackupTools({}, {});
  const registrations = contributor.build(mounted, {} as AssistantSurfaceDeps);
  expect(resolveDeps).not.toHaveBeenCalled(); expect(contributor.risk).toBe(siteBackupDerivedRisk);
  const prior = createSiteBackupCatalog(copy);
  expect(bound.siteBackupAgentToolCatalog).toEqual(prior);
  expect(registrations.map(tool => tool.descriptor.id)).toEqual(prior.map(tool => tool.name));
  const contexts = ["first", "second"].map(id => ({ input: {}, principal: { id }, signal: new AbortController().signal } as ToolExecutionContext));
  for (const id of ["site_backup_plan", "site_backup_push"]) {
    const handler = registrations.find(tool => tool.descriptor.id === id)!.handler;
    mounted.current = first;
    await handler(contexts[0]!);
    const second = { workspaceId: "second", authorize: vi.fn(async () => ({ allowed: false, reason: "denied" })) };
    mounted.current = second;
    await handler(contexts[1]!);
    const operation = id === "site_backup_plan" ? planSiteBackup : pushSiteBackup;
    expect(operation.mock.calls).toEqual([[{ deps: first, call: contexts[0] }, {}], [{ deps: second, call: contexts[1] }, {}]]);
    expect(operation.mock.calls[0]?.[0].deps).toBe(first); expect(operation.mock.calls[1]?.[0].deps).toBe(second);
  }
  expect(resolveDeps).toHaveBeenCalledTimes(4);
  for (const [index, ctx] of [contexts[0], contexts[1], contexts[0], contexts[1]].entries()) {
    expect(resolveDeps.mock.calls[index]?.[0].deps).toBe(mounted); expect(resolveDeps.mock.calls[index]?.[0].ctx).toBe(ctx);
  }
});

it("dispatches import and share with live backends without constructing backup services", async () => {
  const listPage = vi.fn(async () => ({ imports: [] })); const list = vi.fn(async () => []);
  const authorize = vi.fn(async () => ({ allowed: true, reason: "test" }));
  const deps: SiteBackupToolDeps = { workspaceId: "workspace", authorize, siteImportBackend: { importBackup: vi.fn(), listPage }, siteShareBackend: { create: vi.fn(), list, revoke: vi.fn() } };
  const resolveDeps = vi.fn(({ deps }: { deps: SiteBackupToolDeps; ctx: ToolExecutionContext }) => deps);
  const planSiteBackup = vi.fn(); const pushSiteBackup = vi.fn();
  const bound = bindSiteBackupTools({ importDescription: "Import", commitDescription: "Commit", shareDescription: "Share",
    catalogModule: "site-backup", toolMetadata: {}, modelFacingErrors: [], resolveDeps, planSiteBackup, pushSiteBackup,
    parseSiteImportInput: vi.fn(), parseStaticExportInput: vi.fn(), parseSiteImportListQuery: () => ({ ok: true as const, value: {} }) });
  const registrations = bound.buildSiteBackupRegistrations({ deps, surfaces: {} as AssistantSurfaceDeps }, {});
  const ctx = { input: {}, principal: { id: "owner" }, signal: new AbortController().signal } as ToolExecutionContext;
  expect(resolveDeps).not.toHaveBeenCalled();
  expect(await registrations.find(tool => tool.descriptor.id === "site_import_list")!.handler(ctx)).toEqual({ imports: [] });
  expect(await registrations.find(tool => tool.descriptor.id === "site_share_list")!.handler(ctx)).toEqual({ shares: [] });
  Object.assign(deps, { authorize: vi.fn(async () => ({ allowed: false, reason: "denied" })) });
  await expect(registrations.find(tool => tool.descriptor.id === "site_share_list")!.handler(ctx)).rejects.toThrow();
  expect(resolveDeps).toHaveBeenCalledTimes(3); expect(listPage).toHaveBeenCalledOnce(); expect(list).toHaveBeenCalledOnce();
  expect(planSiteBackup).not.toHaveBeenCalled(); expect(pushSiteBackup).not.toHaveBeenCalled();
});
