// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteToast } from "../SiteToast.js";
import { AUTO_HIDE_WITH_NOTE_MS, toastLifetime, useSiteToast, type SiteToastCopy } from "../use-site-toast.hooks.js";

const copy: SiteToastCopy = {
  created: ({ displayName }) => `Made ${displayName}`,
  added: ({ displayName }) => `Added ${displayName}`,
  setAside: ({ count }) => `${count} set aside`,
};

describe("useSiteToast", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("announces created, imported (with a counted note and the whole list) and added sites in the host's words", () => {
    let lastCreated: { displayName: string } | null = null;
    const view = renderHook(() => useSiteToast({ lastCreated, copy }));
    expect(view.result.current.toast).toBe(null);
    lastCreated = { displayName: "Bakery" };
    view.rerender();
    expect(view.result.current.toast).toEqual({ message: "Made Bakery" });
    act(() => view.result.current.announceImported({ displayName: "Shop", warnings: ["A", "B"] }));
    expect(view.result.current.toast).toEqual({ message: "Made Shop", note: "2 set aside", items: ["A", "B"] });
    act(() => view.result.current.announceImported({ displayName: "Plain", warnings: [] }));
    expect(view.result.current.toast).toEqual({ message: "Made Plain" });
    act(() => view.result.current.dismiss());
    act(() => view.result.current.announceAdded({ displayName: "Old", alreadyTracked: true }));
    expect(view.result.current.toast).toBe(null);
    act(() => view.result.current.announceAdded({ displayName: "Folder" }));
    expect(view.result.current.toast).toEqual({ message: "Added Folder" });
  });

  it("a plain toast hides after the short delay; one with a note stays the extended lifetime", () => {
    const view = renderHook(() => useSiteToast({ lastCreated: null, copy }, { autoHideMs: 20 }));
    act(() => view.result.current.announceAdded({ displayName: "x" }));
    act(() => { vi.advanceTimersByTime(20); });
    expect(view.result.current.toast).toBe(null);
    act(() => view.result.current.announceImported({ displayName: "Shop", warnings: ["Read me."] }));
    act(() => { vi.advanceTimersByTime(AUTO_HIDE_WITH_NOTE_MS - 1); });
    expect(view.result.current.toast).not.toBe(null);
    act(() => { vi.advanceTimersByTime(1); });
    expect(view.result.current.toast).toBe(null);
    expect(toastLifetime({ toast: { message: "m", items: [] }, autoHideMs: 20_000 })).toBe(20_000);
  });
});

describe("SiteToast", () => {
  const labels = { showList: "Show list", dismiss: "Dismiss" };

  it("renders nothing without a toast", () => {
    const { container } = render(<SiteToast toast={null} onDismiss={() => {}} labels={labels} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows message, note and list with its own and the host's classes, and dismisses", () => {
    const onDismiss = vi.fn();
    render(<SiteToast toast={{ message: "Made Shop", note: "1 set aside", items: ["A"] }} onDismiss={onDismiss} labels={labels} classNames={{ root: "host-toast", dismiss: "host-button" }} />);
    const status = screen.getByRole("status");
    expect(status.className).toBe("jini-site-toast host-toast");
    expect(screen.getByText("Made Shop").className).toBe("jini-site-toast__message");
    expect(screen.getByText("1 set aside").className).toBe("jini-site-toast__note");
    expect(screen.getByText("Show list").tagName).toBe("SUMMARY");
    expect(screen.getByText("A").tagName).toBe("LI");
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    expect(dismiss.className).toBe("jini-site-toast__dismiss host-button");
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
