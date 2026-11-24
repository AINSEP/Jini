// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DevicePreviewFrame } from "../DevicePreviewFrame.js";
import { DevicePreviewToggle } from "../DevicePreviewToggle.js";

/**
 * @file The shared device-width preview components (`components/DevicePreview`) rendered by the
 * Pages, Posts and Themes editors. Derived values are covered in `DevicePreview.hooks.unit.test.ts`;
 * this pins the rendered contract each editor relies on.
 */

const t = (key: string) => key;

describe("DevicePreviewToggle", () => {
  it("renders the three device buttons in a labelled group, with the selected one pressed", () => {
    render(<DevicePreviewToggle device="tablet" setDevice={vi.fn()} t={t} />);
    const group = screen.getByRole("group", { name: "Preview width" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Tablet" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tablet" })).toHaveClass("is-active");
    expect(screen.getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the selected device's pixel width", () => {
    render(<DevicePreviewToggle device="mobile" setDevice={vi.fn()} t={t} />);
    expect(screen.getByText("390px")).toBeInTheDocument();
  });

  it("calls setDevice with the clicked device", async () => {
    const setDevice = vi.fn();
    render(<DevicePreviewToggle device="desktop" setDevice={setDevice} t={t} />);
    await userEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(setDevice).toHaveBeenCalledWith("mobile");
  });

  it("tags each button with an agent handle only when a prefix is given", () => {
    const { unmount } = render(<DevicePreviewToggle device="desktop" setDevice={vi.fn()} t={t} handlePrefix="post-preview-width" />);
    expect(document.querySelector('[data-agent-element="post-preview-width-tablet"]')).not.toBeNull();
    unmount();
    render(<DevicePreviewToggle device="desktop" setDevice={vi.fn()} t={t} />);
    expect(document.querySelector("[data-agent-element]")).toBeNull();
  });
});

describe("DevicePreviewFrame", () => {
  it("renders its child inside a scaler sized to the device width and scaled to the pane", () => {
    const frameRef = vi.fn();
    render(
      <DevicePreviewFrame width={1280} frameRef={frameRef} paneWidth={640}>
        <iframe title="Doc" />
      </DevicePreviewFrame>,
    );
    const iframe = screen.getByTitle("Doc");
    const scaler = iframe.parentElement as HTMLElement;
    const frame = scaler.parentElement as HTMLElement;
    expect(scaler).toHaveClass("page-preview-scaler");
    expect(scaler.style.width).toBe("1280px");
    expect(scaler.style.transform).toBe("scale(0.5)");
    expect(frame).toHaveClass("page-preview-frame");
    expect(frame.style.height).toBe("450px");
    expect(frameRef).toHaveBeenCalledWith(frame);
  });

  it("writes no inline frame height when expanded", () => {
    render(
      <DevicePreviewFrame width={390} frameRef={vi.fn()} paneWidth={880} expanded>
        <iframe title="Doc" />
      </DevicePreviewFrame>,
    );
    const frame = screen.getByTitle("Doc").parentElement?.parentElement as HTMLElement;
    expect(frame.style.height).toBe("");
  });
});
