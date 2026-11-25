import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PostEditorSlugCollisionWarning } from "../editor/notices/PostEditorSlugCollisionWarning.js";

const bindings = {
  agentHandle: ({ handle }: { handle: string }) => ({ "data-agent-element": handle }),
  overridesThemePageSelectValue: ({ overridesThemePage }: { overridesThemePage: boolean | null }): "default" | "post" | "theme" => overridesThemePage === null ? "default" : overridesThemePage ? "post" : "theme",
  overridesThemePageFromSelectValue: ({ value }: { value: string }) => value === "default" ? null : value === "post",
  copy: { warning: "warning", field: "winner", defaultOption: "default winner", postOption: "post winner", themeOption: "theme winner", regionAgentLabel: "region", fieldAgentLabel: "field" },
};

it("shows no warning without a collision", () => {
  const { container } = render(<PostEditorSlugCollisionWarning {...bindings} hasSlugCollision={false} overridesThemePage={null} setOverridesThemePage={vi.fn()} t={(key) => key} />);
  expect(container.innerHTML).toBe("");
});

it.each([
  ["default", null],
  ["post", true],
  ["theme", false],
] as const)("round-trips %s through the supplied tri-state mappers", (value, stored) => {
  const setOverridesThemePage = vi.fn();
  const t = vi.fn((key: string) => `translated:${key}`);
  const props = { ...bindings, hasSlugCollision: true, overridesThemePage: stored, setOverridesThemePage, t };
  const { rerender } = render(<PostEditorSlugCollisionWarning {...props} />);
  const select = screen.getByRole("combobox", { name: "translated:winner" });
  expect(select).toHaveValue(value);
  fireEvent.change(select, { target: { value } });
  expect(setOverridesThemePage).toHaveBeenCalledExactlyOnceWith(stored);
  rerender(<PostEditorSlugCollisionWarning {...props} overridesThemePage={setOverridesThemePage.mock.calls[0]![0]} />);
  expect(select).toHaveValue(value);
  for (const key of ["warning", "winner", "default winner", "post winner", "theme winner"]) {
    expect(t).toHaveBeenCalledWith(key);
  }
});
