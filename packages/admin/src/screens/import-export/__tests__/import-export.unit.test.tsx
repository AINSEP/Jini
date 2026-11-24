// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";

import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import { ADMIN_COMMON_I18N } from "../../../core/i18n-common.js";
import type { SourceControlCredential } from "../../../source-control/models.js";
import { IMPORT_EXPORT_DICT, t } from "../import-export-i18n.js";
import { backupConnectionLabels, gitBackupFormReady, gitBackupPlanInput, gitBackupRefusalMessage, isGitBackupInProgress, isGitBackupPushed } from "../git-backup-rules.js";
import { createFakeGitBackupPort, type GitBackupPlan } from "../hooks/git-backup-port.hooks.js";
import { useGitBackup, type GitBackupHost } from "../hooks/use-git-backup.hooks.js";
import { useImportExportTranslate, useSitesSectionAvailable, type SitesSectionSnapshot } from "../hooks/use-import-export.hooks.js";

/**
 * @file Characterization of the Import & Export screen's moved behaviour: the dictionary, the Git
 * backup rules, `useGitBackup` against a fake port and a fake host, and the two host-bound hooks.
 * The markup (card, tabs, panel) stays in the host and is covered there.
 */

const identity = (key: string): string => key;
const HOST: GitBackupHost = { describeError: ({ e, fallback }) => (e instanceof Error && e.message === "worded" ? "Host words it." : fallback) };

function connection(overrides: Partial<SourceControlCredential> = {}): SourceControlCredential {
  return { id: "c1", providerId: "github", label: "GitHub", configured: true, isDefault: true, createdAt: "", updatedAt: "", ...overrides };
}

const PLAN: GitBackupPlan = { planned: true, planId: "plan-1", repository: "me/site-backups", branch: "main", folder: "mysite", folderExists: true, fileCount: 12, totalSize: "3.4 MB", skipped: [] };

function wrapper({ children }: { children: React.ReactNode }) {
  return <FetchQueryProvider>{children}</FetchQueryProvider>;
}

describe("import-export dictionary", () => {
  it("resolves feature copy, shared copy and fallbacks to exact strings", () => {
    expect(t({ locale: "fr", key: "Open" })).toBe("Ouvrir");
    expect(t({ locale: "fr", key: "Other" })).toBe("Autres");
    expect(t({ locale: "de", key: "Static Site" })).toBe("Statische Seite");
    expect(t({ locale: "de", key: "Cancel" })).toBe(ADMIN_COMMON_I18N.de!.Cancel);
    expect(t({ locale: "de", key: "Cancel" })).not.toBe("Cancel");
    expect(t({ locale: "xx", key: "Other" })).toBe("Other");
  });

  it("carries the same keys in every admin locale", () => {
    const keys = Object.keys(IMPORT_EXPORT_DICT.es!);
    expect(Object.keys(IMPORT_EXPORT_DICT).sort()).toEqual(Object.keys(ADMIN_COMMON_I18N).filter((code) => code !== "en").sort());
    for (const [locale, entries] of Object.entries(IMPORT_EXPORT_DICT)) expect(Object.keys(entries), locale).toEqual(keys);
  });
});

describe("git-backup rules", () => {
  it("offers each default connection once", () => {
    expect(backupConnectionLabels({ credentials: [connection(), connection({ id: "c2" }), connection({ id: "c3", label: "Other", isDefault: false })] })).toEqual(["GitHub"]);
  });

  it("needs a connection, owner and repository, and sends a trimmed branch only when one is typed", () => {
    expect(gitBackupFormReady({ connection: "GitHub", owner: " ", repo: "r", branch: "" })).toBe(false);
    expect(gitBackupFormReady({ connection: "", owner: "me", repo: "r", branch: "" })).toBe(false);
    expect(gitBackupFormReady({ connection: "GitHub", owner: "me", repo: "r", branch: "" })).toBe(true);
    expect(gitBackupPlanInput({ connection: "GitHub", owner: " me ", repo: " r ", branch: " dev " })).toEqual({ credential: "GitHub", owner: "me", repo: "r", branch: "dev" });
    expect(gitBackupPlanInput({ connection: "GitHub", owner: "me", repo: "r", branch: "  " })).toEqual({ credential: "GitHub", owner: "me", repo: "r" });
    expect(isGitBackupInProgress({ pushed: false, inProgress: true, planId: "p", progress: { filesDone: 1, filesTotal: 2 } })).toBe(true);
    expect(isGitBackupPushed({ pushed: true, commitUrl: "u", repository: "r" })).toBe(true);
  });

  it.each([
    [{ code: "PLAN_EXPIRED", message: "call site_backup_plan" }, "The plan expired. Plan again."],
    [{ code: "PLAN_NOT_FOUND" }, "That plan is gone. Plan again."],
    [{ code: "DIVERGED_BRANCH" }, "The branch changed since the plan. Nothing was written. Plan again."],
    [{ code: "CREDENTIAL_NOT_FOUND", message: "credential_save" }, "That connection is gone. Check Source Control."],
    [{ reason: "expired" as const }, "The backup stopped. Nothing was committed. Plan again."],
    [{ cancelled: true }, "The backup stopped. Nothing was committed. Plan again."],
    [{ code: "NO_PUSH_PERMISSION", message: "This token cannot push." }, "This token cannot push."],
    [{}, "Git backup failed."],
  ])("says %j as %s", (refusal, line) => {
    expect(gitBackupRefusalMessage({ result: refusal, t: identity })).toBe(line);
  });
});

describe("useGitBackup", () => {
  it("plans with the first default connection, polls the push and ends on the commit", async () => {
    const plan = vi.fn(async () => PLAN);
    const push = vi.fn()
      .mockResolvedValueOnce({ pushed: false, inProgress: true, planId: "plan-1", progress: { filesDone: 3, filesTotal: 12 } })
      .mockResolvedValueOnce({ pushed: true, commitUrl: "https://example.test/c/1", repository: "me/site-backups" });
    const port = createFakeGitBackupPort({ overrides: { listConnections: async () => [connection(), connection({ id: "c2", label: "Other" })], plan, push } });
    const { result } = renderHook(() => useGitBackup({ port, t: identity, host: HOST }), { wrapper });
    await waitFor(() => expect(result.current.connections).toEqual(["GitHub", "Other"]));
    expect(result.current.canPlan).toBe(false);
    act(() => { result.current.setField({ field: "owner", value: " me " }); });
    act(() => { result.current.setField({ field: "repo", value: "site-backups" }); });
    expect(result.current.form.connection).toBe("GitHub");
    await act(async () => { await result.current.planBackup(); });
    expect(plan).toHaveBeenCalledWith({ credential: "GitHub", owner: "me", repo: "site-backups" });
    expect(result.current.phase).toBe("planned");
    await act(async () => { await result.current.pushBackup(); });
    expect(push).toHaveBeenCalledTimes(2);
    expect(result.current.progress).toEqual({ filesDone: 3, filesTotal: 12 });
    expect(result.current.phase).toBe("done");
    expect(result.current.done).toEqual({ repository: "me/site-backups", commitUrl: "https://example.test/c/1" });
    act(() => { result.current.reset(); });
    expect(result.current.phase).toBe("idle");
    expect(result.current.form.owner).toBe(" me ");
  });

  it("words refusals, thrown errors and a stuck job through the rules and the host", async () => {
    const plan = vi.fn().mockResolvedValueOnce({ planned: false, code: "PLAN_EXPIRED", message: "call site_backup_plan" }).mockRejectedValueOnce(new Error("worded")).mockResolvedValue(PLAN);
    const push = vi.fn(async () => ({ pushed: false as const, inProgress: true as const, planId: "plan-1", progress: { filesDone: 1, filesTotal: 2 } }));
    const port = createFakeGitBackupPort({ overrides: { listConnections: async () => [connection()], plan, push } });
    const { result } = renderHook(() => useGitBackup({ port, t: identity, host: HOST }, { maxPushPolls: 2 }), { wrapper });
    await waitFor(() => expect(result.current.connections).toEqual(["GitHub"]));
    act(() => { result.current.setField({ field: "owner", value: "me" }); result.current.setField({ field: "repo", value: "r" }); });
    await act(async () => { await result.current.planBackup(); });
    expect([result.current.phase, result.current.message]).toEqual(["refused", "The plan expired. Plan again."]);
    await act(async () => { await result.current.planBackup(); });
    expect(result.current.message).toBe("Host words it.");
    await act(async () => { await result.current.planBackup(); });
    await act(async () => { await result.current.pushBackup(); });
    expect(push).toHaveBeenCalledTimes(3);
    expect(result.current.message).toBe("The backup is taking too long. Check the repository later.");
  });

  it("reports a failed connections read through the host", async () => {
    const port = createFakeGitBackupPort({ overrides: { listConnections: async () => { throw new Error("down"); } } });
    const { result } = renderHook(() => useGitBackup({ port, t: identity, host: HOST }), { wrapper });
    await waitFor(() => expect(result.current.connectionsError).toBe("Couldn't load connections."));
    expect(result.current.connections).toBeUndefined();
  });
});

describe("host-bound hooks", () => {
  it("binds the dictionary to the host's locale", () => {
    const host = { useLocale: () => "fr" };
    const { result } = renderHook(() => useImportExportTranslate({ host }));
    expect(result.current("Other")).toBe("Autres");
  });

  it.each<[boolean, SitesSectionSnapshot, boolean, boolean]>([
    [true, { data: { switchingEnabled: true } }, false, false],
    [false, { data: { switchingEnabled: true } }, true, true],
    [false, { data: { switchingEnabled: true }, error: new Error("refresh") }, true, false],
    [false, {}, true, false],
  ])("desktop=%s snapshot=%j reads enabled=%s and answers %s", (desktop, snapshot, enabled, expected) => {
    const useSitesSnapshot = vi.fn(() => snapshot);
    const { result } = renderHook(() => useSitesSectionAvailable({ host: { isDesktop: () => desktop, useSitesSnapshot } }));
    expect(useSitesSnapshot).toHaveBeenCalledWith({ enabled });
    expect(result.current).toBe(expected);
  });
});
