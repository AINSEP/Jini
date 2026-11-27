import { expect, test, vi } from "vitest";
import { credentialScopes } from "@jini-ai/integrations/vendor-credentials/project-scope";
import { createSourceControlAgentToolCatalog } from "../agent-tools.js";
import { bindSourceControlTools, buildSourceControlCredentialHandler, buildSourceControlRegistrations, contributeSourceControlTools, type SourceControlToolDeps } from "../tool-registrations.js";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import type { SourceControlCredentialSetRecord } from "@jini-ai/core/contracts/site/source-control-credentials";
import type { SourceControlProviderRegistry } from "../store.js";

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

const commitCommand = { provider: "github", owner: "studio", repo: "website", commitMessage: "Publish", branch: "release/next", folder: "public//copy" };
type Loaded = ReturnType<SourceControlProviderRegistry["list"]>[number];
const github: Loaded = {
  descriptor: { id: "github", label: "GitHub", apiOrigin: "https://git.example", module: "plugin.mjs", maxFileBytes: 50_000 },
  pluginId: "github-provider",
  module: { supportsFolder: true, create: () => { throw new Error("not built by the catalog"); } },
};

function record(providerId: string, id: string, isDefault: boolean): SourceControlCredentialSetRecord {
  return { workspaceId: "site", providerId, id, label: id, isDefault, accountLabel: null, createdAt: "2026-11-01",
    updatedAt: "2026-11-02", sealed: { ciphertext: "only-in-the-vault", keyId: "key", nonce: "nonce", alg: "fixture" } };
}

function commitFixture({ hosts = [github], rows = [], switchedOff = new Map<string, string>(), pluginAdapter = false }: {
  hosts?: Loaded[]; rows?: SourceControlCredentialSetRecord[]; switchedOff?: ReadonlyMap<string, string>; pluginAdapter?: boolean;
} = {}) {
  const f = fixture();
  const repo = {
    ...f.deps.sourceControlCredentialSetRepo,
    listByProvider: vi.fn<SourceControlToolDeps["sourceControlCredentialSetRepo"]["listByProvider"]>(async ({ workspaceId, providerId }) =>
      rows.filter(row => row.workspaceId === workspaceId && row.providerId === providerId)),
    listByWorkspace: vi.fn<SourceControlToolDeps["sourceControlCredentialSetRepo"]["listByWorkspace"]>(async ({ workspaceId }) =>
      rows.filter(row => row.workspaceId === workspaceId)),
  };
  const loadSourceControlProviders = vi.fn<SourceControlToolDeps["loadSourceControlProviders"]>(async ({ workspaceId }) => {
    if (workspaceId !== "site") throw new Error(`Unexpected catalog workspace ${workspaceId}`);
    return { list: () => hosts, get: ({ providerId }) => hosts.find(item => item.descriptor.id === providerId), switchedOff, refusals: [] };
  });
  const describeByLabel = vi.fn<NonNullable<SourceControlToolDeps["sourceControlSavedKeys"]>["describeByLabel"]>(async () => null);
  const resolveByLabel = vi.fn<NonNullable<SourceControlToolDeps["sourceControlSavedKeys"]>["resolveByLabel"]>(async () => null);
  const commit = vi.fn<NonNullable<SourceControlToolDeps["gitAdapter"]>["commit"]>();
  const previewCommitExport = vi.fn<SourceControlToolDeps["previewCommitExport"]>();
  const commitSiteToSourceControl = vi.fn<SourceControlToolDeps["commitSiteToSourceControl"]>();
  const switchedOffPluginSentence = vi.fn<SourceControlToolDeps["switchedOffPluginSentence"]>(({ pluginIds }) => `enable ${pluginIds.join(", ")}.`);
  const { gitAdapter: _fixtureAdapter, ...base } = f.deps;
  const buildSourceControlProvider = vi.fn<SourceControlToolDeps["buildSourceControlProvider"]>();
  const deps: SourceControlToolDeps = { ...base, loadSourceControlProviders, sourceControlCredentialSetRepo: repo,
    sourceControlSavedKeys: { describeByLabel, resolveByLabel }, ...(!pluginAdapter ? { gitAdapter: { commit } } : {}),
    buildSourceControlProvider, previewCommitExport, commitSiteToSourceControl, switchedOffPluginSentence };
  const run = (toolId: string, input: unknown, overrides: Partial<SourceControlToolDeps> = {}) => {
    const tool = buildSourceControlRegistrations({ ...deps, ...overrides }, f.surfaces).find(item => item.descriptor.id === toolId)!;
    return tool.handler({ ...f.ctx, input });
  };
  return { ...f, deps, repo, loadSourceControlProviders, buildSourceControlProvider, describeByLabel, resolveByLabel, commit, commitSiteToSourceControl, previewCommitExport, switchedOffPluginSentence,
    run, execute: (input: unknown = commitCommand, overrides?: Partial<SourceControlToolDeps>) => run("source_control_execute_commit", input, overrides) };
}

test.each([
  ["non-string branch", { branch: 17 }, "source_control_execute_commit: 'branch' must be a string when provided"],
  ["noncanonical folder", { folder: "public/../private" }, "source_control_execute_commit: Target folder cannot contain . or .. segments."],
  ["invalid named branch", { branch: "release/.hidden" }, "source_control_execute_commit: invalid branch name 'release/.hidden'"],
] as const)("a %s cannot reach preview or commit", async (_name, patch, message) => {
  const f = commitFixture();
  await expect(f.execute({ ...commitCommand, ...patch, dryRun: true })).rejects.toThrow(new ToolInputError({ message }));
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.previewCommitExport).not.toHaveBeenCalled();
  expect(f.commitSiteToSourceControl).not.toHaveBeenCalled();
});

test("uses the declared provider's target validator and preserves a typed preview failure", async () => {
  const validateTarget = vi.fn(({ owner }: { owner: string; repo: string }) => owner === "studio" ? null : "Owner must be studio");
  const f = commitFixture({ hosts: [{ ...github, module: { ...github.module, validateTarget } }] });
  await expect(f.execute({ ...commitCommand, owner: "personal", dryRun: true }))
    .rejects.toThrow(new ToolInputError({ message: "source_control_execute_commit: Owner must be studio" }));
  expect(validateTarget).toHaveBeenCalledExactlyOnceWith({ owner: "personal", repo: "website" });
  expect(f.previewCommitExport).not.toHaveBeenCalled();
  f.previewCommitExport.mockResolvedValueOnce({ ok: false, code: "EXPORT_FAILED", message: "Unable to package the export." });
  expect(await f.execute({ ...commitCommand, dryRun: true })).toEqual({
    dryRun: true, committed: false, owner: "studio", repo: "website", branch: "release/next",
    credentialConfigured: false, code: "EXPORT_FAILED", message: "Unable to package the export.",
  });
  expect(f.previewCommitExport).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "site", sourceControlExportRootDir: "/export", idGen: f.deps.idGen, staticSiteContext: f.deps.staticSiteContext,
    exportSiteBound: f.deps.exportSiteBound, packager: f.deps.staticSitePackager,
    owner: "studio", repo: "website", branch: "release/next", folder: "public/copy", commitMessage: "Publish",
  }, { providerId: "github", validateTarget });
  expect(f.resolveByLabel).not.toHaveBeenCalled();
  expect(f.commitSiteToSourceControl).not.toHaveBeenCalled();
});

test("allows a saved-only host lookup only after authorization and reports unknown hosts with enabled choices", async () => {
  const f = commitFixture({ rows: [record("retired", "old-key", true)] });
  f.authorize.mockResolvedValueOnce({ allowed: false, reason: "no grant" });
  await expect(f.execute({ ...commitCommand, provider: "retired" })).rejects.toThrow("not authorized");
  expect(f.repo.listByProvider).not.toHaveBeenCalled();
  expect(await f.execute({ ...commitCommand, provider: "retired" })).toEqual({
    committed: false, reason: "folder-unsupported",
    message: "retired does not support folder commits. Update its provider before selecting a folder.",
  });
  expect(f.repo.listByProvider).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", providerId: "retired" });
  await expect(f.execute({ ...commitCommand, provider: "unknown" })).rejects.toThrow(new ToolInputError({
    message: "source_control_execute_commit: 'unknown' is not a source control host. Hosts: 'github' (see source_control_get_capabilities).",
  }));
  expect(f.commitSiteToSourceControl).not.toHaveBeenCalled();
});

test("a real commit refuses missing credentials and does not choose a saved key over ambiguous explicit identities", async () => {
  const noKey = commitFixture();
  expect(await noKey.execute()).toEqual({
    committed: false, reason: "no-credential", message: "No GitHub source control credential is configured for this workspace. Call credential_save with kind source-control to open a human credential form before committing.",
  });
  expect(noKey.describeByLabel).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", label: "github" });
  expect(noKey.commitSiteToSourceControl).not.toHaveBeenCalled();
  const ambiguous = commitFixture({ rows: [record("github", "first", false), record("github", "second", false)] });
  ambiguous.describeByLabel.mockResolvedValue({ label: "github" });
  expect(await ambiguous.execute()).toMatchObject({ committed: false, reason: "no-credential" });
  expect(ambiguous.describeByLabel).not.toHaveBeenCalled();
  expect(ambiguous.resolveByLabel).not.toHaveBeenCalled();
  expect(ambiguous.commitSiteToSourceControl).not.toHaveBeenCalled();
});

test("reports enabled, disabled and saved-only provider guidance without opening a token", async () => {
  const f = commitFixture({
    rows: [record("legacy", "legacy-key", true)],
    switchedOff: new Map([["off", "provider-off"], ["legacy", "provider-legacy"]]),
  });
  const expected = {
    providers: [
      { providerId: "github", label: "GitHub", apiOrigin: "https://git.example", maxFileBytes: 50_000, configured: false,
        commitSupported: true, supportsFolder: true, savedCredentials: [],
        guidance: "No github credential is saved yet. First tell the person what is needed and ask which repository (owner/name) to use: for a site backup it must be private and already have at least one commit (for example a README), and the token needs Contents read and write on it. Then call credential_save with kind source-control to open the human credential form." },
      { providerId: "off", configured: false, commitSupported: false, supportsFolder: false, savedCredentials: [],
        guidance: "No off credential is saved, and no enabled Agent Plugin supports committing to off: enable provider-off." },
      { providerId: "legacy", configured: true, commitSupported: false, supportsFolder: false,
        savedCredentials: [{ id: "legacy-key", label: "legacy-key", isDefault: true, createdAt: "2026-11-01", updatedAt: "2026-11-02" }],
        guidance: "A legacy credential is saved, but no enabled Agent Plugin supports committing to legacy: enable provider-legacy." },
    ],
  };
  expect(await f.run("source_control_get_capabilities", {})).toEqual(expected);
  expect(f.switchedOffPluginSentence.mock.calls).toEqual([[{ pluginIds: ["provider-off"] }], [{ pluginIds: ["provider-legacy"] }]]);
  expect(f.describeByLabel).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", label: "github" });
  expect(f.resolveByLabel).not.toHaveBeenCalled();
});

test("maps a real commit's safe result and supplies only the selected saved API key to the commit port", async () => {
  const f = commitFixture();
  f.describeByLabel.mockImplementation(async input => input.workspaceId === "site" && input.label === "github" ? { label: "github" } : null);
  f.resolveByLabel.mockImplementation(async input => input.workspaceId === "site" && input.label === "github"
    ? { connection: { token: "private-fixture-token" } } : null);
  const observed: unknown[] = [];
  f.commitSiteToSourceControl.mockImplementation(async ({ credentialDeps }, input) => {
    observed.push(await credentialDeps.resolveSavedApiKey({ workspaceId: input.workspaceId, providerId: "unbound" }));
    observed.push(await credentialDeps.resolveSavedApiKey({ workspaceId: input.workspaceId, providerId: "github" }));
    return { ok: true, owner: "studio", repo: "website", folder: "public/copy", entryPath: "public/copy/index.html",
      branch: "release/next", branchCreated: true, commitSha: "abc123", commitUrl: "https://git.example/studio/website/commit/abc123",
      filesChanged: 3, filesDeleted: 1, divergedPaths: ["public/copy/keep.html"] };
  });
  expect(await f.execute()).toEqual({
    committed: true, owner: "studio", repo: "website", folder: "public/copy", entryPath: "public/copy/index.html",
    branch: "release/next", branchCreated: true, commitSha: "abc123", commitUrl: "https://git.example/studio/website/commit/abc123",
    filesChanged: 3, filesDeleted: 1, divergedPaths: ["public/copy/keep.html"],
  });
  expect(observed).toEqual([null, { token: "private-fixture-token" }]);
  expect(f.resolveByLabel).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", label: "github" });
  expect(f.commitSiteToSourceControl).toHaveBeenCalledExactlyOnceWith({
    providerId: "github", supportsFolder: true, gitAdapter: { commit: f.commit },
    credentialDeps: { deps: f.deps.deps, repo: f.repo, sealer: f.deps.siteAssistantSecretSealer, resolveSavedApiKey: expect.any(Function) },
  }, {
    workspaceId: "site", sourceControlExportRootDir: "/export", idGen: f.deps.idGen, staticSiteContext: f.deps.staticSiteContext,
    exportSiteBound: f.deps.exportSiteBound, packager: f.deps.staticSitePackager,
    owner: "studio", repo: "website", branch: "release/next", folder: "public/copy", commitMessage: "Publish",
  });
});

test("passes through a commit refusal without turning it into a successful publication", async () => {
  const f = commitFixture({ rows: [record("github", "explicit-key", true)] });
  f.commitSiteToSourceControl.mockResolvedValueOnce({ ok: false, code: "DIVERGED_BRANCH", message: "The branch moved. No files were overwritten." });
  expect(await f.execute()).toEqual({ committed: false, cancelled: false, code: "DIVERGED_BRANCH", message: "The branch moved. No files were overwritten." });
  expect(f.describeByLabel).not.toHaveBeenCalled();
});

test("the contributor builds the tools and its credential handler still rejects unexpected model fields", async () => {
  const f = commitFixture();
  const contributor = contributeSourceControlTools();
  expect(contributor.domain).toBe("source-control");
  expect(contributor.build(f.deps, f.surfaces).map(tool => tool.descriptor.id).sort()).toEqual([
    "source_control_execute_commit", "source_control_get_capabilities",
  ]);
  const handler = buildSourceControlCredentialHandler({ deps: f.deps, surfaces: f.surfaces });
  await expect(handler({ ...f.ctx, input: { provider: "github", unexpected: "not-a-model-field" } })).rejects.toThrow(
    new ToolInputError({ message: "source_control_propose_credential accepts only provider and label; enter secrets in the human form." }),
  );
  expect(f.loadSourceControlProviders).not.toHaveBeenCalled();
  expect(f.authorize).not.toHaveBeenCalled();
});

test("refuses a real commit if the enabled provider cannot be built", async () => {
  const f = commitFixture({ pluginAdapter: true, rows: [record("github", "explicit-key", true)] });
  f.buildSourceControlProvider.mockResolvedValueOnce({ ok: false, message: "Provider module unavailable." });
  expect(await f.execute()).toEqual({ committed: false, reason: "no-provider", message: "Provider module unavailable." });
  expect(f.buildSourceControlProvider).toHaveBeenCalledExactlyOnceWith({ load: f.loadSourceControlProviders, workspaceId: "site", providerId: "github" });
  expect(f.resolveByLabel).not.toHaveBeenCalled();
  expect(f.commitSiteToSourceControl).not.toHaveBeenCalled();
});

test("reports a provider-owned key by its credential source without opening it or reporting it as a legacy row", async () => {
  const f = commitFixture({ rows: [record("github", "old-duplicate", true)] });
  const describe = vi.fn(async () => null);
  Object.assign(f.repo, { canonical: {
    supports: ({ providerId }: { providerId: string }) => providerId === "github",
    describe, list: async () => [],
  } });
  f.describeByLabel.mockResolvedValueOnce({ label: "github" }).mockResolvedValueOnce({ label: "github" });
  expect(await f.run("source_control_get_capabilities", {})).toEqual({ providers: [{
    providerId: "github", label: "GitHub", apiOrigin: "https://git.example", maxFileBytes: 50_000,
    configured: true, credentialSource: "saved-api-key", commitSupported: true, supportsFolder: true, savedCredentials: [],
  }] });
  f.previewCommitExport.mockResolvedValueOnce({ ok: true, fileCount: 0, totalBytes: 0, paths: [] });
  expect(await f.execute({ ...commitCommand, dryRun: true })).toMatchObject({ dryRun: true, credentialConfigured: true });
  expect(f.describeByLabel.mock.calls).toEqual([[{ workspaceId: "site", label: "github" }], [{ workspaceId: "site", label: "github" }]]);
  expect(describe).not.toHaveBeenCalled();
  expect(f.resolveByLabel).not.toHaveBeenCalled();
});
