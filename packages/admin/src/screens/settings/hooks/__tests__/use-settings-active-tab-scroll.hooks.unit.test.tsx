// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSettingsActiveTabScroll } from "../use-settings-active-tab-scroll.hooks.js";

function Strip({ ready = true, active = "memory", isPhone }: {
  ready?: boolean; active?: string; isPhone?: () => boolean;
}) {
  const ref = useSettingsActiveTabScroll({ ready, tabId: active }, isPhone ? { isPhone } : {});
  return <div ref={ref}>{ready ? <nav className="jini-tabbed-dialog-sidebar">
    <button className="jini-tabbed-dialog-nav-item" aria-pressed={active === "execution"}>Execution</button>
    <button className="jini-tabbed-dialog-nav-item" aria-pressed={active === "memory"}>Memory</button>
  </nav> : null}</div>;
}

describe("phone settings active tab", () => {
  it("reveals the deep-linked active tab after the loading gate opens", () => {
    const scrollIntoView = vi.fn();
    const isPhone = () => true;
    const { rerender } = render(<Strip ready={false} isPhone={isPhone} />);
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      rerender(<Strip isPhone={isPhone} />);
      expect(scrollIntoView.mock.contexts).toEqual([screen.getByRole("button", { name: "Memory" })]);
      expect(scrollIntoView.mock.calls).toEqual([[{ block: "nearest", inline: "center", behavior: "instant" }]]);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("follows shell-owned tab changes and disconnects on unmount", async () => {
    const { unmount } = render(<Strip isPhone={() => true} />);
    const execution = screen.getByRole("button", { name: "Execution" });
    const memory = screen.getByRole("button", { name: "Memory" });
    const scrollIntoView = vi.fn();
    execution.scrollIntoView = scrollIntoView;
    act(() => {
      memory.setAttribute("aria-pressed", "false");
      execution.setAttribute("aria-pressed", "true");
    });
    await waitFor(() => expect(scrollIntoView.mock.calls).toEqual([
      [{ block: "nearest", inline: "center", behavior: "instant" }],
    ]));
    unmount();
    act(() => execution.setAttribute("aria-pressed", "false"));
    await act(async () => { await Promise.resolve(); });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not scroll the desktop sidebar", async () => {
    render(<Strip isPhone={() => false} />);
    const memory = screen.getByRole("button", { name: "Memory" });
    const scrollIntoView = vi.fn();
    memory.scrollIntoView = scrollIntoView;
    act(() => memory.setAttribute("aria-pressed", "true"));
    await act(async () => { await Promise.resolve(); });
    expect(scrollIntoView.mock.calls).toEqual([]);
  });

  it("reveals the active tab when the viewport becomes phone width", () => {
    let phone = false;
    const { unmount } = render(<Strip isPhone={() => phone} />);
    const scrollIntoView = vi.fn();
    screen.getByRole("button", { name: "Memory" }).scrollIntoView = scrollIntoView;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(scrollIntoView.mock.calls).toEqual([]);
    phone = true;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(scrollIntoView.mock.calls).toEqual([[{ block: "nearest", inline: "center", behavior: "instant" }]]);
    unmount();
    act(() => window.dispatchEvent(new Event("resize")));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

it("uses the browser's phone media query when no viewport override is supplied", () => {
  const matchMedia = vi.fn((query: string) => ({ matches: query === "(max-width: 640px)" }));
  vi.stubGlobal("matchMedia", matchMedia);
  const scrollIntoView = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  try {
    const { unmount } = render(<Strip active="execution" />);
    expect(matchMedia.mock.calls).toEqual([["(max-width: 640px)"]]);
    expect(scrollIntoView.mock.contexts).toEqual([screen.getByRole("button", { name: "Execution" })]);
    expect(scrollIntoView.mock.calls).toEqual([[{ block: "nearest", inline: "center", behavior: "instant" }]]);
    unmount();
  } finally {
    if (original === undefined) Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    else HTMLElement.prototype.scrollIntoView = original;
    vi.unstubAllGlobals();
  }
});
