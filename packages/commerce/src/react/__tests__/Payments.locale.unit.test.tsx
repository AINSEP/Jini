import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Payments } from "../Payments.js";

describe("Payments readiness and localized navigation", () => {
  // F1.3/F4.3: associating a readiness label with the wrong capability must fail.
  it("assigns each capability its own honest readiness status", () => {
    render(<Payments />);
    expect(within(screen.getByRole("region", { name: "Payment providers" })).getByText("Setup required")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Catalog and pricing" })).getByText("Planned")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Checkout and orders" })).getByText("Planned")).toBeInTheDocument();
    const reporting = screen.getByRole("region", { name: "Revenue reporting" });
    expect(within(reporting).getByText("Awaiting read model")).toBeInTheDocument();
    expect(within(reporting).getByText("No revenue totals or trends are shown until a Commerce projection has an approved contract and real source data.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  // F2.4/F6.2: ignoring the locale at the component's translation call site must fail.
  it("renders Spanish links with unchanged destinations, then English fallback on rerender", () => {
    const { rerender } = render(<Payments locale="es" />);
    expect(screen.getByRole("heading", { level: 1, name: "Pagos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir productos" })).toHaveAttribute("href", "/admin/products");
    expect(screen.getByRole("link", { name: "Abrir suscripciones" })).toHaveAttribute("href", "/admin/subscriptions");
    expect(screen.getByRole("link", { name: "Abrir pedidos" })).toHaveAttribute("href", "/admin/orders");
    expect(within(screen.getByRole("region", { name: "Proveedores de pago" })).getByText("Configuración necesaria")).toBeInTheDocument();
    rerender(<Payments locale="unsupported-locale" />);
    expect(screen.getByRole("heading", { level: 1, name: "Payments" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open orders" })).toHaveAttribute("href", "/admin/orders");
  });
});
