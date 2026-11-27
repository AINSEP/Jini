import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
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

const useEditableRows: HtmlAttributeRowsProps["useRows"] = ({ value, onChange, htmlAttributesToRows: parse, rowsToHtmlAttributes: serialize, isDroppedAttributeRow: dropped }) => {
  const [rows, setRows] = useState(() => parse({ text: value }));
  const save = (next: HtmlAttributeRow[]) => {
    setRows(next);
    onChange(serialize({ rows: next }));
  };
  return {
    rows, dropped: rows.map(dropped),
    addRow: () => save([...rows, { name: "", value: "" }]),
    removeRow: ({ index }) => save(rows.filter((_, i) => i !== index)),
    setRow: ({ index, patch }) => save(rows.map((row, i) => i === index ? { ...row, ...patch } : row)),
  };
};

function EditableAttributes() {
  const [value, onChange] = useState("data-kui=card");
  return <>
    <HtmlAttributeRows value={value} onChange={onChange} t={(key) => `FR ${key}`} agentHandle="widget-style" useRows={useEditableRows}
      htmlAttributesToRows={htmlAttributesToRows} rowsToHtmlAttributes={rowsToHtmlAttributes} isDroppedAttributeRow={isDroppedAttributeRow} {...kit} />
    <output aria-label="Stored attributes">{value}</output>
  </>;
}

test("adds an agent-addressable blank row and removes it using a localized positional label", () => {
  render(<EditableAttributes />);
  const add = screen.getByRole("button", { name: "FR Add attribute" });
  expect(add).toHaveAttribute("data-agent-element", "widget-style-attribute-add");
  fireEvent.click(add);
  expect(screen.getByRole("textbox", { name: "FR Attribute name 2" })).toHaveValue("");
  const remove = screen.getByRole("button", { name: "FR Remove 2" });
  fireEvent.click(remove);
  expect(screen.queryByRole("textbox", { name: "FR Attribute name 2" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Stored attributes")).toHaveTextContent("data-kui=card");
});

test("keeps edited attribute value whitespace while updating only the named row", () => {
  render(<EditableAttributes />);
  fireEvent.click(screen.getByRole("button", { name: "FR Add attribute" }));
  fireEvent.change(screen.getByRole("textbox", { name: "FR Attribute name 2" }), { target: { value: " data-note " } });
  fireEvent.change(screen.getByRole("textbox", { name: "FR Attribute value 2" }), { target: { value: " padded " } });
  expect(screen.getByRole("textbox", { name: "FR Attribute value 2" })).toHaveValue(" padded ");
  expect(screen.getByLabelText("Stored attributes").textContent).toBe("data-kui=card data-note= padded ");
});
