// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { cleanup, render as renderBare, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { FolderPathButton } from "../FolderPathButton.js";

/** Identity translator, injected as `useTHook`; rendered under the fake admin kit. */
const useTHook = () => (key: string) => key;
const kit = fakeAdminKit();
const render = (ui: ReactElement) => renderBare(<AdminKitProvider kit={kit}>{ui}</AdminKitProvider>);

afterEach(() => {
  cleanup();
});

describe("FolderPathButton", () => {
  it("is a labelled button styled exactly like the composer's + and opens the picker", async () => {
    const onPick = vi.fn();
    render(<FolderPathButton picking={false} onPick={onPick} useTHook={useTHook} />);
    const button = screen.getByRole("button", { name: "Choose a folder" });
    expect(button).toHaveAttribute("title", "Choose a folder");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("jini-composer-attach");
    await userEvent.setup().click(button);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("is disabled while the dialog is open", () => {
    render(<FolderPathButton picking onPick={vi.fn()} useTHook={useTHook} />);
    expect(screen.getByRole("button", { name: "Choose a folder" })).toBeDisabled();
  });
});
