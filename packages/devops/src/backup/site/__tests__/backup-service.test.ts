import { CustomCredentialValidationError } from "@jini-ai/integrations/credentialed-http/sets";
import { buildAuthorizationHeader } from "@jini-ai/integrations/credentialed-http";
import { normalizeWriteFilePath, validateBranch, validateCommitMessage } from "@jini-ai/integrations/custom-credentials/write-files-validation";
import { expect, it, vi } from "vitest";
import { createNoopObservabilityPort } from "@jini-ai/core/contracts/observability";
import { SiteShareRefusal } from "../share-refusal.js";
import type { PlannedDiskFile } from "../sources.js";
import { createSiteBackupService, planSiteBackup, pushSiteBackup, type SiteBackupToolDeps, type SiteBackupPlan, type SiteBackupRequestDeps, type SiteBackupRepositoryPlanContent } from "../backup-service.js";
import { SiteBackupPushJobs } from "../../push-jobs.js";
import { SiteBackupPlanStore } from "../../plan-store.node.js";
import { inProgressResult, pushWaitBudget, runObservedBackupPush } from "../backup-service.push.js";
import { providerRefusal } from "../backup-service.shared.js";

import { initialPushProgress, uploadBackupPlan, commitBackupPlan } from "../push-content.js";
import type { SiteBackupSources } from "../sources.js";
import { resolveBackupCredential } from "../backup-service.credentials.js";
import { findReservedPath, pickSourceControlProviderForApi } from "../../../source-control/registry.js";
import { SITE_BACKUP_SCOPES } from "../sources.js";

function fixture() {
  const commitBackupTree = vi.fn();
  const uploadBackupBlob = vi.fn();
  const repository = { branch: "main", parentCommitSha: "reviewed", baseTreeSha: "tree", htmlUrl: "https://git.example/repo", folderExists: true };
  const provider = { id: "git", label: "Git", apiOrigin: "https://git.example", inspectBackupRepository: vi.fn(async () => ({ ok: true, state: repository })), uploadBackupBlob, commitBackupTree };
  const plan = { planId: "plan", principalId: "owner", workspaceId: "w", expiresAtMs: Date.now() + 100000, credentialLabel: "key", owner: "owner", repo: "repo", folder: "site", commitMessage: "Backup", repository: { ...repository }, include: {}, database: { bytes: Buffer.from("snapshot"), watermarkAtCapture: 1 }, files: [], skipped: [], scopeNotes: {}, totalBytes: 8, credentialWarnings: [], site: { name: "Site", folderName: "site" }, schema: { index: 1, tag: "one" }, createdAt: "now" } as unknown as SiteBackupPlan;
  const captureDatabaseSnapshot = vi.fn(); const collectSiteBackupFiles = vi.fn();
  const save = vi.fn();
  const request = { workspaceId: "w", authorize: async () => ({ allowed: true }), dbOps: {}, siteBackupSources: { siteDir: "/site" } } as unknown as SiteBackupRequestDeps;
  const deps = { request, deps: { findReservedPath, CustomCredentialValidationError, buildAuthorizationHeader, normalizeWriteFilePath, validateBranch, validateCommitMessage }, initialPushProgress, uploadBackupPlan, commitBackupPlan, siteBackupScopes: SITE_BACKUP_SCOPES, siteFolderName: () => "site",
    pickSourceControlProviderForApi, buildSourceControlProviders: async () => ({ providers: [provider], refusals: [], noProviderMessage: "none" }),
    listCustomCredentials: async () => [{ label: "key", baseUrl: "https://git.example" }], resolveCustomCredentialByLabel: async () => ({ baseUrl: "https://git.example", connection: { token: "token" } }),
    validateRepositoryTarget: (input: unknown) => input, captureDatabaseSnapshot, collectSiteBackupFiles, siteBackupPlanStore: { save, take: () => ({ ok: true, plan }) }, siteBackupPushJobs: new SiteBackupPushJobs({}),
    cancelled: { ok: false, code: "CANCELLED", message: "Cancelled" }, siteBackupFailureLog: vi.fn(), isCustomCredentialSecretStoreUnconfiguredError: () => false,
  } as unknown as SiteBackupToolDeps;
  return { deps, plan, provider, repository, captureDatabaseSnapshot, collectSiteBackupFiles, save, uploadBackupBlob, commitBackupTree };
}

it("a private-target refusal precedes snapshot, collection and plan writes", async () => {
  const f = fixture();
  f.provider.inspectBackupRepository.mockResolvedValueOnce({ ok: false, code: "repo-not-private", message: "Private repository required" } as never);
  expect(await planSiteBackup({ deps: f.deps, call: { input: { owner: "owner", repo: "repo" }, principal: { id: "owner" }, signal: new AbortController().signal } })).toEqual({ planned: false, code: "REPOSITORY_NOT_PRIVATE", message: "Private repository required" });
  expect(f.captureDatabaseSnapshot).not.toHaveBeenCalled(); expect(f.collectSiteBackupFiles).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});

it("a reserved backup folder is refused before repository inspection, snapshot, collection or plan writes", async () => {
  const f = fixture();
  Object.assign(f.provider, { reservedPaths: [".fixture"] });
  const result = planSiteBackup({ deps: f.deps, call: { input: { owner: "owner", repo: "repo", folder: ".fixture/backup" }, principal: { id: "owner" }, signal: new AbortController().signal } });
  await expect(result).rejects.toBeInstanceOf(CustomCredentialValidationError);
  await expect(result).rejects.toMatchObject({ message: "the backup folder must not be inside '.fixture': '.fixture/backup'" });
  expect(f.provider.inspectBackupRepository).not.toHaveBeenCalled();
  expect(f.captureDatabaseSnapshot).not.toHaveBeenCalled();
  expect(f.collectSiteBackupFiles).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it("a fresh parent SHA change refuses before uploads or a commit (mutation: backup-recheck-parent)", async () => {
  const f = fixture(); f.repository.parentCommitSha = "changed";
  f.uploadBackupBlob.mockResolvedValue({ ok: true, blob: { blobSha: "blob" } });
  f.commitBackupTree.mockResolvedValue({ ok: true, commitSha: "commit", commitUrl: "https://git.example/commit" });
  const deps = { ...f.deps, backupPushUploadPolicy: () => ({ databasePath: "database/content.db", readPlannedFile: vi.fn(),
    buildManifest: () => ({ path: "backup.json", content: Buffer.from("manifest") }), cancelled: f.deps.cancelled }) };
  expect(await pushSiteBackup({ deps, call: { input: { planId: "plan" }, principal: { id: "owner" }, signal: new AbortController().signal } }, { waitMs: 1000 })).toMatchObject({ pushed: false, code: "DIVERGED_BRANCH" });
  expect(f.provider.inspectBackupRepository).toHaveBeenCalledTimes(1); expect(f.uploadBackupBlob).not.toHaveBeenCalled(); expect(f.commitBackupTree).not.toHaveBeenCalled();
});


it("stores flat plan-time content and reuses the caller-bound push job (mutation: restamp-at-push)", async () => {
  const f = fixture();
  type Sources = SiteBackupSources & { hostVersion: string };
  type Content = SiteBackupRepositoryPlanContent & { hostVersion: string };
  const store = new SiteBackupPlanStore<Content>({}, { now: () => 0, newId: () => "shared" });
  const save = vi.spyOn(store, "save"); const take = vi.spyOn(store, "take");
  const createSiteBackupPushJobs = vi.fn(() => new SiteBackupPushJobs<import("../backup-service.js").PushResult>({}));
  f.captureDatabaseSnapshot.mockResolvedValue({ ok: true, bytes: Buffer.from("snapshot"), watermarkAtCapture: 1 });
  f.collectSiteBackupFiles.mockResolvedValue({ files: [], skipped: [], scopeNotes: {} });
  let finishUpload!: () => void;
  const uploading = new Promise<void>(resolve => { finishUpload = resolve; });
  const upload = vi.fn<SiteBackupToolDeps["uploadBackupPlan"]>(async (required, optional) => { await uploading; return uploadBackupPlan(required, optional); });
  const backupPushUploadPolicy = vi.fn(({ plan }: { plan: SiteBackupPlan<Content> }) => ({ databasePath: "database/content.db", readPlannedFile: vi.fn(), cancelled: f.deps.cancelled,
    buildManifest: () => ({ path: "backup.json", content: Buffer.from(JSON.stringify({ hostVersion: plan.hostVersion, schema: plan.schema, createdAt: plan.createdAt })) }) }));
  const buildSourceControlProviders = vi.fn(f.deps.buildSourceControlProviders); const siteBackupNow = vi.fn(() => new Date(0));
  const service = createSiteBackupService<Sources, Content>({ ...f.deps, buildSourceControlProviders, siteBackupPlanStore: store, createSiteBackupPushJobs,
    completePlanContent: ({ content, sources }) => { const { createdAt, ...rest } = content; return { ...rest, hostVersion: sources.hostVersion, createdAt }; },
    siteBackupNow, readConfigText: async () => '{"name":"Site"}', runtimeSchemaVersion: () => ({ index: 1, tag: "one" }),
    defaultCommitMessage: ({ siteName, createdAt }) => `${siteName}:${createdAt}`, manifestName: "backup.json",
    siteBackupDatabasePath: "database/content.db", siteBackupSanitize: async ({ snapshot }) => ({ bytes: snapshot, media: [] }),
    checkSiteBackupLimits: () => ({ ok: true, totalBytes: 8 }), skipOversizedFiles: ({ files }) => ({ files: [...files], skipped: [] }),
    formatByteSize: ({ bytes }) => `${bytes} B`, readPlannedFile: vi.fn(), requireShareSecretFree: vi.fn(), uploadBackupPlan: upload, backupPushUploadPolicy });
  const first: SiteBackupRequestDeps<Sources, Content> = { workspaceId: f.deps.request.workspaceId, authorize: f.deps.request.authorize, dbOps: f.deps.request.dbOps, siteBackupSources: { ...f.deps.request.siteBackupSources!, hostVersion: "A" } };
  const call = { input: { owner: "owner", repo: "repo" }, principal: { id: "owner" }, signal: new AbortController().signal };
  expect(await service.planSiteBackup({ deps: first, call })).toMatchObject({ planned: true, planId: "shared", nextStep: expect.stringContaining("backup.json") });
  expect(save.mock.calls[0]?.[0].content).toMatchObject({ hostVersion: "A" });
  expect(save.mock.calls[0]?.[0].content).not.toHaveProperty("producer");
  const keys = Object.keys(save.mock.calls[0]![0].content);
  expect(keys.slice(keys.indexOf("schema"), keys.indexOf("createdAt") + 1)).toEqual(["schema", "hostVersion", "createdAt"]);
  const second = { ...first, siteBackupNow: vi.fn(() => new Date(1000)), siteBackupSources: { ...first.siteBackupSources!, hostVersion: "B" } };
  const pushCall = { ...call, input: { planId: "shared" } };
  for (const wrong of [{ ...pushCall, principal: { id: "other" } }, pushCall]) {
    const deps = wrong === pushCall ? { ...second, workspaceId: "other" } : second;
    expect(await service.pushSiteBackup({ deps, call: wrong })).toMatchObject({ code: "PLAN_NOT_FOUND" });
  }
  f.uploadBackupBlob.mockResolvedValue({ ok: true, blob: { blobSha: "blob" } });
  f.commitBackupTree.mockResolvedValue({ ok: true, commitSha: "commit", commitUrl: "https://git.example/commit" });
  expect(await service.pushSiteBackup({ deps: second, call: pushCall }, { waitMs: 0 })).toMatchObject({ inProgress: true });
  expect(await service.pushSiteBackup({ deps: second, call: pushCall }, { waitMs: 0 })).toMatchObject({ inProgress: true });
  expect(take).toHaveBeenCalledTimes(3); expect(upload).toHaveBeenCalledOnce();
  expect(backupPushUploadPolicy.mock.calls[0]?.[0].plan).toBe(save.mock.results[0]?.value);
  finishUpload();
  expect(await service.pushSiteBackup({ deps: second, call: pushCall }, { waitMs: 1000 })).toMatchObject({ pushed: true, commitSha: "commit" });
  expect(f.uploadBackupBlob).toHaveBeenLastCalledWith(expect.anything(), { path: "backup.json", content: Buffer.from('{"hostVersion":"A","schema":{"index":1,"tag":"one"},"createdAt":"1970-01-01T00:00:00.000Z"}') });
  expect(createSiteBackupPushJobs).toHaveBeenCalledOnce(); expect(siteBackupNow).toHaveBeenCalledOnce(); expect(second.siteBackupNow).not.toHaveBeenCalled();
  expect(buildSourceControlProviders.mock.calls[0]?.[0].deps).toBe(first); expect(buildSourceControlProviders.mock.calls[1]?.[0].deps).toBe(second);
});

it("selects each request's sanitizer on one bound service (mutation: sanitizer-fixed-at-factory)", async () => {
  const f = fixture();
  const siteBackupSanitize = vi.fn<SiteBackupToolDeps["siteBackupSanitize"]>(async () => ({ bytes: Buffer.from("factory"), media: [] }));
  const requestSanitize = vi.fn<SiteBackupToolDeps["siteBackupSanitize"]>(async () => ({ bytes: Buffer.from("request"), media: [] }));
  f.captureDatabaseSnapshot.mockResolvedValue({ ok: true, bytes: Buffer.from("snapshot"), watermarkAtCapture: 1 });
  f.collectSiteBackupFiles.mockResolvedValue({ files: [], skipped: [], scopeNotes: {} });
  f.save.mockImplementation(({ content }: { content: SiteBackupRepositoryPlanContent }) => ({ ...f.plan, ...content }));
  const service = createSiteBackupService({ ...f.deps, siteBackupSanitize,
    createSiteBackupPushJobs: () => new SiteBackupPushJobs<import("../backup-service.js").PushResult>({}),
    completePlanContent: ({ content }) => content, siteBackupNow: () => new Date(0),
    readConfigText: async () => '{"name":"Site"}', runtimeSchemaVersion: () => ({ index: 1, tag: "one" }),
    defaultCommitMessage: () => "Backup", manifestName: "backup.json", siteBackupDatabasePath: "database/content.db",
    checkSiteBackupLimits: () => ({ ok: true, totalBytes: 7 }), skipOversizedFiles: ({ files }) => ({ files: [...files], skipped: [] }),
    formatByteSize: ({ bytes }) => `${bytes} B` });
  const first = f.deps.request;
  const second: SiteBackupRequestDeps = { ...first, siteBackupSanitize: requestSanitize };
  const call = { input: { owner: "owner", repo: "repo" }, principal: { id: "owner" }, signal: new AbortController().signal };
  expect(await service.planSiteBackup({ deps: first, call })).toMatchObject({ planned: true });
  expect(f.save.mock.calls[0]?.[0].content.database).toEqual({ bytes: Buffer.from("factory"), watermarkAtCapture: 1 });
  expect(await service.planSiteBackup({ deps: second, call })).toMatchObject({ planned: true });
  expect(f.save.mock.calls[1]?.[0].content.database).toEqual({ bytes: Buffer.from("request"), watermarkAtCapture: 1 });
  expect(siteBackupSanitize).toHaveBeenCalledOnce();
  expect(siteBackupSanitize).toHaveBeenCalledWith({ snapshot: Buffer.from("snapshot") });
  expect(requestSanitize).toHaveBeenCalledOnce();
  expect(requestSanitize).toHaveBeenCalledWith({ snapshot: Buffer.from("snapshot") });
});

it("uses the key-status override without sources and redacts only credential-store refusals", async () => {
  const f = fixture();
  const siteBackupSiteKeyStatus = vi.fn(() => ({ active: true }));
  const serverSiteKeyStatus = vi.fn(); const siteProbe = vi.fn();
  const refused = new Error("secret plaintext must stay private");
  const request = { ...f.deps.request, siteBackupSources: undefined, siteBackupSiteKeyStatus };
  const deps = { ...f.deps, request, serverSiteKeyStatus, siteBackupSiteKeyStatus: siteProbe,
    credentialMessages: { active: ({ label }: { label: string }) => `unreadable ${label}`, invalid: () => "invalid", missing: () => "missing" },
    resolveCustomCredentialByLabel: vi.fn(async () => { throw refused; }), isCustomCredentialSecretStoreUnconfiguredError: (error: unknown) => error === refused };
  expect(await resolveBackupCredential({ deps, requested: "key" })).toEqual({ ok: false, code: "CREDENTIAL_UNREADABLE", message: "unreadable key" });
  expect(siteBackupSiteKeyStatus).toHaveBeenCalledOnce(); expect(serverSiteKeyStatus).not.toHaveBeenCalled(); expect(siteProbe).not.toHaveBeenCalled();
  deps.isCustomCredentialSecretStoreUnconfiguredError = () => false;
  await expect(resolveBackupCredential({ deps, requested: "key" })).rejects.toBe(refused);
  expect(siteBackupSiteKeyStatus).toHaveBeenCalledOnce();
});

it("checks cancellation after the upload returns and before committing", async () => {
  const f = fixture(); const controller = new AbortController();
  const upload = vi.fn<SiteBackupToolDeps["uploadBackupPlan"]>(async () => { controller.abort(); return { ok: true, entries: [] }; });
  const deps = { ...f.deps, uploadBackupPlan: upload, backupPushUploadPolicy: () => ({ databasePath: "database/content.db", readPlannedFile: vi.fn(), buildManifest: vi.fn(), cancelled: f.deps.cancelled }) };
  expect(await runObservedBackupPush({ deps, plan: f.plan, run: { signal: controller.signal, progress: initialPushProgress({ plan: f.plan }) } })).toEqual({ pushed: false, cancelled: false, reason: "abandoned" });
  expect(upload).toHaveBeenCalledOnce(); expect(f.commitBackupTree).not.toHaveBeenCalled();
});

it("a push refused as a private target uploads and commits nothing", async () => {
  const f = fixture();
  f.provider.inspectBackupRepository.mockResolvedValueOnce({ ok: false, code: "repo-not-private", message: "Private repository required", logDetail: "private target refused" } as never);
  expect(await pushSiteBackup({ deps: f.deps, call: { input: { planId: "plan" }, principal: { id: "owner" }, signal: new AbortController().signal } }, { waitMs: 1000 })).toMatchObject({ pushed: false, code: "REPOSITORY_NOT_PRIVATE" });
  expect(f.uploadBackupBlob).not.toHaveBeenCalled();
  expect(f.commitBackupTree).not.toHaveBeenCalled();
  expect(f.deps.siteBackupFailureLog).toHaveBeenCalledWith("[site-backup] site_backup_push: failed code=repo-not-private detail=private target refused");
});

it("lists only matching labels when implicit credentials are ambiguous and never opens one", async () => {
  const { deps } = fixture();
  const resolve = vi.fn<SiteBackupToolDeps["resolveCustomCredentialByLabel"]>();
  const list = vi.fn<SiteBackupToolDeps["listCustomCredentials"]>(async () => [
    { label: "broken", baseUrl: "not a URL" },
    { label: "west", baseUrl: "https://git.example/api" },
    { label: "foreign", baseUrl: "https://other.example" },
    { label: "east", baseUrl: "https://git.example" },
  ]);
  expect(await resolveBackupCredential({ deps: { ...deps, listCustomCredentials: list, resolveCustomCredentialByLabel: resolve }, requested: undefined })).toEqual({
    ok: false, code: "CREDENTIAL_AMBIGUOUS", message: "2 saved credentials point at https://git.example (saved labels: 'west', 'east'); name one with 'credential'.",
  });
  expect(list).toHaveBeenCalledExactlyOnceWith({ deps: deps.request }, { workspaceId: "w" });
  expect(resolve).not.toHaveBeenCalled();
});

it("logs disabled provider details and stops before reading credentials when no provider is available", async () => {
  const { deps } = fixture();
  const log = vi.fn();
  const list = vi.fn<SiteBackupToolDeps["listCustomCredentials"]>();
  expect(await resolveBackupCredential({ deps: {
    ...deps, request: { ...deps.request, siteBackupFailureLog: log },
    listCustomCredentials: list,
    buildSourceControlProviders: async () => ({ providers: [], refusals: ["git plugin is off"], noProviderMessage: "Enable a git plugin first." }),
  }, requested: "key" })).toEqual({ ok: false, code: "NO_PROVIDER", message: "Enable a git plugin first." });
  expect(log.mock.calls).toEqual([["[site-backup] git plugin is off"]]);
  expect(deps.siteBackupFailureLog).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});

it.each([
  { username: "operator", requested: "chat-connection" },
  { username: undefined, requested: undefined },
])("uses the chat-saved host connection when there is no matching custom credential ($requested)", async ({ username, requested }) => {
  const { deps, provider } = fixture();
  const request = { ...deps.request, sourceControlCredentialSetRepo: {} };
  const connection = { providerId: "git", token: "fixture-token", ...(username === undefined ? {} : { username }) };
  const resolveDefault = vi.fn<SiteBackupToolDeps["resolveDefaultForSourceControl"]>(async () => ({ id: "record", label: "chat-connection", connection }));
  const resolveCustom = vi.fn<SiteBackupToolDeps["resolveCustomCredentialByLabel"]>();
  const bound = { ...deps, request, resolveDefaultForSourceControl: resolveDefault, resolveCustomCredentialByLabel: resolveCustom, listCustomCredentials: async () => [] };

  expect(await resolveBackupCredential({ deps: bound, requested })).toEqual({
    ok: true, label: "chat-connection", baseUrl: "https://git.example", provider,
    connection: username === undefined ? { token: "fixture-token" } : { token: "fixture-token", username },
  });
  expect(resolveDefault).toHaveBeenCalledExactlyOnceWith({ deps: request }, { workspaceId: "w", providerId: "git" });
  expect(resolveCustom).not.toHaveBeenCalled();
  expect(await resolveBackupCredential({ deps: bound, requested: "different" })).toEqual({
    ok: false, code: "CREDENTIAL_NOT_FOUND", message: "no saved credential is labeled 'different' (none are saved)",
  });
});

it.each([
  { site: true, status: { active: false, invalid: true }, expected: "invalid Git connection" },
  { site: false, status: { active: false }, expected: "missing Git connection" },
])("diagnoses an unreadable chat connection using the correct key scope ($expected)", async ({ site, status, expected }) => {
  const { deps } = fixture();
  const cause = new Error("private store details");
  const siteProbe = vi.fn(() => status);
  const serverProbe = vi.fn(() => status);
  const bound = { ...deps, request: { ...deps.request, siteBackupSources: site ? deps.request.siteBackupSources : undefined, sourceControlCredentialSetRepo: {} },
    listCustomCredentials: async () => [], resolveDefaultForSourceControl: async () => { throw cause; },
    siteBackupSiteKeyStatus: siteProbe, serverSiteKeyStatus: serverProbe,
    isSourceControlCredentialSecretStoreUnconfiguredError: (error: unknown) => error === cause,
    credentialMessages: {
      active: ({ label }: { label: string }) => `active ${label}`,
      invalid: ({ label }: { label: string }) => `invalid ${label}`,
      missing: ({ label }: { label: string }) => `missing ${label}`,
    },
  };
  expect(await resolveBackupCredential({ deps: bound, requested: undefined })).toEqual({ ok: false, code: "CREDENTIAL_UNREADABLE", message: expected });
  if (site) {
    expect(siteProbe).toHaveBeenCalledExactlyOnceWith({ siteDir: "/site" });
    expect(serverProbe).not.toHaveBeenCalled();
  } else {
    expect(serverProbe).toHaveBeenCalledExactlyOnceWith();
    expect(siteProbe).not.toHaveBeenCalled();
  }
  await expect(resolveBackupCredential({ deps: { ...bound, isSourceControlCredentialSecretStoreUnconfiguredError: () => false }, requested: undefined })).rejects.toBe(cause);
});

it("does not reuse a credential that disappeared or changed to an unsupported API since listing", async () => {
  const { deps } = fixture();
  const open = vi.fn<SiteBackupToolDeps["resolveCustomCredentialByLabel"]>()
    .mockResolvedValueOnce(null).mockResolvedValueOnce({ baseUrl: "https://unregistered.example", connection: { token: "fixture" } });
  const pick = vi.fn<SiteBackupToolDeps["pickSourceControlProviderForApi"]>(() => ({ ok: false, message: "No plugin supports the new API" }));
  const bound = { ...deps, resolveCustomCredentialByLabel: open, pickSourceControlProviderForApi: pick };
  expect(await resolveBackupCredential({ deps: bound, requested: "key" })).toEqual({
    ok: false, code: "CREDENTIAL_NOT_FOUND", message: "the credential 'key' was deleted while the backup was being prepared",
  });
  expect(pick).not.toHaveBeenCalled();
  expect(await resolveBackupCredential({ deps: bound, requested: "key" })).toEqual({
    ok: false, code: "NO_PROVIDER", message: "No plugin supports the new API",
  });
  expect(open.mock.calls).toEqual(Array(2).fill([{ deps: deps.request }, { workspaceId: "w", label: "key" }]));
});

const planCall = (input: Record<string, unknown> = {}) => ({
  input: { owner: "owner", repo: "repo", ...input }, principal: { id: "owner" }, signal: new AbortController().signal,
});

it.each([
  { id: "non-object", include: 0, message: "'include' must be an object of true/false switches" },
  { id: "null", include: null, message: "'include' must be an object of true/false switches" },
  { id: "array", include: [], message: "'include' must be an object of true/false switches" },
  { id: "unknown scope", include: { accounts: true }, message: "'include' has unknown switch(es): accounts (known: database, media, themes, plugins, settings)" },
  { id: "non-boolean", include: { media: "false" }, message: "'include.media' must be true or false" },
  { id: "all off", include: { database: false, media: false, themes: false, plugins: false, settings: false }, message: "'include' switches everything off; there would be nothing to back up" },
])("rejects invalid inclusion switches before calling the provider ($id)", async ({ include, message }) => {
  const f = fixture();
  const result = planSiteBackup({ deps: f.deps, call: planCall({ include }) });
  await expect(result).rejects.toBeInstanceOf(CustomCredentialValidationError);
  await expect(result).rejects.toMatchObject({ message });
  expect(f.provider.inspectBackupRepository).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it("uses the folder name if config cannot be read and preserves explicit scope switches in the stored plan", async () => {
  const f = fixture();
  const store = new SiteBackupPlanStore<SiteBackupRepositoryPlanContent>({}, { now: () => 0, newId: () => "folder-plan" });
  const include = { database: false, media: true, themes: true, plugins: true, settings: true };
  f.collectSiteBackupFiles.mockResolvedValue({ files: [], skipped: [], scopeNotes: { media: "No local media" } });
  const deps: SiteBackupToolDeps = {
    ...f.deps, siteBackupPlanStore: store, readConfigText: async () => { throw new Error("unreadable config"); },
    siteBackupNow: () => new Date(0), runtimeSchemaVersion: () => ({ index: 3, tag: "three" }),
    completePlanContent: ({ content }) => content, defaultCommitMessage: ({ siteName }) => `Backup of ${siteName}`,
    formatByteSize: ({ bytes }) => `${bytes} B`, checkSiteBackupLimits: () => ({ ok: true, totalBytes: 0 }),
    skipOversizedFiles: ({ files }) => ({ files: [...files], skipped: [] }), manifestName: "backup.json",
  };
  expect(await planSiteBackup({ deps, call: planCall({ include: { database: false } }) })).toMatchObject({
    planned: true, planId: "folder-plan", include, notes: ["No local media"], files: [], credentialWarnings: [],
  });
  expect(store.take({ planId: "folder-plan", workspaceId: "w", principalId: "owner" })).toMatchObject({
    ok: true, plan: { include, site: { name: "site", folderName: "site" }, commitMessage: "Backup of site", database: null },
  });
  expect(f.captureDatabaseSnapshot).not.toHaveBeenCalled();
  expect(f.collectSiteBackupFiles).toHaveBeenCalledExactlyOnceWith({ include, sources: deps.request.siteBackupSources });
});

it("refuses a failed snapshot before collection and keeps diagnostics on the server", async () => {
  const f = fixture();
  f.captureDatabaseSnapshot.mockResolvedValue({ ok: false, message: "Unable to capture database", logDetail: "SQLite busy" });

  expect(await planSiteBackup({ deps: f.deps, call: planCall() })).toEqual({
    planned: false, code: "DATABASE_SNAPSHOT_FAILED", message: "Unable to capture database",
  });
  expect(f.captureDatabaseSnapshot).toHaveBeenCalledExactlyOnceWith({ dbOps: f.deps.request.dbOps, scopeId: "site-backup" });
  expect(f.deps.siteBackupFailureLog).toHaveBeenCalledExactlyOnceWith("[site-backup] site_backup_plan: failed code=database-snapshot detail=SQLite busy");
  expect(f.collectSiteBackupFiles).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it("returns the projection's typed refusal but does not relabel an unexpected projection failure", async () => {
  const f = fixture();
  const unexpected = new Error("projection crashed");
  f.captureDatabaseSnapshot.mockResolvedValue({ ok: true, bytes: Buffer.from("snapshot"), watermarkAtCapture: 7 });
  const sanitize = vi.fn<SiteBackupToolDeps["siteBackupSanitize"]>()
    .mockRejectedValueOnce(new SiteShareRefusal({ code: "UNSUPPORTED_DATA", message: "Table requires a portable projection" }))
    .mockRejectedValueOnce(unexpected);
  const deps = { ...f.deps, siteBackupSanitize: sanitize };
  expect(await planSiteBackup({ deps, call: planCall() })).toEqual({ planned: false, code: "UNSUPPORTED_DATA", message: "Table requires a portable projection" });
  await expect(planSiteBackup({ deps, call: planCall() })).rejects.toBe(unexpected);
  expect(f.collectSiteBackupFiles).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it("scans readable backup bytes but refuses a changed file without saving the plan", async () => {
  const f = fixture();
  const report: PlannedDiskFile = { scope: "settings", path: "settings/report.json", bytes: 3, absPath: "/site/settings/report.json", root: "/site", identity: null, nlink: 1, mtimeMs: 1 };
  const stale = { ...report, path: "settings/stale.json", absPath: "/site/settings/stale.json" };
  const bytes = Buffer.from("123");
  const readPlannedFile = vi.fn<SiteBackupToolDeps["readPlannedFile"]>()
    .mockResolvedValueOnce({ ok: true, bytes }).mockResolvedValueOnce({ ok: false, message: "stale.json changed" });
  const requireShareSecretFree = vi.fn();
  f.collectSiteBackupFiles.mockResolvedValue({ files: [report, stale], skipped: [], scopeNotes: {} });
  const deps: SiteBackupToolDeps = { ...f.deps, readPlannedFile, requireShareSecretFree,
    checkSiteBackupLimits: () => ({ ok: true, totalBytes: 6 }), skipOversizedFiles: ({ files }) => ({ files: [...files], skipped: [] }) };
  expect(await planSiteBackup({ deps, call: planCall({ include: { database: false } }) })).toEqual({
    planned: false, code: "PLAN_STALE", message: "stale.json changed",
  });
  expect(readPlannedFile.mock.calls).toEqual([[report], [stale]]);
  expect(requireShareSecretFree).toHaveBeenCalledExactlyOnceWith({ path: report.path, bytes }, { credentialWarnings: [] });
  expect(f.save).not.toHaveBeenCalled();
});

it.each([
  { state: "accepted", outcome: "completed", failed: false },
  { state: "abandoned", outcome: "cancelled", failed: false },
  { state: "refused", outcome: "not_pushed", failed: true },
  { state: "threw", outcome: "failed", failed: true },
])("ends the observed backup with the actual outcome ($state)", async ({ state, outcome, failed }) => {
  const f = fixture();
  const controller = new AbortController();
  const end = vi.fn();
  const fault = new Error("upload port threw");
  const trackOperation = vi.fn(() => ({ end, run: <T>(work: () => T): T => work() }));
  const upload = vi.fn<SiteBackupToolDeps["uploadBackupPlan"]>(async () => {
    if (state === "threw") throw fault;
    if (state === "abandoned") controller.abort();
    if (state === "refused") return { ok: false, code: "PLAN_STALE", message: "Content changed" };
    return { ok: true, entries: [] };
  });
  const success = { pushed: true as const, commitSha: "new", commitUrl: "https://git.example/new", repository: "owner/repo", branch: "main", folder: "site", filesWritten: 1, totalBytes: 8, credentialWarnings: [] };
  const commit = vi.fn<SiteBackupToolDeps["commitBackupPlan"]>(async () => ({ ok: true, result: success }));
  const deps: SiteBackupToolDeps = {
    ...f.deps, request: { ...f.deps.request, observability: { ...createNoopObservabilityPort({}), trackOperation } },
    uploadBackupPlan: upload, commitBackupPlan: commit,
    backupPushUploadPolicy: () => ({ databasePath: "database/content.db", readPlannedFile: vi.fn(), buildManifest: vi.fn(), cancelled: f.deps.cancelled }),
  };

  const result = runObservedBackupPush({ deps, plan: f.plan, run: { signal: controller.signal, progress: initialPushProgress({ plan: f.plan }) } });
  if (state === "threw") await expect(result).rejects.toBe(fault);
  else if (state === "accepted") await expect(result).resolves.toEqual(success);
  else if (state === "abandoned") await expect(result).resolves.toEqual({ pushed: false, cancelled: false, reason: "abandoned" });
  else await expect(result).resolves.toEqual({ pushed: false, cancelled: false, code: "PLAN_STALE", message: "Content changed" });
  expect(trackOperation.mock.calls).toEqual([[{ name: "site.backup" }]]);
  expect(upload).toHaveBeenCalledOnce();
  expect(end.mock.calls).toEqual([[{ outcome, failed }]]);
  expect(commit).toHaveBeenCalledTimes(state === "accepted" ? 1 : 0);
});

it("refuses planning without a site directory before inventory and preserves an explicit zero wait budget", async () => {
  const f = fixture();
  const buildSourceControlProviders = vi.fn(f.deps.buildSourceControlProviders);
  const request = { ...f.deps.request, siteBackupSources: undefined, siteBackupPushWaitMs: 12 };
  expect(await planSiteBackup({ deps: { ...f.deps, request, buildSourceControlProviders }, call: planCall() })).toEqual({
    planned: false, code: "UNAVAILABLE", message: "site backup is not available in this runtime: it has no site folder on disk",
  });
  expect(buildSourceControlProviders).not.toHaveBeenCalled();
  expect(pushWaitBudget({ deps: { request }, waitMs: 0 })).toBe(0);
  expect(pushWaitBudget({ deps: { request }, waitMs: undefined })).toBe(12);
  expect(pushWaitBudget({ deps: { request: {} }, waitMs: undefined })).toBe(240_000);
});

it("explains how to connect when no saved credential points at the configured provider", async () => {
  const { deps } = fixture();
  const open = vi.fn<SiteBackupToolDeps["resolveCustomCredentialByLabel"]>();
  const listCustomCredentials = async () => [{ label: "different-host", baseUrl: "https://elsewhere.example" }];
  expect(await resolveBackupCredential({ deps: { ...deps, listCustomCredentials, resolveCustomCredentialByLabel: open }, requested: undefined })).toEqual({
    ok: false, code: "CREDENTIAL_NOT_FOUND",
    message: "no saved credential points at https://git.example (saved labels: 'different-host'). Connect Git with credential_save with kind source-control (a form in this chat), or save a token on the Access Tokens page ('Add custom provider', base URL https://git.example), or name one with 'credential'.",
  });
  expect(open).not.toHaveBeenCalled();
});

it("reports completed versus total bytes and files and tells the caller how to resume the same push", () => {
  const progress = { filesDone: 2, filesTotal: 7, bytesDone: 1_024, bytesTotal: 8_192 };
  const formatByteSize = vi.fn(({ bytes }: { bytes: number }) => `${bytes / 1024} KiB`);
  expect(inProgressResult({ formatByteSize, planId: "backup-7", progress, elapsedMs: 2_600 })).toEqual({
    pushed: false, cancelled: false, inProgress: true, planId: "backup-7", progress,
    message: "Still uploading after 3 s: 2 of 7 files (1 KiB of 8 KiB). Nothing is committed until every file is up. Call site_backup_push again with the same planId to keep waiting; it does not start a second upload.",
  });
  expect(formatByteSize.mock.calls).toEqual([[{ bytes: 1_024 }], [{ bytes: 8_192 }]]);
});

it("does not start an upload when the reviewed plan contains a credential warning", async () => {
  const f = fixture();
  const uploadBackupPlan = vi.fn<SiteBackupToolDeps["uploadBackupPlan"]>();
  const commit = vi.fn<SiteBackupToolDeps["commitBackupPlan"]>();
  const plan = { ...f.plan, credentialWarnings: [{ path: "settings.json", kind: "authorization header" }] };
  await expect(runObservedBackupPush({
    deps: { ...f.deps, uploadBackupPlan, commitBackupPlan: commit }, plan,
    run: { signal: new AbortController().signal, progress: initialPushProgress({ plan }) },
  })).resolves.toEqual({
    pushed: false, cancelled: false, code: "UNSAFE_FILE",
    message: "The export contains files with possible credentials. Remove the credentials and export again.",
  });
  expect(f.provider.inspectBackupRepository).toHaveBeenCalledOnce();
  expect(uploadBackupPlan).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it("keeps upload diagnostics out of the response and never commits a failed blob", async () => {
  const f = fixture();
  const buildManifest = vi.fn<ReturnType<SiteBackupToolDeps["backupPushUploadPolicy"]>["buildManifest"]>();
  f.uploadBackupBlob.mockResolvedValue({ ok: false, code: "network-unreachable", message: "Git is unreachable", logDetail: "ECONNRESET" });
  const deps: SiteBackupToolDeps = {
    ...f.deps, deps: { ...f.deps.deps, buildAuthorizationHeader: () => "Bearer fixture" },
    backupPushUploadPolicy: () => ({ databasePath: "db/content.db", readPlannedFile: vi.fn(), buildManifest, cancelled: f.deps.cancelled }),
  };
  await expect(runObservedBackupPush({
    deps, plan: f.plan,
    run: { signal: new AbortController().signal, progress: initialPushProgress({ plan: f.plan }) },
  })).resolves.toEqual({ pushed: false, cancelled: false, code: "NETWORK_UNREACHABLE", message: "uploading 'db/content.db' failed: Git is unreachable" });
  expect(f.uploadBackupBlob).toHaveBeenCalledExactlyOnceWith(
    { baseUrl: "https://git.example", authorization: "Bearer fixture", owner: "owner", repo: "repo" },
    { path: "db/content.db", content: Buffer.from("snapshot") },
  );
  expect(f.deps.siteBackupFailureLog).toHaveBeenCalledExactlyOnceWith("[site-backup] site_backup_push: failed code=network-unreachable detail=ECONNRESET");
  expect(buildManifest).not.toHaveBeenCalled();
  expect(f.commitBackupTree).not.toHaveBeenCalled();
});

it("forwards an unknown provider failure without logging details that were not supplied", () => {
  const f = fixture();
  expect(providerRefusal({ deps: f.deps, toolId: "site_backup_plan", failure: {
    code: "vendor-capacity", message: "Repository temporarily unavailable",
  } })).toEqual({
    ok: false, code: "PROVIDER_ERROR", message: "Repository temporarily unavailable",
  });
  expect(f.deps.siteBackupFailureLog).not.toHaveBeenCalled();
});

it("checks the projected database size with the selected host's limits before reading any files", async () => {
  const f = fixture();
  f.captureDatabaseSnapshot.mockResolvedValue({ ok: true, bytes: Buffer.from("raw snapshot"), watermarkAtCapture: 2 });
  const file: PlannedDiskFile = {
    scope: "settings", path: "settings/report.json", bytes: 7,
    absPath: "/site/settings/report.json", root: "/site", identity: null, nlink: 1, mtimeMs: 1,
  };
  f.collectSiteBackupFiles.mockResolvedValue({ files: [file], skipped: [], scopeNotes: {} });
  const checkSiteBackupLimits = vi.fn<SiteBackupToolDeps["checkSiteBackupLimits"]>(() => ({ ok: false, message: "Database exceeds the host limit" }));
  const siteBackupSanitize = vi.fn<SiteBackupToolDeps["siteBackupSanitize"]>(async () => ({ bytes: Buffer.from("clean"), media: [] }));
  const readPlannedFile = vi.fn<SiteBackupToolDeps["readPlannedFile"]>();
  const deps: SiteBackupToolDeps = {
    ...f.deps, checkSiteBackupLimits, siteBackupSanitize, readPlannedFile, siteBackupDatabasePath: "db/content.db",
    skipOversizedFiles: ({ files }) => ({ files: [...files], skipped: [] }),
  };
  await expect(planSiteBackup({ deps, call: planCall() })).resolves.toEqual({
    planned: false, code: "LIMIT_EXCEEDED", message: "Database exceeds the host limit",
  });
  expect(siteBackupSanitize).toHaveBeenCalledExactlyOnceWith({ snapshot: Buffer.from("raw snapshot") });
  expect(checkSiteBackupLimits).toHaveBeenCalledExactlyOnceWith({ files: [{ path: "db/content.db", bytes: 5 }, file], host: f.provider });
  expect(readPlannedFile).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it("returns a distinct expired-plan refusal without trying to open a provider", async () => {
  const f = fixture();
  let now = 0;
  const store = new SiteBackupPlanStore<SiteBackupRepositoryPlanContent>({}, { now: () => now, ttlMs: 50, newId: () => "expires" });
  const plan = store.save({ principalId: "owner", workspaceId: "w", content: f.plan });
  const buildSourceControlProviders = vi.fn(f.deps.buildSourceControlProviders);
  const deps = { ...f.deps, siteBackupPlanStore: store, buildSourceControlProviders };
  now = 50;
  const args = { deps, call: { input: { planId: plan.planId }, principal: { id: "owner" }, signal: new AbortController().signal } };
  await expect(pushSiteBackup(args)).resolves.toEqual({
    pushed: false, cancelled: false, code: "PLAN_EXPIRED",
    message: "that backup plan expired (plans last 10 minutes). Call site_backup_plan again.",
  });
  await expect(pushSiteBackup(args)).resolves.toEqual({
    pushed: false, cancelled: false, code: "PLAN_NOT_FOUND",
    message: "no backup plan with that planId is waiting (a planId works once, for this principal, and a server restart drops plans). Call site_backup_plan again.",
  });
  expect(buildSourceControlProviders).not.toHaveBeenCalled();
});
