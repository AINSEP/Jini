const classes = { page: "page", pageHeader: "page-header", pageHeaderText: "page-header-text", pageKicker: "page-kicker", pageTitle: "page-title", pageDescription: "page-description", notice: "notice", panels: "dash-panels", panel: "dash-panel", panelHead: "dash-panel-head", panelTitle: "dash-panel-title", panelBody: "dash-panel-body", actions: "page-actions", disabledStatus: "status status-disabled", secondaryButton: "btn-secondary" };
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Payments } from "../index.js";
import { usePayments } from "../Payments.hooks.js";

describe("Payments injected hook", () => {
  it("renders the translator returned by the injected hook instead of the built-in dictionary", () => {
    const useQuotingPayments = (() => (key: string) => `«${key}»`) as unknown as typeof usePayments;
    render(<Payments classes={classes} usePaymentsHook={useQuotingPayments} />);
    expect(screen.getByRole("heading", { level: 1, name: "«Payments»" })).toBeInTheDocument();
    expect(screen.getByText("«Commerce»")).toBeInTheDocument();
  });
});
