import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComingSoonPanel } from "../components/ComingSoonPanel.js";

describe("ComingSoonPanel content and inert markup", () => {
  // F1.2/F2.4: removing the optional note or moving children outside inert must fail.
  // jsdom cannot prove native inert click/focus suppression; assert the emitted HTML contract.
  it("keeps the real child mounted inside inert and displays both status lines", () => {
    render(<ComingSoonPanel label="Coming soon" note="Webhook delivery is pending."><button>Configure webhook</button></ComingSoonPanel>);
    expect(screen.getByRole("note").textContent).toBe("Coming soon Webhook delivery is pending.");
    const child = screen.getByRole("button", { name: "Configure webhook" });
    expect(child.parentElement).toHaveAttribute("inert");
    expect(child.parentElement).toHaveClass("settings-ui-inert-control");
  });

  it("removes an omitted or empty note on rerender while retaining the children", () => {
    const { rerender } = render(<ComingSoonPanel label="Pending" note="Previous detail"><span>Preview</span></ComingSoonPanel>);
    expect(screen.getByRole("note").textContent).toBe("Pending Previous detail");
    rerender(<ComingSoonPanel label="Pending"><span>Preview</span></ComingSoonPanel>);
    expect(screen.getByRole("note").textContent).toBe("Pending");
    expect(screen.getByText("Preview").parentElement).toHaveAttribute("inert");
    rerender(<ComingSoonPanel label="Pending" note=""><span>Preview</span></ComingSoonPanel>);
    expect(screen.getByRole("note").textContent).toBe("Pending");
  });
});
