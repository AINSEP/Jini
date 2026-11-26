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
  const deps = { workspaceId: "w", initialPushProgress, uploadBackupPlan, commitBackupPlan, siteBackupScopes: SITE_BACKUP_SCOPES, authorize: async () => ({ allowed: true }), siteBackupSources: { siteDir: "/site" }, siteFolderName: () => "site", customCredentialSetRepo: {},
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
