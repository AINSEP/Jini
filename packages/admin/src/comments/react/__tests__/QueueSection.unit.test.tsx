import { render, screen, within } from "../../../__tests__/fetch-query-support.js";
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
  it('shows human status labels while filtering by the original protocol value', async () => {
    const user = userEvent.setup();
    const controller = fakeController();
    render(<QueueSection permissions={['comments.read']} locale="en" useCommentQueueHook={() => controller} />);
    const select = screen.getByRole('combobox', { name: 'Status' });
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Pending', 'Approved', 'Spam', 'Trash']);
    await user.selectOptions(select, 'approved');
    expect(controller.setStatus).toHaveBeenCalledWith('approved');
  });
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

/** Pins the actions column ("More") for one fixture row: which menu items it shows, in which order,
 *  and that each item reaches the controller with this row's comment. The column is built in the
 *  hooks file and rendered by its own cell component, so this fails if either half is lost in a move. */
describe("QueueSection — actions column for one row", () => {
  const ALL = ["comments.read", "comments.moderate", "comments.delete", "comments.delete.force"];
  const menuLabels = () => screen.getAllByRole("menuitem").map((item) => item.textContent);

  it("shows Approve, Spam, Trash for a pending comment and sends the chosen action with the row's comment", async () => {
    const user = userEvent.setup();
    const controller = fakeController();
    render(<QueueSection permissions={ALL} locale="en" useCommentQueueHook={() => controller} />);

    const row = screen.getByText(COMMENT.bodyText).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: 'Actions for the comment by "Fake Author"' }));
    expect(menuLabels()).toEqual(["Approve", "Spam", "Trash"]);

    await user.click(screen.getByRole("menuitem", { name: "Spam" }));
    expect(controller.onModerate).toHaveBeenCalledTimes(1);
    expect(controller.onModerate).toHaveBeenCalledWith(COMMENT, "spam");
    expect(controller.setPendingPurge).not.toHaveBeenCalled();
  });

  it("shows Approve, Spam, Restore, Purge for a trashed comment in the trash filter and asks to confirm the purge", async () => {
    const user = userEvent.setup();
    const trashed: AdminComment = { ...COMMENT, status: "trash" };
    const controller = fakeController({ status: "trash", items: [trashed] });
    render(<QueueSection permissions={ALL} locale="en" useCommentQueueHook={() => controller} />);

    await user.click(screen.getByRole("button", { name: 'Actions for the comment by "Fake Author"' }));
    expect(menuLabels()).toEqual(["Approve", "Spam", "Restore", "Purge"]);

    await user.click(screen.getByRole("menuitem", { name: "Purge" }));
    expect(controller.setPendingPurge).toHaveBeenCalledTimes(1);
    expect(controller.setPendingPurge).toHaveBeenCalledWith(trashed);
    expect(controller.onModerate).not.toHaveBeenCalled();
  });

  it("shows a dash and no menu button when the operator's permissions leave no action", () => {
    render(<QueueSection permissions={["comments.read"]} locale="en" useCommentQueueHook={() => fakeController()} />);

    const row = screen.getByText(COMMENT.bodyText).closest("tr")!;
    expect(within(row).queryByRole("button")).toBeNull();
    expect(within(row).getByText("—")).toBeInTheDocument();
  });
});
