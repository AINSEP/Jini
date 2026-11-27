// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { useContext } from "react";
import { expect, it } from "vitest";
import { AdminFetchQueryAdapterContext } from "../fetch-query/adapter-context.js";

function Observer({ label }: { label: string }) {
  const adapter = useContext(AdminFetchQueryAdapterContext);
  return <output aria-label={label}>{adapter ?? "No adapter selected"}</output>;
}

it("reports the host's query adapter only inside that host's provider", () => {
  const host = (adapter: "builtin" | "tanstack") => <>
    <Observer label="Unconfigured" />
    <AdminFetchQueryAdapterContext.Provider value={adapter}><Observer label="Host adapter" /></AdminFetchQueryAdapterContext.Provider>
  </>;
  const { rerender } = render(host("builtin"));
  expect(screen.getByLabelText("Host adapter").textContent).toBe("builtin");
  expect(screen.getByLabelText("Unconfigured").textContent).toBe("No adapter selected");
  rerender(host("tanstack"));
  expect(screen.getByLabelText("Host adapter").textContent).toBe("tanstack");
  expect(screen.getByLabelText("Unconfigured").textContent).toBe("No adapter selected");
});
