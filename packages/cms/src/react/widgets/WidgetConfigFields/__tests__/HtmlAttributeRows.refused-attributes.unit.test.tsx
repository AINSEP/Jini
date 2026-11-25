import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { HtmlAttributeRows, type HtmlAttributeRow, type HtmlAttributeRowsProps } from "../HtmlAttributeRows.js";

afterEach(cleanup);

/** A row-per-`name=value` parser and an injected policy refusing `on*` handlers, standing in for the host's. */
const htmlAttributesToRows = ({ text }: { text: string | undefined }): HtmlAttributeRow[] =>
  (text ?? "").split(" ").filter(Boolean).map((pair) => { const [name = "", value = ""] = pair.split("="); return { name, value }; });
const rowsToHtmlAttributes = ({ rows }: { rows: readonly HtmlAttributeRow[] }) => rows.filter((row) => row.name).map((row) => `${row.name}=${row.value}`).join(" ");
const isDroppedAttributeRow = (row: HtmlAttributeRow) => row.name.startsWith("on");
/** The hook's contract: rows from the value, `dropped` from the injected rule, edits serialized through `onChange`. */
const useRows: HtmlAttributeRowsProps["useRows"] = ({ value, onChange, htmlAttributesToRows: parse, rowsToHtmlAttributes: serialize, isDroppedAttributeRow: dropped }) => {
  const rows = parse({ text: value });
  return {
    rows, dropped: rows.map(dropped),
    setRow: ({ index, patch }) => onChange(serialize({ rows: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) })),
    addRow: () => {}, removeRow: ({ index }) => onChange(serialize({ rows: rows.filter((_, i) => i !== index) })),
  };
};
const kit = {
  Icon: () => <span />,
  Tip: ({ children }: { label: string; children: ReactNode }) => <>{children}</>,
  agentHandleAttributes: agentHandle,
};

test("a row the injected policy refuses is flagged; an allowed row is not (M-bypass-attribute-rejection)", () => {
  const onChange = vi.fn();
  render(<HtmlAttributeRows value="data-kui=card onclick=steal" onChange={onChange} useRows={useRows}
    htmlAttributesToRows={htmlAttributesToRows} rowsToHtmlAttributes={rowsToHtmlAttributes} isDroppedAttributeRow={isDroppedAttributeRow} {...kit} />);
  expect(screen.getByLabelText("Attribute name 1")).not.toHaveAttribute("aria-invalid");
  expect(screen.getByLabelText("Attribute name 2")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getAllByText("Dropped when rendered")).toHaveLength(1);
  // Names are trimmed on edit; values are kept byte-for-byte; the row index is the editing identity.
  fireEvent.change(screen.getByLabelText("Attribute name 1"), { target: { value: " data-x " } });
  expect(onChange).toHaveBeenLastCalledWith("data-x=card onclick=steal");
  fireEvent.click(screen.getByRole("button", { name: "Remove onclick" }));
  expect(onChange).toHaveBeenLastCalledWith("data-kui=card");
});
