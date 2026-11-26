import { CustomCredentialValidationError } from "@jini-ai/integrations/credentialed-http/sets";
import { buildAuthorizationHeader } from "@jini-ai/integrations/credentialed-http";
import { normalizeWriteFilePath, validateBranch, validateCommitMessage } from "@jini-ai/integrations/custom-credentials/write-files-validation";
import { savePlan } from "../backup-service.plan.js";
import { expect, it, vi } from "vitest";
import { planSiteBackup, pushSiteBackup, type SiteBackupToolDeps, type SiteBackupPlan } from "../backup-service.js";
import { SiteBackupPushJobs } from "../../push-jobs.js";
import { SiteBackupPlanStore } from "../../plan-store.node.js";
import { runObservedBackupPush } from "../backup-service.push.js";

import { initialPushProgress, uploadBackupPlan, commitBackupPlan } from "../push-content.js";
import { SITE_BACKUP_SCOPES } from "../sources.js";

function fixture() {
  const commitBackupTree = vi.fn();
  const uploadBackupBlob = vi.fn();
  const repository = { branch: "main", parentCommitSha: "reviewed", baseTreeSha: "tree", htmlUrl: "https://git.example/repo", folderExists: true };
  const provider = { id: "git", label: "Git", apiOrigin: "https://git.example", inspectBackupRepository: vi.fn(async () => ({ ok: true, state: repository })), uploadBackupBlob, commitBackupTree };
  const plan = { planId: "plan", principalId: "owner", workspaceId: "w", expiresAtMs: Date.now() + 100000, credentialLabel: "key", owner: "owner", repo: "repo", folder: "site", commitMessage: "Backup", repository: { ...repository }, include: {}, database: { bytes: Buffer.from("snapshot"), watermarkAtCapture: 1 }, files: [], skipped: [], scopeNotes: {}, totalBytes: 8, credentialWarnings: [], site: { name: "Site", folderName: "site" }, schema: { index: 1, tag: "one" }, createdAt: "now" } as unknown as SiteBackupPlan;
  const captureDatabaseSnapshot = vi.fn(); const collectSiteBackupFiles = vi.fn();
  const save = vi.fn();
  const deps = { deps: { CustomCredentialValidationError, buildAuthorizationHeader, normalizeWriteFilePath, validateBranch, validateCommitMessage }, workspaceId: "w", initialPushProgress, uploadBackupPlan, commitBackupPlan, siteBackupScopes: SITE_BACKUP_SCOPES, authorize: async () => ({ allowed: true }), siteBackupSources: { siteDir: "/site" }, siteFolderName: () => "site", customCredentialSetRepo: {},
    buildSourceControlProviders: async () => ({ providers: [provider], refusals: [], noProviderMessage: "none" }), loadSourceControlProviders: vi.fn(),
    listCustomCredentials: async () => [{ label: "key", baseUrl: "https://git.example" }], resolveCustomCredentialByLabel: async () => ({ label: "key", baseUrl: "https://git.example", connection: { token: "token" } }),
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


it("the reviewed plan keeps the injected producer stamp between schema and createdAt", async () => {
  const f = fixture();
  const deps = { ...f.deps, siteBackupNow: () => new Date(0), readConfigText: async () => '{"name":"Site"}', runtimeSchemaVersion: () => ({ index: 1, tag: "one" }),
    defaultCommitMessage: () => "Backup", producer: { hostVersion: "1.2.3" } };
  await savePlan({ deps, ctx: { input: {}, principal: { id: "owner" }, signal: new AbortController().signal }, sources: { siteDir: "/site" } as Parameters<typeof savePlan>[0]["sources"],
    input: { include: f.plan.include } as Parameters<typeof savePlan>[0]["input"], folderName: "site", content: f.plan });
  const saved = vi.mocked(f.save).mock.calls[0] as unknown as [{ content: Record<string, unknown> }];
  expect(saved[0].content.producer).toEqual({ hostVersion: "1.2.3" });
  const keys = Object.keys(saved[0].content);
  expect(keys.slice(keys.indexOf("schema"), keys.indexOf("createdAt") + 1)).toEqual(["schema", "producer", "createdAt"]);
});

it("plans with one provider and clock snapshot and pushes the same stored producer through a second caller", async () => {
  const f = fixture();
  const store = new SiteBackupPlanStore<Omit<SiteBackupPlan, "planId" | "principalId" | "workspaceId" | "expiresAtMs">>({}, { now: () => 0, newId: () => "shared" });
  const producer = { hostVersion: "1.2.3" };
  f.captureDatabaseSnapshot.mockResolvedValue({ ok: true, bytes: Buffer.from("snapshot"), watermarkAtCapture: 1 });
  f.collectSiteBackupFiles.mockResolvedValue({ files: [], skipped: [], scopeNotes: {} });
  const deps: SiteBackupToolDeps = { ...f.deps, siteBackupPlanStore: store, producer, siteBackupNow: vi.fn(() => new Date(0)),
    readConfigText: async () => '{"name":"Site"}', runtimeSchemaVersion: () => ({ index: 1, tag: "one" }),
    defaultCommitMessage: ({ siteName, createdAt }) => `${siteName}:${createdAt}`, manifestName: "backup.json",
    siteBackupDatabasePath: "database/content.db", siteBackupSanitize: async ({ snapshot }) => ({ bytes: snapshot, media: [] }),
    checkSiteBackupLimits: () => ({ ok: true, totalBytes: 8 }), skipOversizedFiles: ({ files }) => ({ files: [...files], skipped: [] }),
    formatByteSize: ({ bytes }) => `${bytes} B`, readPlannedFile: vi.fn(), requireShareSecretFree: vi.fn() };
  const call = { input: { owner: "owner", repo: "repo" }, principal: { id: "owner" }, signal: new AbortController().signal };
  expect(await planSiteBackup({ deps, call })).toMatchObject({ planned: true, planId: "shared", nextStep: expect.stringContaining("backup.json") });
  producer.hostVersion = "changed";
  const second = fixture();
  second.uploadBackupBlob.mockResolvedValue({ ok: true, blob: { blobSha: "blob" } });
  second.commitBackupTree.mockResolvedValue({ ok: true, commitSha: "commit", commitUrl: "https://git.example/commit" });
  const buildManifest = vi.fn(({ plan }: { plan: SiteBackupPlan }) => ({ path: "backup.json", content: Buffer.from(JSON.stringify({ ...plan.producer, schema: plan.schema, createdAt: plan.createdAt })) }));
  const pushed = { ...second.deps, siteBackupPlanStore: store, siteBackupPushJobs: deps.siteBackupPushJobs,
    producer: { hostVersion: "push-time" }, siteBackupNow: vi.fn(() => new Date(1000)),
    backupPushUploadPolicy: ({ plan }: { plan: SiteBackupPlan }) => ({ databasePath: "database/content.db", readPlannedFile: vi.fn(), cancelled: deps.cancelled, buildManifest: () => buildManifest({ plan }) }) };
  expect(await pushSiteBackup({ deps: pushed, call: { ...call, input: { planId: "shared" } } }, { waitMs: 1000 })).toMatchObject({ pushed: true, commitSha: "commit" });
  expect(f.provider.inspectBackupRepository).toHaveBeenCalledOnce(); expect(second.provider.inspectBackupRepository).toHaveBeenCalledOnce();
  expect(second.commitBackupTree).toHaveBeenCalledWith(expect.objectContaining({ parentCommitSha: "reviewed", commitMessage: "Site:1970-01-01T00:00:00.000Z" }));
  expect(buildManifest).toHaveBeenCalledWith({ plan: expect.objectContaining({ producer: { hostVersion: "1.2.3" }, createdAt: "1970-01-01T00:00:00.000Z" }) });
  expect(second.uploadBackupBlob).toHaveBeenLastCalledWith(expect.anything(), { path: "backup.json", content: Buffer.from('{"hostVersion":"1.2.3","schema":{"index":1,"tag":"one"},"createdAt":"1970-01-01T00:00:00.000Z"}') });
  expect(deps.siteBackupNow).toHaveBeenCalledOnce(); expect(pushed.siteBackupNow).not.toHaveBeenCalled();
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
