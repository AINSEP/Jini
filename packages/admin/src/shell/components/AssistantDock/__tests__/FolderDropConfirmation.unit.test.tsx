// @vitest-environment jsdom
import { cleanup, render as renderBare, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { FolderDropConfirmation } from "../FolderDropConfirmation.js";

/** @file `ui.spec.md` §1/§3.1/§5 — the "identity translation" translator convention the slow-run
 *  notice tests use, injected as the `useTHook` prop; rendered under the fake admin kit. */
const useTHook = () => (key: string, vars?: Record<string, string | number>) =>
  vars ? key.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name] ?? `{${name}}`)) : key;
const kit = fakeAdminKit();
const render = (ui: ReactElement) => renderBare(<AdminKitProvider kit={kit}>{ui}</AdminKitProvider>);

afterEach(() => {
  cleanup();
});

describe("FolderDropConfirmation", () => {
  it("announces the path via role=\"status\" (ui.spec.md §5)", () => {
    render(<FolderDropConfirmation path="/Users/x/my-site" onDismiss={vi.fn()} useTHook={useTHook} />);
    expect(screen.getByRole("status")).toHaveTextContent("/Users/x/my-site");
  });

  it("words the confirmation as a first-time set when nothing was replaced", () => {
    render(<FolderDropConfirmation path="/Users/x/site" replacedPreviousPath={null} onDismiss={vi.fn()} useTHook={useTHook} />);
    expect(screen.getByRole("status").textContent).not.toMatch(/replac/i);
  });

  it("words the confirmation as a replacement when replacedPreviousPath is set (behavior.spec.md §1.2)", () => {
    render(<FolderDropConfirmation path="/Users/x/site-b" replacedPreviousPath="/Users/x/site-a" onDismiss={vi.fn()} useTHook={useTHook} />);
    expect(screen.getByRole("status").textContent).toMatch(/replac/i);
  });

  it("calls onDismiss when the dismiss control is activated, and is reachable by keyboard", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<FolderDropConfirmation path="/Users/x/site" onDismiss={onDismiss} useTHook={useTHook} />);

    const dismissButton = screen.getByRole("button", { name: /dismiss/i });
    await user.tab();
    expect(dismissButton).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
