// @vitest-environment jsdom
import { cleanup, render as renderBare, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { FolderDropError } from "../FolderDropError.js";

/** Identity translator, injected as `useTHook`; rendered under the fake admin kit. */
const useTHook = () => (key: string) => key;
const kit = fakeAdminKit();
const render = (ui: ReactElement) => renderBare(<AdminKitProvider kit={kit}>{ui}</AdminKitProvider>);

afterEach(() => {
  cleanup();
});

describe("FolderDropError", () => {
  it("announces via role=\"alert\" (ui.spec.md §5)", () => {
    render(<FolderDropError path="/Users/x/gone" reason="does-not-exist" onRetry={vi.fn()} onDismiss={vi.fn()} useTHook={useTHook} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it.each([
    ["not-a-directory", /not a folder/i],
    ["does-not-exist", /couldn't be found/i],
    ["endpoint-unreachable", /try again in a moment/i],
  ] as const)("shows one of the three fixed, plain-language strings for reason=%s — never a raw server error", (reason, expected) => {
    render(<FolderDropError path="/Users/x/p" reason={reason} onRetry={vi.fn()} onDismiss={vi.fn()} useTHook={useTHook} />);
    expect(screen.getByRole("alert").textContent).toMatch(expected);
  });

  it("the retry control's accessible name includes the word \"retry\", not just an icon (ui.spec.md §5)", () => {
    render(<FolderDropError path="/Users/x/p" reason="does-not-exist" onRetry={vi.fn()} onDismiss={vi.fn()} useTHook={useTHook} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls onRetry with the original path when retry is activated", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<FolderDropError path="/Users/x/gone" reason="does-not-exist" onRetry={onRetry} onDismiss={vi.fn()} useTHook={useTHook} />);

    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledWith({ path: "/Users/x/gone" });
  });

  it("calls onDismiss when dismissed", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<FolderDropError path="/Users/x/gone" reason="does-not-exist" onRetry={vi.fn()} onDismiss={onDismiss} useTHook={useTHook} />);

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
