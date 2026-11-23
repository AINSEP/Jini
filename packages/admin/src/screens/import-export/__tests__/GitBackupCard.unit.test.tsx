// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryResult } from "@jini-ai/core/fetch";
import { createDomPageDriver } from "@jini-ai/agentic/dom";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import type { SourceControlCredential } from "../../../source-control/models.js";
import { GitBackupCard, SOURCE_CONTROL_HREF } from "../GitBackupCard.js";
import { backupConnectionLabels, gitBackupPlanInput, gitBackupRefusalMessage } from "../git-backup-rules.js";
import { createFakeGitBackupPort, type GitBackupPlan, type GitBackupPort } from "../hooks/git-backup-port.hooks.js";
import { useGitBackup as useGitBackupHook, type DescribeApiError } from "../hooks/use-git-backup.hooks.js";

/**
 * @file The Git backup card driven end to end through `useGitBackup` against a fake port: no
 * connection → link to Source Control; plan → summary; push with polling → commit link; refusals
 * in plain words. Plus the pure rules. (Moved from Tovu; the live port's request shapes and the
 * host's wired hook stay tested in Tovu, beside `defaultGitBackupPort`.)
 */

/** The host's `describeApiError` contract: a thrown failure's own message, else the fallback. */
const describeApiError: DescribeApiError = ({ e, fallback }) => (e instanceof Error ? e.message || fallback : fallback);

/** `useGitBackup` with the describer bound, as the host's wiring binds it. */
function useGitBackup(required: { port: GitBackupPort; t: (key: string) => string }, optional: { maxPushPolls?: number } = {}) {
  return useGitBackupHook({ ...required, describeApiError }, optional);
}

/** A query that really waits on its `fetch`, so loading, data and a failed read all show. */
function useAsyncFetchQuery<T>(required: { fetch?: (() => Promise<T>) | undefined }): QueryResult<T> {
  const [state, setState] = useState<{ data?: T; error: Error | null }>({ error: null });
  useEffect(() => {
    let live = true;
    void required.fetch?.().then((data) => { if (live) setState({ data, error: null }); }, (error: Error) => { if (live) setState({ error }); });
    return () => { live = false; };
  }, []);
  return { data: state.data, error: state.error, status: state.error ? "error" : state.data === undefined ? "pending" : "success", isFetching: false, refetch: () => {} } as QueryResult<T>;
}

const kit = fakeAdminKit({ query: { useFetchQuery: useAsyncFetchQuery as never } });
function Kit({ children }: { children: ReactNode }) { return <AdminKitProvider kit={kit}>{children}</AdminKitProvider>; }
const renderInKit = (ui: ReactNode) => render(ui, { wrapper: Kit });

afterEach(cleanup);

const t = (key: string): string => key;

function connection(overrides: Partial<SourceControlCredential> = {}): SourceControlCredential {
  return { id: "c1", providerId: "github", label: "GitHub", configured: true, isDefault: true, createdAt: "", updatedAt: "", ...overrides } as SourceControlCredential;
}

const PLAN: GitBackupPlan = { planned: true, planId: "plan-1", repository: "me/site-backups", branch: "main", folder: "mysite", folderExists: true, fileCount: 12, totalSize: "3.4 MB", skipped: [{ path: "big.mov" }] };

function Harness({ port, maxPushPolls }: { port: GitBackupPort; maxPushPolls?: number }) {
  return <GitBackupCard controller={useGitBackup({ port, t }, maxPushPolls === undefined ? {} : { maxPushPolls })} t={t} />;
}

function fillForm(owner = "me", repo = "site-backups") {
  fireEvent.change(screen.getByLabelText("Owner"), { target: { value: owner } });
  fireEvent.change(screen.getByLabelText("Repository"), { target: { value: repo } });
}

describe("GitBackupCard", () => {
  it("drives each backup field directly and cancels the resulting plan", async () => {
    const plan = vi.fn(async () => PLAN);
    const port = createFakeGitBackupPort({
      listConnections: async () => [connection(), connection({ id: "c2", label: "Other" })], plan,
    });
    const { container } = renderInKit(<Harness port={port} />);
    await screen.findByLabelText("Connection");
    const driver = createDomPageDriver({ root: container, pages: {} });
    await act(async () => { await driver.selectOption({ handle: "import-export-git-backup-connection", option: "Other" }); });
    for (const [part, text] of [["owner", "fixture-owner"], ["repo", "fixture-repo"], ["branch", "fixture-branch"]]) {
      await act(async () => { await driver.fill({ handle: `import-export-git-backup-${part}`, text: text! }); });
    }
    await act(async () => { await driver.click({ handle: "import-export-git-backup-plan" }); });
    expect(plan).toHaveBeenCalledWith({ credential: "Other", owner: "fixture-owner", repo: "fixture-repo", branch: "fixture-branch" });
    await screen.findByRole("button", { name: "Cancel" });
    await act(async () => { await driver.click({ handle: "import-export-git-backup-cancel" }); });
    expect((screen.getByLabelText("Owner") as HTMLInputElement).value).toBe("fixture-owner");
    expect(screen.queryByRole("button", { name: "Push backup" })).toBeNull();
  });

  it("links to Source Control when no default connection exists", async () => {
    renderInKit(<Harness port={createFakeGitBackupPort({ listConnections: async () => [connection({ isDefault: false })] })} />);
    expect(screen.getByText("Loading connections…")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "Open Source Control" });
    expect(link.getAttribute("href")).toBe(SOURCE_CONTROL_HREF);
    expect(screen.getByText("No Git connection yet.")).toBeTruthy();
  });

  it("shows a connections load failure", async () => {
    renderInKit(<Harness port={createFakeGitBackupPort({ listConnections: () => Promise.reject(new Error("Boom")) })} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Boom");
  });

  it("plans with the only connection, shows the plan, pushes with polling and links the commit", async () => {
    const plans: unknown[] = [];
    const pushes = [
      { pushed: false as const, inProgress: true as const, planId: "plan-1", progress: { filesDone: 4, filesTotal: 12 } },
      { pushed: true as const, commitUrl: "https://github.com/me/site-backups/commit/abc", repository: "me/site-backups" },
    ];
    let releasePlan!: () => void;
    const port = createFakeGitBackupPort({
      listConnections: async () => [connection()],
      plan: (input) => { plans.push(input); return new Promise((resolve) => { releasePlan = () => resolve(PLAN); }); },
      push: async () => pushes.shift()!,
    });
    renderInKit(<Harness port={port} />);
    expect(await screen.findByText("Uses GitHub.")).toBeTruthy();
    expect(screen.queryByLabelText("Connection")).toBeNull();
    const plan = screen.getByRole("button", { name: "Plan backup" }) as HTMLButtonElement;
    expect(plan.disabled).toBe(true);
    fillForm("  me ", "site-backups");
    fireEvent.change(screen.getByLabelText("Branch"), { target: { value: " " } });
    fireEvent.click(plan);
    expect((await screen.findByRole("button", { name: "Planning…" })).getAttribute("aria-busy")).toBe("true");
    await act(async () => releasePlan());
    expect(plans).toEqual([{ credential: "GitHub", owner: "me", repo: "site-backups" }]);
    expect(await screen.findByText("Replaces folder mysite.")).toBeTruthy();
    expect(screen.getByText("12 files, 3.4 MB")).toBeTruthy();
    expect(screen.getByText("1 skipped")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Push backup" }));
    const commit = await screen.findByRole("link", { name: "View commit" });
    expect(commit.getAttribute("href")).toBe("https://github.com/me/site-backups/commit/abc");
    expect(commit.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("Backed up to me/site-backups.")).toBeTruthy();
    const doneDriver = createDomPageDriver({ root: screen.getByRole("button", { name: "Back up again" }).closest("section")!, pages: {} });
    await act(async () => { await doneDriver.click({ handle: "import-export-git-backup-again" }); });
    expect((screen.getByLabelText("Owner") as HTMLInputElement).value).toBe("  me ");
  });

  it("shows upload progress while the push is still running", async () => {
    let finish!: () => void;
    let calls = 0;
    const port = createFakeGitBackupPort({
      listConnections: async () => [connection()],
      plan: async () => ({ ...PLAN, folderExists: false, skipped: [] }),
      push: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve({ pushed: false as const, inProgress: true as const, planId: "plan-1", progress: { filesDone: 4, filesTotal: 12 } });
        return new Promise((resolve) => { finish = () => resolve({ pushed: false, code: "DIVERGED_BRANCH", message: "server words" }); });
      },
    });
    renderInKit(<Harness port={port} />);
    await screen.findByLabelText("Owner");
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Plan backup" }));
    expect(await screen.findByText("Creates folder mysite.")).toBeTruthy();
    expect(screen.queryByText("1 skipped")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Push backup" }));
    expect(await screen.findByText("Uploaded 4 of 12 files…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Pushing…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await act(async () => finish());
    expect((await screen.findByRole("alert")).textContent).toBe("The branch changed since the plan. Nothing was written. Plan again.");
  });

  it("offers a choice of connections, cancels a plan, and shows refusals and failures", async () => {
    const plans: Array<{ credential: string }> = [];
    const results: Array<() => Promise<GitBackupPlan | { planned: false; code: string; message: string }>> = [
      async () => PLAN,
      async () => ({ planned: false, code: "REPOSITORY_NOT_PRIVATE", message: "me/site-backups is public." }),
      () => Promise.reject(new Error("You do not have permission to back up this site.")),
    ];
    const port = createFakeGitBackupPort({
      listConnections: async () => [connection(), connection({ id: "c2", providerId: "gitlab", label: "GitLab" })],
      plan: (input) => { plans.push(input); return results.shift()!(); },
    });
    renderInKit(<Harness port={port} />);
    const select = (await screen.findByLabelText("Connection")) as HTMLSelectElement;
    expect(select.value).toBe("GitHub");
    fireEvent.change(select, { target: { value: "GitLab" } });
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Plan backup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Plan backup" }));
    expect((await screen.findByRole("alert")).textContent).toBe("me/site-backups is public.");
    const retryDriver = createDomPageDriver({ root: screen.getByRole("button", { name: "Try again" }).closest("section")!, pages: {} });
    await act(async () => { await retryDriver.click({ handle: "import-export-git-backup-retry" }); });
    fireEvent.submit(screen.getByRole("button", { name: "Plan backup" }).closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toBe("You do not have permission to back up this site.");
    expect(plans.map((input) => input.credential)).toEqual(["GitLab", "GitLab", "GitLab"]);
  });

  it("reports a push that throws", async () => {
    const port = createFakeGitBackupPort({
      listConnections: async () => [connection()],
      plan: async () => PLAN,
      push: () => Promise.reject(new Error("socket closed")),
    });
    renderInKit(<Harness port={port} />);
    await screen.findByLabelText("Owner");
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Plan backup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Push backup" }));
    expect((await screen.findByRole("alert")).textContent).toBe("socket closed");
  });

  it("gives up after the poll cap with a plain line", async () => {
    const port = createFakeGitBackupPort({
      listConnections: async () => [connection()],
      plan: async () => PLAN,
      push: async () => ({ pushed: false as const, inProgress: true as const, planId: "plan-1", progress: { filesDone: 1, filesTotal: 12 } }),
    });
    renderInKit(<Harness port={port} maxPushPolls={2} />);
    await screen.findByLabelText("Owner");
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Plan backup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Push backup" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The backup is taking too long. Check the repository later.");
  });
});

describe("useGitBackup guards", () => {
  it("ignores a second plan while planning, a push with no plan, and answers after unmount", async () => {
    let release!: () => void;
    const plan = vi.fn(() => new Promise<GitBackupPlan>((resolve) => { release = () => resolve(PLAN); }));
    const push = vi.fn();
    let controller!: ReturnType<typeof useGitBackup>;
    function Probe() { controller = useGitBackup({ port: createFakeGitBackupPort({ listConnections: async () => [connection()], plan, push }), t }); return null; }
    const view = renderInKit(<Probe />);
    await waitFor(() => expect(controller.connections).toEqual(["GitHub"]));
    await act(async () => { await controller.pushBackup(); });
    expect(push).not.toHaveBeenCalled();
    await act(async () => { await controller.planBackup(); });
    expect(plan).not.toHaveBeenCalled();
    act(() => { controller.setField({ field: "owner", value: "me" }); });
    act(() => { controller.setField({ field: "repo", value: "r" }); });
    expect(controller.form).toEqual({ connection: "GitHub", owner: "me", repo: "r", branch: "" });
    let first!: Promise<void>;
    act(() => { first = controller.planBackup(); });
    await act(async () => { await controller.planBackup(); });
    expect(plan).toHaveBeenCalledTimes(1);
    view.unmount();
    release();
    await first;
  });

  it("stops polling once unmounted", async () => {
    let controller!: ReturnType<typeof useGitBackup>;
    let pushes = 0;
    let unmount!: () => void;
    const port = createFakeGitBackupPort({
      listConnections: async () => [connection()],
      plan: async () => PLAN,
      push: async () => { pushes += 1; if (pushes === 2) unmount(); return { pushed: false as const, inProgress: true as const, planId: "plan-1", progress: { filesDone: 1, filesTotal: 2 } }; },
    });
    function Probe() { controller = useGitBackup({ port, t }); return null; }
    unmount = renderInKit(<Probe />).unmount;
    await waitFor(() => expect(controller.connections).toEqual(["GitHub"]));
    act(() => { controller.setField({ field: "owner", value: "me" }); controller.setField({ field: "repo", value: "r" }); });
    await act(async () => { await controller.planBackup(); });
    await act(async () => { await controller.pushBackup(); });
    expect(pushes).toBe(2);
  });

  it("the plan result arriving after unmount and a failed plan after unmount change nothing", async () => {
    let controller!: ReturnType<typeof useGitBackup>;
    let reject!: (error: Error) => void;
    const port = createFakeGitBackupPort({ listConnections: async () => [connection()], plan: () => new Promise((_resolve, rejectPlan) => { reject = rejectPlan; }) });
    function Probe() { controller = useGitBackup({ port, t }); return null; }
    const view = renderInKit(<Probe />);
    await waitFor(() => expect(controller.connections).toEqual(["GitHub"]));
    act(() => { controller.setField({ field: "owner", value: "me" }); controller.setField({ field: "repo", value: "r" }); });
    let pending!: Promise<void>;
    act(() => { pending = controller.planBackup(); });
    view.unmount();
    reject(new Error("late"));
    await pending;
  });
});

describe("git-backup rules", () => {
  it("offers each default connection once", () => {
    expect(backupConnectionLabels({ credentials: [connection(), connection({ id: "c2" }), connection({ id: "c3", label: "Other", isDefault: false })] })).toEqual(["GitHub"]);
  });

  it("sends a trimmed branch only when one is typed", () => {
    expect(gitBackupPlanInput({ connection: "GitHub", owner: " me ", repo: " r ", branch: " dev " })).toEqual({ credential: "GitHub", owner: "me", repo: "r", branch: "dev" });
  });

  it.each([
    [{ code: "PLAN_EXPIRED", message: "call site_backup_plan" }, "The plan expired. Plan again."],
    [{ code: "PLAN_NOT_FOUND" }, "That plan is gone. Plan again."],
    [{ code: "CREDENTIAL_NOT_FOUND", message: "credential_save" }, "That connection is gone. Check Source Control."],
    [{ reason: "expired" as const }, "The backup stopped. Nothing was committed. Plan again."],
    [{ cancelled: true }, "The backup stopped. Nothing was committed. Plan again."],
    [{ code: "NO_PUSH_PERMISSION", message: "This token cannot push." }, "This token cannot push."],
    [{}, "Git backup failed."],
  ])("says %j as %s", (refusal, line) => {
    expect(gitBackupRefusalMessage({ result: refusal, t })).toBe(line);
  });
});

describe("fake Git backup port", () => {
  it("rejects calls a test did not describe", async () => {
    const fake = createFakeGitBackupPort();
    await expect(fake.plan({ credential: "a", owner: "b", repo: "c" })).rejects.toThrow("plan was not expected");
    await expect(fake.push({ planId: "p" })).rejects.toThrow("push was not expected");
    expect(await fake.listConnections()).toEqual([]);
  });

  it("describes a failure without a message by its fallback line", async () => {
    renderInKit(<Harness port={createFakeGitBackupPort({ listConnections: () => Promise.reject(new Error("")) })} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't load connections.");
  });
});
