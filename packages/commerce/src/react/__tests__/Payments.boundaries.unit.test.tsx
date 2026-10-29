import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Payments } from "../index.js";

describe("Payments public component boundaries", () => {
  test("calling the component without props renders the accessible English overview", () => {
    render(Payments());
    expect(screen.getByRole("heading", { level: 1, name: "Payments" })).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(4);
    expect(within(screen.getByRole("region", { name: "Payment providers" })).getByText("Setup required")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Catalog and pricing" })).getByRole("link", { name: "Open products" }))
      .toHaveAttribute("href", "/admin/products");
    expect(within(screen.getByRole("region", { name: "Checkout and orders" })).getByRole("link", { name: "Open orders" }))
      .toHaveAttribute("href", "/admin/orders");
    expect(within(screen.getByRole("region", { name: "Revenue reporting" })).getByText("Awaiting read model")).toBeInTheDocument();
  });

  test.each([
    ["de", "Zahlungen", "Produkte öffnen", "Abonnements öffnen", "Bestellungen öffnen"],
    ["zh-CN", "付款", "打开产品", "打开订阅", "打开订单"],
    ["id", "Pembayaran", "Buka produk", "Buka langganan", "Buka pesanan"],
  ])("locale %s translates navigation while retaining stable destinations and agent handles", (locale, heading, products, subscriptions, orders) => {
    render(<Payments locale={locale} />);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    for (const [label, href, handle, agentLabel] of [
      [products, "/admin/products", "payments-open-products", "Go to Products"],
      [subscriptions, "/admin/subscriptions", "payments-open-subscriptions", "Go to Subscriptions"],
      [orders, "/admin/orders", "payments-open-orders", "Go to Orders"],
    ]) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("data-agent-element", handle);
      expect(link).toHaveAttribute("data-agent-role", "link");
      expect(link).toHaveAttribute("data-agent-label", agentLabel);
      link.focus();
      expect(link).toHaveFocus();
    }
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("changing locale refreshes headings and link labels without retaining stale translations", () => {
    const view = render(<Payments locale="de" />);
    expect(screen.getByRole("heading", { name: "Zahlungen" })).toBeInTheDocument();
    view.rerender(<Payments locale={undefined} />);
    expect(screen.getByRole("heading", { name: "Payments" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Zahlungen" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open subscriptions" })).toHaveAttribute("href", "/admin/subscriptions");
  });
});
