import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Payments } from "../index.js";
import type { usePayments } from "../Payments.hooks.js";

describe("Payments injected hook", () => {
  it("renders the translator returned by the injected hook instead of the built-in dictionary", () => {
    const useQuotingPayments = (() => (key: string) => `«${key}»`) as unknown as typeof usePayments;
    render(<Payments usePaymentsHook={useQuotingPayments} />);
    expect(screen.getByRole("heading", { level: 1, name: "«Payments»" })).toBeInTheDocument();
    expect(screen.getByText("«Commerce»")).toBeInTheDocument();
  });
});
