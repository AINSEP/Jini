import { CustomCredentialValidationError } from "@jini-ai/integrations/credentialed-http/sets";
import { buildAuthorizationHeader } from "@jini-ai/integrations/credentialed-http";
import { normalizeWriteFilePath, validateBranch, validateCommitMessage } from "@jini-ai/integrations/custom-credentials/write-files-validation";
import { savePlan } from "../backup-service.plan.js";
import { expect, it, vi } from "vitest";
import { planSiteBackup, pushSiteBackup, type SiteBackupToolDeps, type SiteBackupPlan } from "../backup-service.js";
import { SiteBackupPushJobs } from "../../push-jobs.js";

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

it("a fresh parent SHA change refuses before uploads or a commit", async () => {
  const f = fixture(); f.repository.parentCommitSha = "changed";
  expect(await pushSiteBackup({ deps: f.deps, call: { input: { planId: "plan" }, principal: { id: "owner" }, signal: new AbortController().signal } }, { waitMs: 1000 })).toMatchObject({ pushed: false, code: "DIVERGED_BRANCH" });
  expect(f.provider.inspectBackupRepository).toHaveBeenCalledTimes(1); expect(f.uploadBackupBlob).not.toHaveBeenCalled(); expect(f.commitBackupTree).not.toHaveBeenCalled();
});


it("the reviewed plan keeps the injected product version between schema and createdAt", async () => {
  const f = fixture();
  const deps = { ...f.deps, siteBackupNow: () => new Date(0), readSiteName: async () => "Site", runtimeSchemaVersion: () => ({ index: 1, tag: "one" }),
    defaultCommitMessage: () => "Backup", planVersion: { hostVersion: "1.2.3" } };
  await savePlan({ deps, ctx: { input: {}, principal: { id: "owner" }, signal: new AbortController().signal }, sources: { siteDir: "/site" } as Parameters<typeof savePlan>[0]["sources"],
    input: { include: f.plan.include } as Parameters<typeof savePlan>[0]["input"], folderName: "site", content: f.plan });
  const saved = vi.mocked(f.save).mock.calls[0] as unknown as [{ content: Record<string, unknown> }];
  expect(saved[0].content.hostVersion).toBe("1.2.3");
  const keys = Object.keys(saved[0].content);
  expect(keys.slice(keys.indexOf("schema"), keys.indexOf("createdAt") + 1)).toEqual(["schema", "hostVersion", "createdAt"]);
});

it("a push refused as a private target uploads and commits nothing", async () => {
  const f = fixture();
  f.provider.inspectBackupRepository.mockResolvedValueOnce({ ok: false, code: "repo-not-private", message: "Private repository required", logDetail: "private target refused" } as never);
  expect(await pushSiteBackup({ deps: f.deps, call: { input: { planId: "plan" }, principal: { id: "owner" }, signal: new AbortController().signal } }, { waitMs: 1000 })).toMatchObject({ pushed: false, code: "REPOSITORY_NOT_PRIVATE" });
  expect(f.uploadBackupBlob).not.toHaveBeenCalled();
  expect(f.commitBackupTree).not.toHaveBeenCalled();
  expect(f.deps.siteBackupFailureLog).toHaveBeenCalledWith("[site-backup] site_backup_push: failed code=repo-not-private detail=private target refused");
});
