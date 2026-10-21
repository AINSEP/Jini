import { Suspense } from "react";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdmin } from "../../../core/module/create-admin.js";
import { AdminConfigError } from "../../../core/module/create-admin.js";
import type { AdminComment, CommentsSettings } from "../../../core/ports/comments.js";
import { createMemoryCommentsApi } from "../../adapters/memory.js";
import { englishComments, type CommentsTranslator } from "../../messages.en.js";
import { emptyRowState } from "../../rules.js";
import { comments, CommentQueueScopeProvider, useCommentsPorts } from "../index.js";
import { QueueSection } from "../components/QueueSection.js";
import { SettingsSection } from "../components/SettingsSection.js";
import { CommentsPage } from "../pages/CommentsPage.js";
import { CommentsTranslationContext } from "../hooks/CommentsPorts.hooks.js";
import type { CommentQueueController } from "../hooks/use-comment-queue.hooks.js";
import type { CommentSettingsController } from "../hooks/use-comment-settings.hooks.js";

afterEach(cleanup);

const SETTINGS: CommentsSettings = { enabled: true, requireModeration: true, maxDepth: 5, closeAfterDays: null, spamAutoRejectScore: 0.9, maxPerIpPerHour: 10 };
const COMMENT: AdminComment = { id: "c1", entryId: "e1", parentId: null, threadRootId: "c1", depth: 0, status: "pending",
  authorPrincipalId: null, authorName: "Reader", authorEmail: null, authorUrl: null, authorIpHash: null, bodyText: "Queued body",
  spamScore: null, spamProvider: null, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", version: 1 };
const shout: CommentsTranslator = (key, vars) => `!${englishComments(key, vars)}`;

function queueController(overrides: Partial<CommentQueueController> = {}): CommentQueueController {
  return { status: "pending", setStatus: vi.fn(), items: [COMMENT], nextCursor: null, error: null, loadingMore: false, loadMore: vi.fn(),
    stateFor: () => emptyRowState(), onModerate: vi.fn(async () => {}), pendingPurge: null, setPendingPurge: vi.fn(), onPurge: vi.fn(async () => {}), ...overrides };
}
function settingsController(overrides: Partial<CommentSettingsController> = {}): CommentSettingsController {
  return { settings: SETTINGS, error: null, saving: false, notice: null, save: vi.fn(async () => {}), ...overrides };
}

describe("comments module page", () => {
  it("lazily loads the queue page through the bound module and renders it with the host translator", async () => {
    const feature = comments({}, { t: shout });
    const session = { me: async () => ({ effectivePermissions: ["comments.read"] }) };
    const admin = createAdmin({ modules: [feature], ports: { commentsApi: createMemoryCommentsApi({ items: [COMMENT] }), commentsSession: session } }, { permissions: ["comments.read"] });
    const { Page } = feature.react.pages.queue;
    render(
      <FetchQueryProvider>
        <CommentQueueScopeProvider scope={{ workspaceId: "w1", principalId: "operator" }}>
          <feature.react.Provider admin={admin}>
            <Suspense fallback="Loading page"><Page tabs={{}} description={admin.describe().pages[0]!} /></Suspense>
          </feature.react.Provider>
        </CommentQueueScopeProvider>
      </FetchQueryProvider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "!Comments" })).toBeVisible();
    expect(await screen.findByText("Queued body")).toBeVisible();
  });

  it("shows the permissions error instead of the page", () => {
    render(<CommentsPage useCommentsHook={() => ({ permissions: null, error: "permissions unavailable", t: englishComments })} />);
    expect(screen.getByText("permissions unavailable")).toHaveClass("notice", "error");
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("comments sections fall back to the scope translator", () => {
  it("labels the queue with the scope translator and keeps a refresh error above the rows", () => {
    render(
      <CommentsTranslationContext.Provider value={shout}>
        <QueueSection permissions={["comments.read"]} useCommentQueueHook={() => queueController({ error: "refresh failed" })} />
      </CommentsTranslationContext.Provider>,
    );
    expect(screen.getByRole("option", { name: "!Pending" })).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toHaveClass("notice", "error");
    expect(screen.getByText("Queued body")).toBeVisible();
  });

  it("shows a load error with no settings, then keeps the form visible beside a save error and a notice", () => {
    const { rerender } = render(<SettingsSection canConfigure useCommentSettingsHook={() => settingsController({ settings: null, error: "load failed" })} />);
    expect(screen.getByText("load failed")).toHaveClass("notice", "error");
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    rerender(
      <CommentsTranslationContext.Provider value={shout}>
        <SettingsSection canConfigure useCommentSettingsHook={() => settingsController({ error: "save failed", notice: "Saved." })} />
      </CommentsTranslationContext.Provider>,
    );
    expect(screen.getByRole("heading", { name: "!Settings" })).toBeVisible();
    expect(screen.getByText("save failed")).toHaveClass("notice", "error");
    expect(screen.getByText("Saved.")).toHaveClass("notice");
  });

  it("disables the save button and shows progress while saving", () => {
    render(<SettingsSection canConfigure t={englishComments} useCommentSettingsHook={() => settingsController({ saving: true })} />);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
  });

  it("fails loudly when comments hooks run outside the bound provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useCommentsPorts())).toThrow(AdminConfigError);
    expect(() => renderHook(() => useCommentsPorts())).toThrow(/React scope unavailable: comments/);
  });
});
