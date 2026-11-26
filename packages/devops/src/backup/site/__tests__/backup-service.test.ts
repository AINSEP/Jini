import { CustomCredentialValidationError } from "@jini-ai/integrations/credentialed-http/sets";
import { buildAuthorizationHeader } from "@jini-ai/integrations/credentialed-http";
import { normalizeWriteFilePath, validateBranch, validateCommitMessage } from "@jini-ai/integrations/custom-credentials/write-files-validation";
import { expect, it, vi } from "vitest";
import { createSiteBackupService, planSiteBackup, pushSiteBackup, type SiteBackupToolDeps, type SiteBackupPlan, type SiteBackupRequestDeps, type SiteBackupRepositoryPlanContent } from "../backup-service.js";
import { SiteBackupPushJobs } from "../../push-jobs.js";
import { SiteBackupPlanStore } from "../../plan-store.node.js";
import { runObservedBackupPush } from "../backup-service.push.js";

import { initialPushProgress, uploadBackupPlan, commitBackupPlan } from "../push-content.js";
import type { SiteBackupSources } from "../sources.js";
import { resolveBackupCredential } from "../backup-service.credentials.js";
import { pickSourceControlProviderForApi } from "../../../source-control/registry.js";
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
  const deps = { request, deps: { CustomCredentialValidationError, buildAuthorizationHeader, normalizeWriteFilePath, validateBranch, validateCommitMessage }, initialPushProgress, uploadBackupPlan, commitBackupPlan, siteBackupScopes: SITE_BACKUP_SCOPES, siteFolderName: () => "site",
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
