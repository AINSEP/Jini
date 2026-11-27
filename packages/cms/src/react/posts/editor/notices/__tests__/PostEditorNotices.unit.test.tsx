// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { PostEditorNotices } from "../PostEditorNotices.js";
import type { ComponentProps } from "react";
import { PageExternalChangeBanner } from "../../../../pages/PageExternalChangeBanner.js";

afterEach(cleanup);

it("suppresses the stale draft notice while the outside-change notice is active and restores it afterward", () => {
  const props = {
    recoverableDraft: null, serverUpdatedAt: "2026-01-01", restoreRecoveredDraft: vi.fn(), discardRecoveredDraft: vi.fn(),
    autosaveStaleBasis: { baseVersion: 1, draft: { baseVersion: 1, title: "Draft", slug: "draft", bodyFormat: "doc" as const, bodyJson: {} } },
    saveConflict: null, saveOverwritingConflict: vi.fn(), dismissSaveConflict: vi.fn(),
    loadExternalChange: vi.fn(), dismissExternalChange: vi.fn(), t: (key: string) => key,
    PostAutosaveRecoveryBanner: () => <></>, PostAutosaveStaleBanner: () => <p>Stale draft</p>,
    PostVersionConflictBanner: () => <></>, PageExternalChangeBanner: () => <p>Outside change</p>,
    standingDraftRecoveryMessage: () => "Recovery",
    pageExternalChangeBindings: { agentHandle, copy: { messageKey: "Outside", regionAgentLabel: "Outside", loadLatestAgentLabel: "Load", keepEditsAgentLabel: "Keep" } },
  };
  const { rerender } = render(<PostEditorNotices {...props} pendingExternalVersion={2} />);
  expect(screen.getByText("Outside change")).toBeTruthy();
  expect(screen.queryByText("Stale draft")).toBeNull();
  rerender(<PostEditorNotices {...props} pendingExternalVersion={null} />);
  expect(screen.queryByText("Outside change")).toBeNull();
  expect(screen.getByText("Stale draft")).toBeTruthy();
});

it("a conflict hides competing prompts and its choices route to the correct recovery operations", () => {
  const dismissSaveConflict = vi.fn();
  const dismissExternalChange = vi.fn();
  const saveOverwritingConflict = vi.fn(async () => {});
  const loadExternalChange = vi.fn(async () => {});
  const props: ComponentProps<typeof PostEditorNotices> = {
    recoverableDraft: null, serverUpdatedAt: "2026-01-01", restoreRecoveredDraft: () => {}, discardRecoveredDraft: async () => {},
    autosaveStaleBasis: { baseVersion: 2, draft: { baseVersion: 2, title: "Draft", slug: "draft", bodyFormat: "doc", bodyJson: {} } },
    saveConflict: { expectedVersion: 2, currentVersion: 3, attemptedStatus: "published" },
    saveOverwritingConflict, dismissSaveConflict, loadExternalChange, dismissExternalChange,
    pendingExternalVersion: 3, t: key => key,
    PostAutosaveRecoveryBanner: () => null,
    PostAutosaveStaleBanner: ({ staleBasis, staleBasisMessage }) => <p>{staleBasisMessage(staleBasis)}</p>,
    PostVersionConflictBanner: ({ saveConflict, versionConflictMessage, onSaveAnyway, onLoadLatest, onDismiss }) =>
      <div>
        <p>{versionConflictMessage(saveConflict)}</p>
        <button onClick={onSaveAnyway}>Save anyway</button><button onClick={onLoadLatest}>Load from conflict</button>
        <button onClick={onDismiss}>Dismiss conflict</button>
      </div>,
    PageExternalChangeBanner,
    standingDraftRecoveryMessage: () => "Recovery",
    pageExternalChangeBindings: { agentHandle, copy: { messageKey: "Outside change", regionAgentLabel: "Outside", loadLatestAgentLabel: "Load", keepEditsAgentLabel: "Keep" } },
  };
  const { rerender } = render(<PostEditorNotices {...props} />);
  expect(screen.getByText(/working from version 2, and version 3/).textContent).toContain("Your changes were NOT saved");
  expect(screen.queryByText(/autosaving has paused/)).toBeNull();
  expect(screen.queryByText("Outside change")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
  expect(saveOverwritingConflict).toHaveBeenCalledExactlyOnceWith();
  fireEvent.click(screen.getByRole("button", { name: "Load from conflict" }));
  expect(loadExternalChange).toHaveBeenCalledExactlyOnceWith();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss conflict" }));
  expect(dismissSaveConflict).toHaveBeenCalledExactlyOnceWith();
  expect(dismissExternalChange).toHaveBeenCalledExactlyOnceWith();
  rerender(<PostEditorNotices {...props} saveConflict={null} />);
  expect(screen.queryByRole("button", { name: "Save anyway" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load latest" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
  expect(loadExternalChange.mock.calls).toEqual([[], []]);
  expect(dismissExternalChange.mock.calls).toEqual([[], []]);
});

it("parked draft recovery shows the saved title and sends only the chosen action", () => {
  const recoverableDraft = { bodyFormat: "doc" as const, bodyJson: { type: "doc" }, title: "Parked edits", slug: "parked",
    baseVersion: 4, savedAt: "2026-11-20T08:00:00Z", savedByPrincipalId: "writer" };
  const restoreRecoveredDraft = vi.fn(), discardRecoveredDraft = vi.fn(async () => {});
  const serverUpdatedAt = "2026-11-21T08:00:00Z";
  const t = (key: string) => `Translated ${key}`;
  const standingDraftRecoveryMessage = vi.fn<ComponentProps<typeof PostEditorNotices>["standingDraftRecoveryMessage"]>(({ draft, t }) => t(draft.title));
  const props: ComponentProps<typeof PostEditorNotices> = {
    recoverableDraft, serverUpdatedAt, restoreRecoveredDraft, discardRecoveredDraft,
    autosaveStaleBasis: null, saveConflict: null, saveOverwritingConflict: async () => {}, dismissSaveConflict: () => {},
    pendingExternalVersion: null, loadExternalChange: async () => {}, dismissExternalChange: () => {}, t,
    PostAutosaveRecoveryBanner: ({ recoverableDraft, serverUpdatedAt, onRestore, onDiscard, t, standingDraftRecoveryMessage }) =>
      <div>
        <p>{standingDraftRecoveryMessage({ draft: recoverableDraft, t, serverUpdatedAt })}</p>
        <button onClick={onRestore}>Restore draft</button><button onClick={onDiscard}>Discard draft</button>
      </div>,
    PostAutosaveStaleBanner: () => null, PostVersionConflictBanner: () => null, PageExternalChangeBanner,
    standingDraftRecoveryMessage,
    pageExternalChangeBindings: { agentHandle, copy: { messageKey: "Outside", regionAgentLabel: "Outside", loadLatestAgentLabel: "Load", keepEditsAgentLabel: "Keep" } },
  };
  const { rerender } = render(<PostEditorNotices {...props} />);
  expect(screen.getByText("Translated Parked edits").textContent).toBe("Translated Parked edits");
  expect(standingDraftRecoveryMessage).toHaveBeenCalledExactlyOnceWith({ draft: recoverableDraft, t, serverUpdatedAt });
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(discardRecoveredDraft).toHaveBeenCalledExactlyOnceWith();
  expect(restoreRecoveredDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Restore draft" }));
  expect(restoreRecoveredDraft).toHaveBeenCalledExactlyOnceWith();
  rerender(<PostEditorNotices {...props} recoverableDraft={null} />);
  expect(screen.queryByRole("button", { name: "Restore draft" })).toBeNull();
});
