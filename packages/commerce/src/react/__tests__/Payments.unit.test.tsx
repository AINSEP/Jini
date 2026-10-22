import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Payments } from "..";

/**
 * @file Owner-directed Open SaaS Commerce adaptation, constrained by ADR-001.
 *
 * Open SaaS puts provider selection, plans, checkout, subscription management, and revenue
 * reporting into one understandable journey. Tovu does not yet have an approved Commerce admin
 * read contract, so this test pins the safe first slice: an honest, provider-neutral overview that
 * routes operators to the existing Commerce surfaces without claiming that money-path operations
 * or aggregate metrics already exist.
 */

describe("Payments — provider-neutral Commerce overview", () => {
  it("connects the Open SaaS payment journey to Tovu's existing Commerce routes", () => {
    render(<Payments />);

    expect(screen.getByRole("heading", { level: 1, name: "Payments" })).toBeInTheDocument();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("PayPal")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Open products" })).toHaveAttribute("href", "/admin/products");
    expect(screen.getByRole("link", { name: "Open subscriptions" })).toHaveAttribute(
      "href",
      "/admin/subscriptions",
    );
    expect(screen.getByRole("link", { name: "Open orders" })).toHaveAttribute("href", "/admin/orders");
  });

  it("states the missing backend boundary instead of inventing readiness, metrics, or controls", () => {
    const { container } = render(<Payments />);

    expect(screen.getByText(/commerce read model is not connected yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no revenue totals or trends are shown/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/\$\s*\d/);
  });
});
