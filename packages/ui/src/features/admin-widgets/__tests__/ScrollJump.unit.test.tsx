import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScrollJumpButtons } from "../components/ScrollJump/ScrollJump.js";
import { useScrollJump } from "../components/ScrollJump/ScrollJump.hooks.js";
import { scrollJumpBehavior, scrollJumpTarget, scrollJumpVisibility } from "../components/ScrollJump/ScrollJump.rules.js";

describe("scrollJumpVisibility", () => {
  it("shows nothing on a page shorter than two viewports", () => {
    expect(scrollJumpVisibility({ scrollTop: 50, scrollHeight: 1599, clientHeight: 800 })).toEqual({ showTop: false, showBottom: false });
  });

  it("shows only ↓ at the top, both in the middle, only ↑ at the bottom", () => {
    const page = { scrollHeight: 3000, clientHeight: 800 };
    expect(scrollJumpVisibility({ ...page, scrollTop: 0 })).toEqual({ showTop: false, showBottom: true });
    expect(scrollJumpVisibility({ ...page, scrollTop: 1000 })).toEqual({ showTop: true, showBottom: true });
    expect(scrollJumpVisibility({ ...page, scrollTop: 2200 })).toEqual({ showTop: true, showBottom: false });
  });

  it("treats a few px from an edge as at that edge", () => {
    const page = { scrollHeight: 3000, clientHeight: 800 };
    expect(scrollJumpVisibility({ ...page, scrollTop: 8 }).showTop).toBe(false);
    expect(scrollJumpVisibility({ ...page, scrollTop: 2193 }).showBottom).toBe(false);
  });

  it("shows nothing for a box with no height yet", () => {
    expect(scrollJumpVisibility({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toEqual({ showTop: false, showBottom: false });
  });
});

describe("scroll jump helpers", () => {
  it("jumps instantly for reduced motion, smoothly otherwise", () => {
    expect(scrollJumpBehavior({ reducedMotion: true })).toBe("auto");
    expect(scrollJumpBehavior({ reducedMotion: false })).toBe("smooth");
  });

  it("targets 0 for the top and the content height for the bottom", () => {
    expect(scrollJumpTarget({ edge: "top", scrollHeight: 4000 })).toBe(0);
    expect(scrollJumpTarget({ edge: "bottom", scrollHeight: 4000 })).toBe(4000);
  });
});

describe("ScrollJumpButtons", () => {
  const fakeJump = (state: { showTop: boolean; showBottom: boolean }, jump = vi.fn()) => () => ({ ...state, jump });

  it("renders nothing when neither edge applies", () => {
    const { container } = render(<ScrollJumpButtons container={null} useJump={fakeJump({ showTop: false, showBottom: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the inapplicable button's slot but takes it out of use", () => {
    render(<ScrollJumpButtons container={null} useJump={fakeJump({ showTop: false, showBottom: true })} />);
    expect(screen.getByRole("button", { name: "Scroll to top", hidden: true })).toHaveAttribute("data-off");
    expect(screen.getByRole("button", { name: "Scroll to bottom" })).not.toHaveAttribute("data-off");
  });

  it("names the buttons with the host's labels and jumps to the clicked edge", () => {
    const jump = vi.fn();
    render(<ScrollJumpButtons container={null} labels={{ toTop: "Arriba", toBottom: "Abajo" }} useJump={fakeJump({ showTop: true, showBottom: true }, jump)} />);
    fireEvent.click(screen.getByRole("button", { name: "Arriba" }));
    fireEvent.click(screen.getByRole("button", { name: "Abajo" }));
    expect(jump.mock.calls).toEqual([["top"], ["bottom"]]);
  });
});

describe("useScrollJump", () => {
  function Probe({ container, reducedMotion }: { container: HTMLElement | null; reducedMotion?: () => boolean }) {
    const { showTop, showBottom, jump } = useScrollJump({ container }, reducedMotion ? { reducedMotion } : {});
    return <div><span data-testid="state">{`${showTop}/${showBottom}`}</span><button type="button" onClick={() => jump("bottom")}>go</button></div>;
  }

  function tallBox(scrollTop = 0) {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollHeight", { value: 3000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 800, configurable: true });
    el.scrollTop = scrollTop;
    el.scrollTo = vi.fn() as unknown as typeof el.scrollTo;
    return el;
  }

  it("is hidden without a container", () => {
    render(<Probe container={null} />);
    expect(screen.getByTestId("state")).toHaveTextContent("false/false");
  });

  it("reads the container on mount and follows its scroll events", () => {
    const el = tallBox();
    render(<Probe container={el} />);
    expect(screen.getByTestId("state")).toHaveTextContent("false/true");
    act(() => { el.scrollTop = 1000; el.dispatchEvent(new Event("scroll")); });
    expect(screen.getByTestId("state")).toHaveTextContent("true/true");
  });

  it("scrolls the container to the requested edge with the motion preference applied", () => {
    const el = tallBox(1000);
    render(<Probe container={el} reducedMotion={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 3000, behavior: "auto" });
  });
});
