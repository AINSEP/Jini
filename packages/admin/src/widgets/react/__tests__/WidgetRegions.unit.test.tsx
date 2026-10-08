import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WidgetRegions } from "./fixtures/pages.js";
import type { WidgetRegionsController } from "./fixtures/use-widget-regions.js";
import type { AdminWidgetRegionBinding } from "./fixtures/api.js";

/**
 * @file `WidgetRegions` — `/admin/widgets/regions`, driven through the `useWidgetRegionsHook`
 * dependency-injection seam. No dedicated test file existed for this component before this pass.
 */

const FOOTER: AdminWidgetRegionBinding = {
  workspaceId: "w1",
  regionKey: "footer",
  areaEntryId: "area1",
  updatedAt: "2026-08-01T00:00:00.000Z",
  placementCount: 2,
};

function baseController(overrides: Partial<WidgetRegionsController> = {}): WidgetRegionsController {
  return {
    regions: [FOOTER],
    error: null,
    newRegionKey: "",
    setNewRegionKey: vi.fn(),
    binding: false,
    bind: vi.fn(async () => {}),
    t: (key: string) => key,
    ...overrides,
  };
}

describe("loading and error states", () => {
  it("shows a loading placeholder before regions have loaded", () => {
    render(<WidgetRegions useWidgetRegionsHook={() => baseController({ regions: null })} />);
    expect(screen.getByText("Loading regions…")).toBeInTheDocument();
  });

  it("shows the error message when the initial load failed (no regions yet)", () => {
    render(<WidgetRegions useWidgetRegionsHook={() => baseController({ regions: null, error: "failed to load regions" })} />);
    expect(screen.getByText("failed to load regions")).toBeInTheDocument();
  });

  it("shows a non-fatal error banner alongside the table once regions have already loaded", () => {
    render(<WidgetRegions useWidgetRegionsHook={() => baseController({ error: "bind failed" })} />);
    expect(screen.getByText("bind failed")).toBeInTheDocument();
    expect(screen.getByText("footer")).toBeInTheDocument();
  });
});

describe("regions table", () => {
  it("shows the empty state when no regions are bound", () => {
    render(<WidgetRegions useWidgetRegionsHook={() => baseController({ regions: [] })} />);
    expect(screen.getByText("No regions bound yet.")).toBeInTheDocument();
  });

  it("lists each bound region's key and placement count, linking to its editor", () => {
    render(<WidgetRegions useWidgetRegionsHook={() => baseController()} />);
    const link = screen.getByRole("link", { name: "footer" });
    expect(link).toHaveAttribute("href", "/admin/widgets/regions/footer");
    expect(screen.getByText("2")).toBeInTheDocument();
    // "Manage" navigates via `href` — it is a link, not a button (fixed 2026-09-06: this used to
    // be an invalid `<button>` nested inside an `<a>`; the button-shaped class now lives on the
    // `<a>` itself instead).
    expect(screen.getByRole("link", { name: "Manage" })).toBeInTheDocument();
  });
});

describe("bind-new-region control", () => {
  it("typing routes through setNewRegionKey", async () => {
    const user = userEvent.setup();
    const setNewRegionKey = vi.fn();
    render(<WidgetRegions useWidgetRegionsHook={() => baseController({ setNewRegionKey })} />);
    await user.type(screen.getByPlaceholderText("e.g. footer"), "x");
    expect(setNewRegionKey).toHaveBeenCalledWith("x");
  });

  it("Bind region is disabled when the input is blank or only whitespace", () => {
    const { rerender } = render(<WidgetRegions useWidgetRegionsHook={() => baseController({ newRegionKey: "" })} />);
    expect(screen.getByRole("button", { name: "Bind region" })).toBeDisabled();

    rerender(<WidgetRegions useWidgetRegionsHook={() => baseController({ newRegionKey: "   " })} />);
    expect(screen.getByRole("button", { name: "Bind region" })).toBeDisabled();
  });

  it("Bind region is enabled with a real key, and clicking it calls bind", async () => {
    const user = userEvent.setup();
    const controller = baseController({ newRegionKey: "sidebar" });
    render(<WidgetRegions useWidgetRegionsHook={() => controller} />);
    const button = screen.getByRole("button", { name: "Bind region" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(controller.bind).toHaveBeenCalled();
  });

  it("shows Binding… and disables the button while a bind is in flight", () => {
    render(<WidgetRegions useWidgetRegionsHook={() => baseController({ newRegionKey: "sidebar", binding: true })} />);
    expect(screen.getByRole("button", { name: "Binding…" })).toBeDisabled();
  });
});
