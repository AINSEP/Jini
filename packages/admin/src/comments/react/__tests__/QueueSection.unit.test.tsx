import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QueueSection } from "./support.js";
import type { CommentQueueController } from "./support.js";
import { emptyRowState } from "../../rules.js";
import type { AdminComment } from "./support.js";

/**
 * @file First direct test for `QueueSection` (previously module-private, only reachable through
 * `Comments`'s own render tree — `Comments.unit.test.tsx` keeps the full round-trip coverage).
 * Exported alongside its own DI seam (`useCommentQueueHook`, `Comments.tsx`) so this suite can drive
 * it directly with a fake controller, mirroring `AdminExecutionMode.unit.test.tsx`'s identical
 * "renders from the injected fake, not a real round trip" assertion.
 */

const COMMENT: AdminComment = {
  id: "c1",
  workspaceId: "ws1",
  entryId: "e1",
  parentId: null,
  threadRootId: "c1",
  depth: 0,
  status: "pending",
  authorPrincipalId: null,
  authorName: "Fake Author",
  authorEmail: null,
  authorUrl: null,
  authorIpHash: null,
  bodyText: "From the fake controller, not a real fetch.",
  spamScore: null,
  spamProvider: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  version: 1,
};

function fakeController(overrides: Partial<CommentQueueController> = {}): CommentQueueController {
  return {
    status: "pending",
    setStatus: vi.fn(),
    items: [COMMENT],
    nextCursor: null,
    error: null,
    loadingMore: false,
    loadMore: vi.fn(),
    stateFor: () => emptyRowState(),
    onModerate: vi.fn(async () => {}),
    pendingPurge: null,
    setPendingPurge: vi.fn(),
    onPurge: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("QueueSection — useCommentQueueHook injection", () => {
  it("renders a comment row from the injected fake, with no fetch involved", () => {
    render(
      <QueueSection permissions={["comments.read"]} locale="en" useCommentQueueHook={() => fakeController()} />,
    );

    // The real hook always starts `items: null` until the first page settles — a row appearing
    // synchronously, with no `fetch` mocked anywhere in this file, is only possible via the fake.
    expect(screen.getByText("From the fake controller, not a real fetch.")).toBeInTheDocument();
  });

  it("renders the error banner from the injected fake when items is still null", () => {
    render(
      <QueueSection
        permissions={[]}
        locale="en"
        useCommentQueueHook={() => fakeController({ items: null, error: "fake queue error" })}
      />,
    );

    expect(screen.getByText("fake queue error")).toBeInTheDocument();
  });
  it("shows a failed action's alert in the affected comment row", () => {
    const error = "This comment changed since you loaded it";
    const otherComment = { ...COMMENT, id: "c2", bodyText: "Another comment" };
    render(
      <QueueSection permissions={["comments.read"]} locale="en" useCommentQueueHook={() => fakeController({
        items: [COMMENT, otherComment],
        stateFor: (id) => ({ busy: false, error: id === COMMENT.id ? error : null }),
      })} />,
    );

    const row = screen.getByText(COMMENT.bodyText).closest("tr")!;
    expect(within(row).getByRole("alert")).toHaveTextContent(error);
    expect(within(screen.getByText(otherComment.bodyText).closest("tr")!).queryByRole("alert")).toBeNull();
  });

  it("loads the next page on click, disables the pager while loading, and hides it without a cursor", async () => {
    const user = userEvent.setup();
    const controller = fakeController({ nextCursor: "cursor-2" });
    const view = () => <QueueSection permissions={["comments.read"]} locale="en" useCommentQueueHook={() => controller} />;
    const { rerender } = render(view());

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(controller.loadMore).toHaveBeenCalledTimes(1);

    controller.loadingMore = true;
    rerender(view());
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Loading…" }));
    expect(controller.loadMore).toHaveBeenCalledTimes(1);

    controller.nextCursor = null;
    rerender(view());
    expect(screen.queryByRole("button", { name: /Load more|Loading…/ })).not.toBeInTheDocument();
  });

});
