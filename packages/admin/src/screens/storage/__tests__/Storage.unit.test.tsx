// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RetentionPassResult, StorageClient, StorageReport } from "../api/storage-api.js";
import type { ScreenshotCleanupClient } from "../api/screenshot-cleanup-api.js";
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
