// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { PostEditorNotices } from "../PostEditorNotices.js";

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
