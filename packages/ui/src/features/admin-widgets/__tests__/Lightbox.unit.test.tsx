import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Lightbox } from "../components/Lightbox/Lightbox.js";
import { closeLightboxDialog, openLightboxDialog } from "../components/Lightbox/Lightbox.hooks.js";

/**
 * @file The shared `Lightbox`. jsdom implements neither `showModal` nor `close`, so the
 * `open`-attribute fallback is what these assertions observe; Escape is the dialog's native
 * `cancel` event.
 */

function Gallery({ count, start = 0, onClose = () => {} }: { count: number; start?: number; onClose?: () => void }) {
  const [index, setIndex] = useState(start);
  return (
    <Lightbox open title={`Item ${index + 1}`} index={index} count={count} onNavigate={setIndex} onClose={onClose}>
      <img src={`/m/${index}.png`} alt={`media ${index + 1}`} />
    </Lightbox>
  );
}

const prev = () => screen.getByRole("button", { name: "Previous" });
const next = () => screen.getByRole("button", { name: "Next" });

describe("Lightbox chrome", () => {
  it("shows the title, the quiet counter and the media while open", () => {
    render(<Gallery count={3} start={1} />);
    expect(screen.getByRole("heading", { name: "Item 2" })).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toHaveClass("jini-lightbox-counter");
    expect(screen.getByAltText("media 2")).toHaveAttribute("src", "/m/1.png");
    expect(document.querySelector("dialog.jini-lightbox")).toHaveAttribute("aria-labelledby");
  });

  it("renders nothing inside the dialog while closed", () => {
    render(<Lightbox open={false} title="x" onClose={vi.fn()}><img alt="x" /></Lightbox>);
    const dialog = document.querySelector("dialog.jini-lightbox")!;
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(dialog.childElementCount).toBe(0);
  });

  it("has no arrows or counter for a single item", () => {
    render(<Gallery count={1} />);
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(document.querySelector(".jini-lightbox-counter")).toBeNull();
    expect(document.querySelector(".jini-lightbox-footer")).toBeNull();
  });

  it("places caller actions in the footer beside the arrows", () => {
    render(<Lightbox open title="x" index={0} count={2} onNavigate={vi.fn()} onClose={vi.fn()} actions={<a href="/d">Download</a>}><img alt="x" /></Lightbox>);
    const footer = document.querySelector(".jini-lightbox-footer")!;
    expect(footer.querySelector(".jini-lightbox-actions")).toHaveTextContent("Download");
    expect(footer.querySelector(".jini-lightbox-nav")!.children).toHaveLength(2);
  });

  it("spreads per-part attributes and translated labels", () => {
    render(
      <Lightbox open title="x" index={0} count={2} onNavigate={vi.fn()} onClose={vi.fn()} labels={{ close: "Schließen", next: "Weiter" }}
        partAttrs={{ dialog: { "data-jini-part": "media.lightbox" }, next: { "data-agent-element": "lightbox-next" } }}>
        <img alt="x" />
      </Lightbox>,
    );
    expect(document.querySelector("dialog")).toHaveAttribute("data-jini-part", "media.lightbox");
    expect(screen.getByRole("button", { name: "Weiter" })).toHaveAttribute("data-agent-element", "lightbox-next");
    expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
  });
});

describe("Lightbox navigation", () => {
  it("disables previous on the first item and next on the last", () => {
    render(<Gallery count={2} />);
    expect(prev()).toBeDisabled();
    expect(next()).toBeEnabled();
    fireEvent.click(next());
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    expect(prev()).toBeEnabled();
  });

  it("moves with ArrowRight/ArrowLeft and clamps at both ends", () => {
    render(<Gallery count={3} />);
    const dialog = document.querySelector("dialog")!;
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("hands focus to the other arrow when the focused one reaches its end", () => {
    render(<Gallery count={2} />);
    next().focus();
    fireEvent.click(next());
    expect(prev()).toHaveFocus();
    fireEvent.click(prev());
    expect(next()).toHaveFocus();
  });

  it("ignores arrow keys when there is nowhere to navigate", () => {
    const onNavigate = vi.fn();
    render(<Lightbox open title="x" index={0} count={1} onNavigate={onNavigate} onClose={vi.fn()}><img alt="x" /></Lightbox>);
    fireEvent.keyDown(document.querySelector("dialog")!, { key: "ArrowRight" });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("Lightbox dismissal and focus", () => {
  it("routes Escape (native cancel) through onClose and prevents the browser's own close", () => {
    const onClose = vi.fn();
    render(<Gallery count={2} onClose={onClose} />);
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(document.querySelector("dialog")!, cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cancel.defaultPrevented).toBe(true);
  });

  it("closes on the empty stage or the dialog itself, not on the media or the title", () => {
    const onClose = vi.fn();
    render(<Gallery count={2} onClose={onClose} />);
    fireEvent.click(screen.getByAltText("media 1"));
    fireEvent.click(screen.getByRole("heading"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".jini-lightbox-stage")!);
    fireEvent.click(document.querySelector("dialog")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("focuses Close on open and returns focus to the trigger on close", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          <Lightbox open={open} title="x" onClose={() => setOpen(false)}><img alt="x" /></Lightbox>
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Close preview" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(trigger).toHaveFocus();
  });
});

describe("native dialog helpers", () => {
  it("use showModal/close when present and never re-open or re-close", () => {
    const dialog = document.createElement("dialog");
    const showModal = vi.fn(() => dialog.setAttribute("open", ""));
    const close = vi.fn(() => dialog.removeAttribute("open"));
    Object.assign(dialog, { showModal, close });
    openLightboxDialog(dialog);
    openLightboxDialog(dialog);
    expect(showModal).toHaveBeenCalledTimes(1);
    closeLightboxDialog(dialog);
    closeLightboxDialog(dialog);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
