import { expect, test, vi } from "vitest";
import { credentialScopes } from "@jini-ai/integrations/vendor-credentials/project-scope";
import { createSourceControlAgentToolCatalog } from "../agent-tools.js";
import { bindSourceControlTools, type SourceControlToolDeps } from "../tool-registrations.js";
import type { ToolExecutionContext } from "@jini-ai/core";

function fixture() {
  const catalog = createSourceControlAgentToolCatalog({ credentialSaveToolId: "credential_save" });
  const commitSiteToSourceControl = vi.fn(async () => ({ ok: true }));
  const previewCommitExport = vi.fn(async () => ({ ok: true, fileCount: 1, totalBytes: 4, paths: ["index.html"] }));
  const open = vi.fn();
  const askThenReport = vi.fn();
  const authorize = vi.fn(async () => ({ allowed: true, reason: "grant" }));
  const descriptor = { id: "git", label: "Git", apiOrigin: "https://git.example" };
  const deps = { deps: { credentialScopes }, workspaceId: "site", authorize, sourceControlExportRootDir: "/export", idGen: { newId: () => "id" }, staticSitePackager: { entryFile: "index.html" },
    loadSourceControlProviders: async () => ({ get: () => ({ descriptor, module: { supportsFolder: true } }), list: () => [{ descriptor }], refusals: [] }),
    sourceControlCredentialSetRepo: { listByProvider: async () => [{ id: "key", label: "label", providerId: "git", isDefault: true }], listByWorkspace: async () => [{ id: "key", label: "label", providerId: "git", isDefault: true }] },
    catalog: new Map(catalog.map(tool => [tool.name, tool])), previewCommitExport, commitSiteToSourceControl,
    siteAssistantSecretSealer: { open }, askThenReport, switchedOffPluginSentence: () => "", gitAdapter: { commit: vi.fn() },
  } as unknown as SourceControlToolDeps;
  const binding = bindSourceControlTools({ deps: deps.deps, catalog: deps.catalog, switchedOffPluginSentence: deps.switchedOffPluginSentence,
    buildSourceControlProvider: deps.buildSourceControlProvider, previewCommitExport: deps.previewCommitExport, commitSiteToSourceControl: deps.commitSiteToSourceControl,
    defineSecretCardTool: deps.defineSecretCardTool, applyPluginCredentialCard: deps.applyPluginCredentialCard,
    findPluginCredentialCard: deps.findPluginCredentialCard, askThenReport: deps.askThenReport,
    credentialSaveToolId: deps.credentialSaveToolId, credentialFormUriHost: deps.credentialFormUriHost,
    backupRepositoryRules: deps.backupRepositoryRules, credentialText: deps.credentialText, formatCredentialHint: deps.formatCredentialHint,
    reportCredentialFailure: deps.reportCredentialFailure, assertCredentialFreeField: deps.assertCredentialFreeField,
    isProjectKeyCreateConflictError: deps.isProjectKeyCreateConflictError });
  const surfaces = { surfaceExchanges: {} as never };
  const tools = binding.buildSourceControlRegistrations(deps, surfaces);
  const ctx: ToolExecutionContext = { executionId: "e", principal: { id: "human" }, run: { id: "run" }, signal: new AbortController().signal,
    input: { provider: "git", owner: "owner", repo: "repo", commitMessage: "Export", dryRun: true } };
  return { catalog, tools, ctx, authorize, open, askThenReport, previewCommitExport, commitSiteToSourceControl, binding, deps, surfaces };
}

test("the full catalog has both tools and uses the supplied credential guidance ID", () => {
  const catalog = createSourceControlAgentToolCatalog({ credentialSaveToolId: "save_connection" });
  expect(catalog.map(tool => tool.name)).toEqual(["source_control_get_capabilities", "source_control_execute_commit"]);
  expect(catalog[0]!.description).toContain("call save_connection with kind source-control");
  expect(catalog[1]!.sideEffects).toBe("mutates-durable-state");
  const f = fixture();
  expect(f.binding.contributeSourceControlTools().build(f.deps, f.surfaces).map(tool => tool.descriptor.id)).toEqual(f.tools.map(tool => tool.descriptor.id));
});

test("capabilities report credential presence without opening a secret", async () => {
  const f = fixture();
  const result = await f.tools[0]!.handler({ ...f.ctx, input: {} });
  expect(result).toMatchObject({ providers: [{ providerId: "git", configured: true, commitSupported: true, savedCredentials: [{ id: "key", label: "label", isDefault: true }] }] });
  expect(f.open).not.toHaveBeenCalled();
  expect(f.commitSiteToSourceControl).not.toHaveBeenCalled();
});

test("dry-run previews without confirmation or committing", async () => {
  const f = fixture();
  expect(await f.tools[1]!.handler(f.ctx)).toMatchObject({ fileCount: 1, paths: ["index.html"], note: "Nothing was sent. Call again without dryRun to commit." });
  expect(f.previewCommitExport).toHaveBeenCalledTimes(1);
  expect(f.askThenReport).not.toHaveBeenCalled();
  expect(f.commitSiteToSourceControl).not.toHaveBeenCalled();
});

test("denied and abandoned requests do not commit", async () => {
  const f = fixture();
  f.authorize.mockResolvedValueOnce({ allowed: false, reason: "denied" });
  await expect(f.tools[1]!.handler({ ...f.ctx, input: { ...f.ctx.input as object, dryRun: false } })).rejects.toThrow("not authorized");
  const abort = new AbortController(); abort.abort();
  expect(await f.tools[1]!.handler({ ...f.ctx, signal: abort.signal, input: { ...f.ctx.input as object, dryRun: false } })).toEqual({ committed: false, cancelled: false, reason: "abandoned" });
  expect(f.commitSiteToSourceControl).not.toHaveBeenCalled();
});
