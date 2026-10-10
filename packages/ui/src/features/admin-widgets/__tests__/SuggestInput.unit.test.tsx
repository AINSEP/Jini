import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SuggestInput } from "../components/SuggestInput/SuggestInput.js";
import { matchSuggestions } from "../components/SuggestInput/SuggestInput.hooks.js";

/** @file `SuggestInput`: styled replacement for a native `<datalist>` on a free-text input. */
const SUGGESTIONS = ["Paris", "Miami", "Minneapolis", "Hudson Valley"];

function Harness({ onPick = vi.fn(), onKeyDown = vi.fn() }: { onPick?: (v: string) => void; onKeyDown?: () => void }) {
  const [value, setValue] = useState("");
  return <SuggestInput value={value} onValueChange={setValue} suggestions={SUGGESTIONS} onPick={onPick} onKeyDown={onKeyDown} aria-label="Term name" />;
}

describe("matchSuggestions", () => {
  it("keeps given order, matches anywhere case-insensitively, and caps the count", () => {
    expect(matchSuggestions({ typed: "mi", suggestions: SUGGESTIONS, limit: 8 })).toEqual(["Miami", "Minneapolis"]);
    expect(matchSuggestions({ typed: "  ", suggestions: SUGGESTIONS, limit: 2 })).toEqual(["Paris", "Miami"]);
    expect(matchSuggestions({ typed: "valley", suggestions: SUGGESTIONS, limit: 8 })).toEqual(["Hudson Valley"]);
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
