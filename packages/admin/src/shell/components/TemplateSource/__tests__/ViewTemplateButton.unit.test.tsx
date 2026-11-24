// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewTemplateButton } from "../ViewTemplateButton.js";

function translate(key: string): string {
  if (key !== "View Template") throw new Error(`Unexpected translation key: ${key}`);
  return "Ver plantilla";
}

describe("ViewTemplateButton", () => {
  // F2.1/F2.5/F3.1: losing type=button must submit the enclosing form and fail this test.
  it("delivers the view action once without submitting its enclosing editor form", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={onSubmit}><ViewTemplateButton disabled={false} onClick={onClick} t={translate} agentHandleId="page-view-template" /></form>);
    const button = screen.getByRole("button", { name: "Ver plantilla" });
    expect(button).toHaveAttribute("title", "Ver plantilla");
    expect(button).toHaveAttribute("data-agent-element", "page-view-template");
    expect(button).toHaveAttribute("data-agent-role", "button");
    expect(button).toHaveAttribute("data-agent-label", "Open a read-only view of the selected template's HTML source. Nothing here is editable.");
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // F6.2/F7.5: each test owns its callback; disabling must suppress the action after rerender.
  it("blocks the disabled action and uses the updated editor handle after rerender", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<ViewTemplateButton disabled={false} onClick={onClick} t={translate} agentHandleId="post-view-template" />);
    expect(screen.getByRole("button", { name: "Ver plantilla" })).toBeEnabled();
    rerender(<ViewTemplateButton disabled onClick={onClick} t={translate} agentHandleId="page-view-template" />);
    const button = screen.getByRole("button", { name: "Ver plantilla" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-agent-element", "page-view-template");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
