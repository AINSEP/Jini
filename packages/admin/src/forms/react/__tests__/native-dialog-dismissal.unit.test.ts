import { createElement, StrictMode, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { Dialog } from "@jini-ai/ui-kit/react";

// Author Checklist: deleting cleanup or retaining the first callback must fail (F2.3, F3.3).
// Native cancellation and React effect replay; callback delivery is the contract.
it("delivers native cancel to the current callback and stops delivery after unmount", () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender, unmount } = render(createElement(Dialog, { open: true, title: "Field attributes", onClose: () => first() }), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children),
  });

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
  expect(first).not.toHaveBeenCalled();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(first.mock.calls).toEqual([[]]);

  rerender(createElement(Dialog, { open: true, title: "Field attributes", onClose: () => second() }));
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(first.mock.calls).toEqual([[]]);
  expect(second.mock.calls).toEqual([[], []]);

  const dialog = screen.getByRole("dialog");
  unmount();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(first.mock.calls).toEqual([[]]);
  expect(second.mock.calls).toEqual([[], []]);
});
