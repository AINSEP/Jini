import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SuggestInput } from "../components/SuggestInput/SuggestInput.js";

const SUGGESTIONS = ["Paris", "Miami"];

describe("SuggestInput host props", () => {
  it("appends a host class to the wrapper and keeps the base class", () => {
    const { container } = render(<SuggestInput value="" onValueChange={vi.fn()} suggestions={SUGGESTIONS} onPick={vi.fn()} className="wide" />);
    expect(container.firstElementChild).toHaveClass("jini-suggest-input", "wide");
  });

  it("publishes an agent handle labelled by agentLabel, then aria-label, then a generic fallback", () => {
    const { rerender } = render(<SuggestInput value="" onValueChange={vi.fn()} suggestions={SUGGESTIONS} onPick={vi.fn()} agentHandle="term-name" agentLabel="Term" aria-label="Term name" />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("data-agent-element", "term-name");
    expect(input).toHaveAttribute("data-agent-role", "field");
    expect(input).toHaveAttribute("data-agent-label", "Term");
    rerender(<SuggestInput value="" onValueChange={vi.fn()} suggestions={SUGGESTIONS} onPick={vi.fn()} agentHandle="term-name" aria-label="Term name" />);
    expect(screen.getByRole("combobox")).toHaveAttribute("data-agent-label", "Term name");
    rerender(<SuggestInput value="" onValueChange={vi.fn()} suggestions={SUGGESTIONS} onPick={vi.fn()} agentHandle="term-name" />);
    expect(screen.getByRole("combobox")).toHaveAttribute("data-agent-label", "Text with suggestions");
  });

  it("publishes no agent markup without a handle", () => {
    render(<SuggestInput value="" onValueChange={vi.fn()} suggestions={SUGGESTIONS} onPick={vi.fn()} />);
    expect(screen.getByRole("combobox")).not.toHaveAttribute("data-agent-element");
  });
});

describe("SuggestInput IME composition", () => {
  it("hands composing keystrokes straight to the caller without moving or picking the highlight", () => {
    const onKeyDown = vi.fn();
    const onPick = vi.fn();
    render(<SuggestInput value="" onValueChange={vi.fn()} suggestions={SUGGESTIONS} onPick={onPick} onKeyDown={onKeyDown} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onKeyDown).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("ignores composing keystrokes quietly when the caller has no key handler", () => {
    const onPick = vi.fn();
    render(<SuggestInput value="" onValueChange={vi.fn()} suggestions={SUGGESTIONS} onPick={onPick} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(() => fireEvent.keyDown(input, { key: "Enter", isComposing: true })).not.toThrow();
    expect(onPick).not.toHaveBeenCalled();
  });
});
