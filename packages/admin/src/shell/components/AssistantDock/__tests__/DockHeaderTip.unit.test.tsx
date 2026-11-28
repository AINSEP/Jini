// @vitest-environment jsdom
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { DockHeaderTip } from "../DockHeaderTip.js";

/**
 * @file `DockHeaderTip` with its real `useDockHeaderTip` hook over the fake kit's stateful
 * `useInfoTip`: the wrapper only listens (hover/focus show; leave/blur/click/Escape hide), and the
 * bubble is portalled to `document.body`, so it is looked up there by its label.
 */

afterEach(() => cleanup());

const kit = fakeAdminKit();
const KitWrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: KitWrapper });
const bubble = () => document.body.querySelector(".jini-ui-info-tip-bubble");

describe("DockHeaderTip", () => {
  it("opens on hover and closes on Escape, ignoring other keys and an Escape while already closed", () => {
    render(<DockHeaderTip label="Chats"><button type="button" aria-label="Chats">C</button></DockHeaderTip>);
    const button = screen.getByRole("button", { name: "Chats" });

    fireEvent.keyDown(button, { key: "Escape" });
    expect(bubble()).toBeNull();

    fireEvent.mouseOver(button);
    expect(bubble()).toHaveTextContent("Chats");
    expect(bubble()).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(button, { key: "Enter" });
    expect(bubble()).not.toBeNull();

    fireEvent.keyDown(button, { key: "Escape" });
    expect(bubble()).toBeNull();
  });

  it("opens on keyboard focus and closes when the button's own click runs", () => {
    render(<DockHeaderTip label="Settings"><button type="button" aria-label="Settings">S</button></DockHeaderTip>);
    const button = screen.getByRole("button", { name: "Settings" });

    fireEvent.focus(button);
    expect(bubble()).toHaveTextContent("Settings");

    fireEvent.click(button);
    expect(bubble()).toBeNull();
  });

  it("stays closed when the pointer enters an open menu inside the wrapper", () => {
    render(<DockHeaderTip label="Settings"><div role="menu"><button type="button">Row</button></div></DockHeaderTip>);
    fireEvent.mouseOver(screen.getByRole("button", { name: "Row" }));
    expect(bubble()).toBeNull();
  });
});
