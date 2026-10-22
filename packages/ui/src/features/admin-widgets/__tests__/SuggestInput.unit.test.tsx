import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SuggestInput } from "../components/SuggestInput/SuggestInput.js";
import { matchSuggestions, scrollOptionIntoView } from "../components/SuggestInput/SuggestInput.hooks.js";

/** @file `SuggestInput`: styled replacement for a native `<datalist>` on a free-text input. */
const SUGGESTIONS = ["Paris", "Miami", "Minneapolis", "Hudson Valley"];

const MANY = Array.from({ length: 25 }, (_, i) => `Place ${i + 1}`);

function Harness({ onPick = vi.fn(), onKeyDown = vi.fn(), suggestions = SUGGESTIONS, limit, scroll }: { onPick?: (v: string) => void; onKeyDown?: () => void; suggestions?: readonly string[]; limit?: number; scroll?: (option: Element) => void }) {
  const [value, setValue] = useState("");
  return <SuggestInput value={value} onValueChange={setValue} suggestions={suggestions} onPick={onPick} onKeyDown={onKeyDown} limit={limit} scrollOptionIntoView={scroll} aria-label="Term name" />;
}

describe("matchSuggestions", () => {
  it("keeps given order, matches anywhere case-insensitively, and caps the count only when a limit is given", () => {
    expect(matchSuggestions({ typed: "mi", suggestions: SUGGESTIONS })).toEqual(["Miami", "Minneapolis"]);
    expect(matchSuggestions({ typed: "  ", suggestions: SUGGESTIONS }, { limit: 2 })).toEqual(["Paris", "Miami"]);
    expect(matchSuggestions({ typed: "valley", suggestions: SUGGESTIONS })).toEqual(["Hudson Valley"]);
    expect(matchSuggestions({ typed: "", suggestions: MANY })).toHaveLength(25);
  });
});

describe("scrollOptionIntoView", () => {
  it("scrolls the option the minimum distance, and is a no-op where the DOM lacks scrollIntoView (jsdom)", () => {
    const option = document.createElement("li");
    expect(() => scrollOptionIntoView(option)).not.toThrow();
    const scrollIntoView = vi.fn();
    Object.defineProperty(option, "scrollIntoView", { value: scrollIntoView });
    scrollOptionIntoView(option);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});

describe("SuggestInput", () => {
  it("opens a styled list (no native datalist) on focus and filters as you type", () => {
    const { container } = render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Term name" });
    expect(container.querySelector("datalist")).toBeNull();
    fireEvent.focus(input);
    expect(screen.getAllByRole("option")).toHaveLength(4);
    fireEvent.change(input, { target: { value: "mi" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Miami", "Minneapolis"]);
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("lists every match by default (no cap); a caller's limit still caps it", () => {
    const { unmount } = render(<Harness suggestions={MANY} />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(25);
    unmount();
    render(<Harness suggestions={MANY} limit={8} />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(8);
  });

  it("an arrow-key move scrolls the highlighted option into view; mouse hover does not", () => {
    const scroll = vi.fn();
    render(<Harness suggestions={MANY} scroll={scroll} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenLastCalledWith(screen.getByRole("option", { name: "Place 2" }));
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(scroll).toHaveBeenLastCalledWith(screen.getByRole("option", { name: "Place 25" }));
    scroll.mockClear();
    fireEvent.mouseEnter(screen.getByRole("option", { name: "Place 10" }));
    expect(screen.getByRole("option", { name: "Place 10" })).toHaveAttribute("aria-selected", "true");
    expect(scroll).not.toHaveBeenCalled();
  });

  it("arrow keys highlight and Enter picks the highlighted match without reaching the caller's onKeyDown", () => {
    const onPick = vi.fn(); const onKeyDown = vi.fn();
    render(<Harness onPick={onPick} onKeyDown={onKeyDown} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "mi" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Minneapolis" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("Minneapolis");
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("Enter with nothing highlighted goes to the caller (adds what was typed)", () => {
    const onPick = vi.fn(); const onKeyDown = vi.fn();
    render(<Harness onPick={onPick} onKeyDown={onKeyDown} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Tokyo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("a mousedown on an option picks it; Escape closes the list first, then reaches the caller", () => {
    const onPick = vi.fn(); const onKeyDown = vi.fn();
    render(<Harness onPick={onPick} onKeyDown={onKeyDown} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole("option", { name: "Paris" }));
    expect(onPick).toHaveBeenCalledWith("Paris");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
