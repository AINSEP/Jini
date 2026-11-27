import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { copyToClipboard, describeEntityFailure, FailureNotice } from "../FailureNotice.js";
import type { EntityTranslate } from "../types.js";

const translate: EntityTranslate = ({ key }) => key;

it("keeps serialization details separate from the public failure message, including unstringifiable values", () => {
  const cyclic: { self?: unknown; toString: () => string } = { toString: () => "opaque failure" };
  cyclic.self = cyclic;
  for (const [error, details] of [
    [new RangeError("invalid order"), "RangeError: invalid order"],
    ["already gone", "already gone"],
    [{ code: "stale", version: 9 }, '{"code":"stale","version":9}'],
    [undefined, "undefined"],
    [cyclic, "opaque failure"],
  ] as const) {
    expect(describeEntityFailure({ error, translate: ({ key }) => "translated " + key })).toEqual({
      message: "translated Operation failed", details,
    });
  }
});

it("copies exactly the provided details using the browser clipboard", async () => {
  userEvent.setup(); // Testing Library supplies a browser clipboard when jsdom has no native one.
  await copyToClipboard({ text: "Row version 7 is no longer current" });
  await expect(navigator.clipboard.readText()).resolves.toBe("Row version 7 is no longer current");
});

it("keeps a copy failure visible until copying succeeds and offers the right recovery action", async () => {
  const user = userEvent.setup();
  const copyText = vi.fn(async (_required: { text: string }) => {}).mockRejectedValueOnce(new Error("clipboard denied"));
  const onReload = vi.fn();
  const onRetry = vi.fn();
  const view = { message: "Someone else saved this row", details: "VERSION_CONFLICT at version 7" };
  const mounted = render(<FailureNotice view={{ ...view, action: "reload" }} {...{ translate, onReload, onRetry, copyText }} />);
  const notice = within(screen.getByRole("alert"));
  expect(notice.getByText(view.message)).toBeVisible();
  await user.click(notice.getByRole("button", { name: "Reload" }));
  expect(onReload.mock.calls).toEqual([[]]);
  expect(onRetry.mock.calls).toEqual([]);
  const copy = notice.getByRole("button", { name: "Copy details" });
  await user.click(copy);
  expect((await notice.findByRole("status")).textContent).toBe("Could not copy details");
  await user.click(copy);
  expect((await notice.findByText("Copied")).textContent).toBe("Copied");
  expect(copyText.mock.calls).toEqual([[{ text: view.details }], [{ text: view.details }]]);
  mounted.rerender(<FailureNotice {...{ view, translate, onReload, onRetry, copyText }} />);
  await user.click(notice.getByRole("button", { name: "Try again" }));
  expect(onRetry.mock.calls).toEqual([[]]);
  expect(onReload.mock.calls).toEqual([[]]);
});
