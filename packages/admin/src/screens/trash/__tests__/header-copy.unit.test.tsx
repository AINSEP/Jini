// @vitest-environment jsdom
import { render, screen } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it } from "vitest";
import { Trash } from "../Trash.js";
import type { TrashController } from "../hooks/use-trash.hooks.js";

/** A controller over an empty trash: only the fields the header, toolbar and (empty) list read. */
function emptyController(overrides: Partial<TrashController> = {}): TrashController {
  return {
    retentionDays: null,
    t: ({ key }: { key: string }) => key,
    locale: "en",
    selected: new Set<string>(),
    items: [],
    error: null,
    notice: null,
    ...overrides,
  } as unknown as TrashController;
}

describe("Trash header copy", () => {
  it("says each item shows its remaining days, not the retired fixed 30-day claim", () => {
    render(<Trash useTrashHook={emptyController as never} translateAdminNavLabel={(({ key }: { key: string }) => key) as never} />);
    expect(screen.getByText("Each item shows how many days it has left.")).toBeInTheDocument();
    expect(screen.queryByText("Deleted items are kept for 30 days.")).toBeNull();
  });

  it("states the retention window the server reports, interpolated rather than hard-coded", () => {
    // 14 is deliberately not the host's 30: a hard-coded window would still print 30 here.
    const { container } = render(<Trash useTrashHook={() => emptyController({ retentionDays: 14 })} translateAdminNavLabel={(({ key }: { key: string }) => key) as never} />);
    const description = container.querySelector(".jini-page-header .jini-page-description");
    expect(description).toHaveTextContent("Items are permanently deleted 14 days after they are moved to Trash. Each item shows how many days it has left.");
  });

  it("states no window until the first page has reported one", () => {
    const { container } = render(<Trash useTrashHook={() => emptyController({ retentionDays: null })} translateAdminNavLabel={(({ key }: { key: string }) => key) as never} />);
    const description = container.querySelector(".jini-page-header .jini-page-description");
    expect(description?.textContent).toBe("Each item shows how many days it has left.");
  });

  it("the title info tip describes what Trash is for, not only the kinds it skips", () => {
    render(<Trash useTrashHook={() => emptyController()} translateAdminNavLabel={(({ key }: { key: string }) => key) as never} />);
    expect(screen.getByLabelText(/^Deleted items wait here so you can restore them/)).toHaveAttribute("data-agent-element", "trash-coverage-info");
  });
});
