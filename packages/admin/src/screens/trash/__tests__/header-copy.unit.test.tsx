// @vitest-environment jsdom
import { render, screen } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it } from "vitest";
import { Trash } from "../Trash.js";
import type { TrashController } from "../hooks/use-trash.hooks.js";

/** A controller over an empty trash: only the fields the header, toolbar and (empty) list read. */
function emptyController(): TrashController {
  return {
    t: ({ key }: { key: string }) => key,
    locale: "en",
    selected: new Set<string>(),
    items: [],
    error: null,
    notice: null,
  } as unknown as TrashController;
}

describe("Trash header copy", () => {
  it("says each item shows its remaining days, not the retired fixed 30-day claim", () => {
    render(<Trash useTrashHook={emptyController as never} translateAdminNavLabel={(({ key }: { key: string }) => key) as never} />);
    expect(screen.getByText("Each item shows how many days it has left.")).toBeInTheDocument();
    expect(screen.queryByText("Deleted items are kept for 30 days.")).toBeNull();
  });
});
