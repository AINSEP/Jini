// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Chip, CopyButton, Loaded, Section, when } from "../EmailParts.js";

/** @file The pieces every Email tab shares: chip tone class, titled card naming, the load states and the copy button. */
afterEach(() => vi.useRealTimers());

describe("EmailParts", () => {
  it("Chip puts its tone on the shared status class", () => {
    render(<Chip tone="warning">Heads up</Chip>);
    expect(screen.getByText("Heads up").className).toBe("status status-warning");
  });

  it("Section names its region by the visible title, or by aria-label when the title is hidden", () => {
    const { unmount } = render(<Section id="a" title="Provider">body</Section>);
    expect(screen.getByRole("region", { name: "Provider" })).toBeTruthy();
    unmount();
    render(<Section id="b" title="Sender" hideTitle>body</Section>);
    expect(screen.queryByRole("heading", { name: "Sender" })).toBeNull();
    expect(screen.getByRole("region", { name: "Sender" })).toBeTruthy();
  });

  it("Loaded renders data once loaded, says loading/forbidden, and offers Retry on a failed read", () => {
    const retry = vi.fn();
    const { rerender } = render(<Loaded view={{ kind: "loaded", data: 7 }} locale="en">{(n) => <b>n={n}</b>}</Loaded>);
    expect(screen.getByText("n=7")).toBeTruthy();
    rerender(<Loaded view={{ kind: "loading" }} locale="en">{() => null}</Loaded>);
    expect(screen.getByRole("status").textContent).toBe("Loading…");
    rerender(<Loaded view={{ kind: "forbidden" }} locale="en">{() => null}</Loaded>);
    expect(screen.getByText("You don't have permission to see this.")).toBeTruthy();
    rerender(<Loaded view={{ kind: "error", message: "boom" }} locale="en" retry={retry}>{() => null}</Loaded>);
    expect(screen.getByRole("alert").textContent).toContain("boom");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("CopyButton writes the text and says Copied for a moment", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CopyButton text="v=spf1" label="SPF" locale="en" handle="copy-spf" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy: SPF" }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith("v=spf1");
    expect(screen.getByRole("button").textContent).toBe("Copied");
    act(() => { vi.advanceTimersByTime(1600); });
    expect(screen.getByRole("button").textContent).toBe("Copy");
    vi.unstubAllGlobals();
  });

  it("when formats a parseable stamp and returns the raw text otherwise", () => {
    expect(when({ iso: "not a date", locale: "en" })).toBe("not a date");
    expect(when({ iso: "2026-11-24T10:00:00Z", locale: "en" })).toContain("2026");
  });
});
