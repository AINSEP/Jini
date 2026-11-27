// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { render, screen, within } from "../../__tests__/fetch-query-support.js";
import { PostsTrashConfirm } from "../PostsTrashConfirm.js";
import { PostDeleteConfirmDialog } from "../editor/PostDeleteConfirmDialog.js";
import type { AdminPost } from "../api/posts-api.types.js";

const t = (text: string) => text;
const post: AdminPost = {
  id: "post-7", kind: "post", workspaceId: "site-4", title: "April dispatch", slug: "april-dispatch",
  bodyJson: {}, status: "published", version: 3, updatedAt: "2026-04-30T00:00:00Z",
};

it.each([
  { kindLabel: "post", id: "7", name: "Move to trash?", body: 'Move this post ("April dispatch") to trash? It will disappear from the site and from the posts list.', action: "Move to trash" },
  { kindLabel: "page", id: "9", name: "Move to trash?", body: 'Move this page ("April dispatch") to trash? It will disappear from the site and from the pages list.', action: "Move to trash" },
  { kindLabel: "post", id: "", name: "Discard post?", body: "Discard this unsaved post?", action: "Discard" },
] as const)("shows the consequence for $kindLabel with id '$id' before $action", async ({ kindLabel, id, name, body, action }) => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const props = { kindLabel, post: { id, title: post.title }, onConfirm, onCancel, t };
  const view = render(<PostDeleteConfirmDialog {...props} open={false} pending={false} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<PostDeleteConfirmDialog {...props} open pending />);
  const dialog = within(screen.getByRole("dialog", { name }));
  expect(dialog.getByText(body)).toBeVisible();
  const confirm = dialog.getByRole("button", { name: action });
  expect(confirm).toBeDisabled();
  await user.click(confirm);
  expect(onConfirm.mock.calls).toEqual([]);
  view.rerender(<PostDeleteConfirmDialog {...props} open pending={false} />);
  await user.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(onCancel.mock.calls).toEqual([[]]);
  expect(onConfirm.mock.calls).toEqual([]);
  await user.click(confirm);
  expect(onConfirm.mock.calls).toEqual([[]]);
});

it("identifies the selected post and only disables trash confirmation while that row is saving", async () => {
  const user = userEvent.setup();
  const removePost = vi.fn(async () => {});
  const setPendingDelete = vi.fn();
  const props = { removePost, setPendingDelete, t };
  const view = render(<PostsTrashConfirm {...props} pendingDelete={null} rowSavingId={null} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<PostsTrashConfirm {...props} pendingDelete={post} rowSavingId={post.id} />);
  const dialog = within(screen.getByRole("dialog", { name: "Move to trash?" }));
  expect(dialog.getByText('Move "April dispatch" to trash? It will disappear from the site and from this list.')).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Move to trash" });
  expect(confirm).toBeDisabled();
  view.rerender(<PostsTrashConfirm {...props} pendingDelete={post} rowSavingId="other-post" />);
  await user.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(setPendingDelete.mock.calls).toEqual([[null]]);
  await user.click(confirm);
  expect(removePost.mock.calls).toEqual([[]]);
});
