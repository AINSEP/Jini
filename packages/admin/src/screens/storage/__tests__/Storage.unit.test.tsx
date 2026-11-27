// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStorageClient, type RetentionPassResult, type StorageClient, type StorageReport } from "../api/storage-api.js";
import { createScreenshotCleanupClient, type ScreenshotCleanupClient } from "../api/screenshot-cleanup-api.js";
import { bindStorageScreen, createStorageReporter } from "../storage-screen-bindings.js";
import { StorageScreen } from "../StorageScreen.js";
import { useWiredStorage } from "../hooks/use-storage.hooks.js";
import { useScreenshotCleanup } from "../hooks/use-screenshot-cleanup.hooks.js";

const AMOUNT = { bytes: 2048, knownBytes: 2048, files: 1 };

function report(): StorageReport {
  return {
    categories: {
      logs: { ...AMOUNT, class: "automatic" },
      uploads: { ...AMOUNT, class: "yours" },
      exports: { ...AMOUNT, class: "report-only" },
    },
    lastPass: null,
  };
}

function pass(dryRun: boolean): RetentionPassResult {
  return dryRun
    ? { status: "completed", dryRun, startedAt: 1, finishedAt: 2, policies: [{ id: "logs", kind: "old-copy", status: "measured", measurement: { bytes: 1024 } }] }
    : { status: "completed", dryRun, startedAt: 3, finishedAt: 4, policies: [{ id: "logs", kind: "old-copy", status: "swept", result: { freedBytes: 1024, removed: 1 } }] };
}

function harness() {
  const seen: { dryRun: boolean; listShown: boolean }[] = [];
  const client: StorageClient = {
    report: vi.fn(async () => report()),
    cleanup: vi.fn(async ({ dryRun }) => {
      seen.push({ dryRun, listShown: screen.queryByText(/Old copies/) !== null });
      return dryRun ? { ...pass(dryRun), previewToken: "grant-1" } : pass(dryRun);
    }),
  };
  const screenshotClient: ScreenshotCleanupClient = { preview: vi.fn(), apply: vi.fn() };
  const setDocumentTitle = vi.fn(({ title }: { title: string }) => {
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  });
  const view = render(<StorageScreen setDocumentTitle={setDocumentTitle} client={client} screenshotClient={screenshotClient} reportErrors={({ error }) => String(error)} now={() => 0} locale="en" useWiredStorageHook={useWiredStorage} useScreenshotCleanupHook={useScreenshotCleanup}
    kit={{ Button: "button" }} links={[]} t={({ key }) => key} categoryLabels={{ logs: "Logs", uploads: "Uploads", exports: "Exports" }}
    kindLabels={{ cache: "Cache", derived: "Rebuildable files", "old-copy": "Old copies" }}
    copy={{ automatic: "Automatic", yours: "Yours", shown: "Shown only", dryRun: "Clean up now", confirm: "Review and confirm", clean: "Clean up", lastAutomaticPass: "Last pass", freed: "Freed", failures: "Failed" }}
    screenshotAgeDays={90} screenshotsAnchor="screenshots" screenshotHeading="Delete screenshots older than 90 days" />);
  return { client, seen, setDocumentTitle, ...view };
}

afterEach(() => { cleanup(); });

describe("StorageScreen", () => {
  it("Storage names its tab and restores the previous title on unmount", () => {
    document.title = "Previous page";
    const { unmount, setDocumentTitle } = harness();
    expect(setDocumentTitle).toHaveBeenCalledWith({ title: "Storage" }, {});
    expect(document.title).toBe("Storage");
    unmount();
    expect(document.title).toBe("Previous page");
  });

  it("dry-run list first", async () => {
    const { client, seen } = harness();
    // Found outside `act`: awaiting inside it would hold back the report's own state update.
    const cleanUpNow = await screen.findByRole("button", { name: "Clean up now" });
    await act(async () => { fireEvent.click(cleanUpNow); });
    expect(seen).toEqual([{ dryRun: true, listShown: false }]);
    expect(await screen.findByText(/Old copies: would free 1 kB/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clean up" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review and confirm" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clean up" })); });
    // The live pass only ever runs the automatic kinds the owner was shown, and only after the list.
    // The confirm spends the single-use grant of the preview on screen (Codex FIX 5); without it the website refuses.
    expect(client.cleanup).toHaveBeenLastCalledWith({ dryRun: false, classes: ["old-copy"], previewToken: "grant-1" }, {});
    expect(seen).toEqual([{ dryRun: true, listShown: false }, { dryRun: false, listShown: true }]);
    expect(await screen.findByText(/Freed: 1 kB/)).toBeTruthy();
  });
});

it("uses the chosen base and sends preview and apply as distinct retention requests", async () => {
  const request = vi.fn().mockResolvedValueOnce(report()).mockResolvedValueOnce({ ...pass(true), previewToken: "grant-33" }).mockResolvedValueOnce(pass(false));
  const client = createStorageClient({ request, basePath: "/tenant/retention" });
  await expect(client.report({})).resolves.toEqual(report());
  await expect(client.cleanup({ dryRun: true })).resolves.toEqual({ ...pass(true), previewToken: "grant-33" });
  await expect(client.cleanup({ dryRun: false, classes: ["old-copy"], previewToken: "grant-33" })).resolves.toEqual(pass(false));
  expect(request.mock.calls).toEqual([
    [{ path: "/report" }, { options: { basePath: "/tenant/retention" } }],
    [{ path: "/cleanup" }, { options: { basePath: "/tenant/retention" }, init: { method: "POST", body: '{"dryRun":true}' } }],
    [{ path: "/cleanup" }, { options: { basePath: "/tenant/retention" }, init: { method: "POST", body: '{"dryRun":false,"classes":["old-copy"],"previewToken":"grant-33"}' } }],
  ]);
});

it("localizes the bound screen and previews old screenshots before spending their grant", async () => {
  const user = userEvent.setup();
  const offline = new Error("private stack context");
  const describeErrorForLog = vi.fn((_input: { err: unknown }) => ({ incident: "storage-8" }));
  const describeApiError = vi.fn(({ fallback }: { fallback: string }) => fallback);
  const log = vi.fn();
  const reportErrors = createStorageReporter({ deps: { log, describeErrorForLog, describeApiError, failureLog: "storage refused", failureCopy: "Try again" } });
  const preview = { previewToken: "shot-24", deadline: 132, count: 2, bytes: 2048, items: ["old/first.png", "old/second.png"] };
  const request = vi.fn()
    .mockRejectedValueOnce(offline)
    .mockResolvedValueOnce(preview)
    .mockResolvedValueOnce({ deleted: ["old/second.png"], kept: [{ relPath: "old/first.png", reason: "changed" }] });
  const screenshotClient = createScreenshotCleanupClient({ request, workspaceId: "main office", path: ({ workspaceId }) => `/spaces/${encodeURIComponent(workspaceId)}/screenshots` });
  const Button: Parameters<typeof bindStorageScreen>[0]["kit"]["Button"] = ({ type, disabled, onPress, children }) => <button type={type} disabled={disabled} onClick={onPress}>{children}</button>;
  const Bound = bindStorageScreen({
    hooks: { useWiredStorageHook: useWiredStorage, useScreenshotCleanupHook: useScreenshotCleanup },
    kit: { Button },
    deps: {
      t: ({ key, locale }) => `${locale}: ${key}`, client: { report: async () => report(), cleanup: vi.fn() }, screenshotClient, reportErrors,
      now: () => 100 * 86400000 + 42, setDocumentTitle: () => () => {},
      links: [{ key: "Media", href: "/assets", categories: ["uploads"] }],
      categoryLabels: { logs: "Logs", uploads: "Uploads" }, kindLabels: { cache: "Cache", derived: "Derived", "old-copy": "Old copies" },
      copy: { automatic: "Auto", yours: "Owner", shown: "Listed", dryRun: "Preview", confirm: "Review", clean: "Clean", lastAutomaticPass: "Last", freed: "Freed", failures: "Failures" },
      screenshotAgeDays: 90, screenshotsAnchor: "screens", screenshotHeading: "Old screenshots",
    },
  });
  render(<Bound useAdminLocaleHook={() => "en-GB"} />);
  expect(screen.getByRole("heading", { name: "en-GB: Auto" })).toBeVisible();
  expect(screen.getByRole("link", { name: "en-GB: Media" })).toHaveAttribute("href", "/assets");
  expect(await screen.findByText("en-GB: Uploads (en-GB: Media): 2 kB")).toBeVisible();
  const show = () => screen.getByRole("button", { name: "en-GB: Show what would be deleted" });
  await user.click(show());
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
  expect(describeErrorForLog.mock.calls).toEqual([[{ err: offline }]]);
  expect(describeApiError.mock.calls).toEqual([[{ e: offline, fallback: "Try again" }]]);
  expect(log.mock.calls).toEqual([["storage refused", { incident: "storage-8" }]]);
  expect(screen.queryByText("private stack context")).toBeNull();

  await user.click(show());
  expect(await screen.findByText("old/first.png")).toBeVisible();
  expect(screen.getByText("old/second.png")).toBeVisible();
  expect(screen.getByText("2 · 2 kB")).toBeVisible();
  expect(request).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "en-GB: Delete these screenshots" }));
  expect(await screen.findByText("en-GB: Deleted: 1 · en-GB: Kept: 1")).toHaveAttribute("role", "status");
  expect(show()).toBeEnabled();
  expect(request.mock.calls).toEqual([
    [{ method: "POST", path: "/spaces/main%20office/screenshots/preview", body: { before: 864000042 } }],
    [{ method: "POST", path: "/spaces/main%20office/screenshots/preview", body: { before: 864000042 } }],
    [{ method: "POST", path: "/spaces/main%20office/screenshots/apply", body: { previewToken: "shot-24", confirm: true } }],
  ]);
});

it("distinguishes a failed policy from an unmeasurable cleanup and labels a past preview", async () => {
  const user = userEvent.setup();
  const preview = { ...pass(true), previewToken: "latest-grant" };
  const client: StorageClient = {
    report: vi.fn(async (): Promise<StorageReport> => ({ categories: { gone: { bytes: 0, knownBytes: 0, files: 0, class: "automatic" } }, lastPass: pass(true) })),
    cleanup: vi.fn<StorageClient["cleanup"]>().mockResolvedValueOnce(preview).mockResolvedValueOnce({
      status: "completed", dryRun: false, startedAt: 20, finishedAt: 30,
      policies: [
        { id: "old", kind: "old-copy", status: "swept", result: { freedBytes: null, removed: 1 } },
        { id: "der", kind: "derived", status: "failed", message: "Device offline" },
        { id: "cache", kind: "cache", status: "failed", message: "Directory unavailable" },
      ],
    }),
  };
  render(<StorageScreen setDocumentTitle={() => () => {}} client={client} screenshotClient={{ preview: vi.fn(), apply: vi.fn() }} reportErrors={() => "Cannot load"} now={() => 0} locale="en" useWiredStorageHook={useWiredStorage} useScreenshotCleanupHook={useScreenshotCleanup}
    kit={{ Button: "button" }} links={[]} t={({ key }) => key} categoryLabels={{ gone: "Gone category" }}
    kindLabels={{ cache: "Cache", derived: "Derived", "old-copy": "Old copies" }}
    copy={{ automatic: "Automatic", yours: "Yours", shown: "Shown only", dryRun: "Preview", confirm: "Review", clean: "Clean", lastAutomaticPass: "Last pass", freed: "Freed", failures: "Failed" }}
    screenshotAgeDays={90} screenshotsAnchor="screenshots" screenshotHeading="Old screenshots" />);
  expect(await screen.findByText(/^Last pass: .+ \(measured only\)$/)).toBeVisible();
  expect(screen.queryByText(/Gone category/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await user.click(await screen.findByRole("button", { name: "Review" }));
  await user.click(screen.getByRole("button", { name: "Clean" }));
  expect(await screen.findByText("Derived: Could not clean: Device offline")).toBeVisible();
  expect(screen.getByText("Freed: Size unknown")).toBeVisible();
  expect(screen.getByRole("alert").textContent).toBe("Failed: Device offline; Directory unavailable");
  expect(client.cleanup).toHaveBeenLastCalledWith({ dryRun: false, classes: ["old-copy"], previewToken: "latest-grant" }, {});
});

it("never offers live cleanup for a stopped or all-failed preview and can retry from stopped", async () => {
  const user = userEvent.setup();
  const cleanupStorage = vi.fn<StorageClient["cleanup"]>()
    .mockResolvedValueOnce({ status: "stopped", dryRun: true })
    .mockResolvedValueOnce({
      status: "completed", dryRun: true, startedAt: 1, finishedAt: 2,
      policies: [{ id: "cache", kind: "cache", status: "failed", message: "Permission refused" }],
    });
  const client: StorageClient = { report: async () => ({ ...report(), lastPass: { status: "stopped", dryRun: false } }), cleanup: cleanupStorage };
  render(<StorageScreen setDocumentTitle={() => () => {}} client={client} screenshotClient={{ preview: vi.fn(), apply: vi.fn() }} reportErrors={() => "Try again"} now={() => 0} locale="en" useWiredStorageHook={useWiredStorage} useScreenshotCleanupHook={useScreenshotCleanup}
    kit={{ Button: "button" }} links={[]} t={({ key }) => key} categoryLabels={{ logs: "Logs" }}
    kindLabels={{ cache: "Cache", derived: "Derived", "old-copy": "Old copies" }}
    copy={{ automatic: "Automatic", yours: "Yours", shown: "Shown only", dryRun: "Preview", confirm: "Review", clean: "Clean", lastAutomaticPass: "Last pass", freed: "Freed", failures: "Failed" }}
    screenshotAgeDays={90} screenshotsAnchor="screenshots" screenshotHeading="Old screenshots" />);
  const preview = await screen.findByRole("button", { name: "Preview" });
  expect(screen.queryByText(/^Last pass:/)).toBeNull();
  await user.click(preview);
  expect(await screen.findByRole("status")).toHaveTextContent("The clean-up stopped before it finished.");
  expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByText("Cache: Could not clean: Permission refused")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Nothing to clean up right now.");
  expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Clean" })).toBeNull();
  expect(cleanupStorage.mock.calls).toEqual([[{ dryRun: true }, {}], [{ dryRun: true }, {}]]);
});
