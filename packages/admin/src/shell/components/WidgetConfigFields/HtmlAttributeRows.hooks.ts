import { useState } from "react";

/**
 * @file State for `HtmlAttributeRows.tsx` — key = value rows over ONE stored `htmlAttributes`
 * string (the contract's shape). Shared by the widget editor (`MediaContentEditor`) and the
 * `widgetEmbed` node's Style dialog, so both edit attributes the same way (owner, 2026-10-11).
 */

/** Structural slice of the host's media rules: one `name = value` row of an `htmlAttributes` string. */
export interface HtmlAttributeRow {
  name: string;
  value: string;
}

export interface HtmlAttributeRowsController {
  rows: HtmlAttributeRow[];
  /** Per row: the renderer's allowlist will drop it. */
  dropped: boolean[];
  setRow: (required: { index: number; patch: Partial<HtmlAttributeRow> }, optional?: Record<string, never>) => void;
  addRow: () => void;
  removeRow: (required: { index: number }, optional?: Record<string, never>) => void;
}

/**
 * The rows are local: a half-typed row (no name yet) serializes to nothing and would vanish on the
 * next render if rows were re-derived from the stored string. They are re-read only when the
 * string changes from outside (a reload, a different widget), never because of our own emit.
 *
 * @param required.value - The stored `htmlAttributes` string (`""` for none).
 * @param required.onChange - Receives the re-serialized string after every row edit.
 * @param required.htmlAttributesToRows - The host's parser from the stored string to rows.
 * @param required.rowsToHtmlAttributes - The host's serializer from rows back to the stored string.
 * @param required.isDroppedAttributeRow - The host's check for a row its renderer's allowlist drops.
 * @returns {@link HtmlAttributeRowsController}.
 * @complexity O(r) per render for r rows.
 */
export function useHtmlAttributeRows(required: {
  value: string;
  onChange: (value: string) => void;
  htmlAttributesToRows: (input: { text: string | undefined }) => HtmlAttributeRow[];
  rowsToHtmlAttributes: (input: { rows: readonly HtmlAttributeRow[] }) => string;
  isDroppedAttributeRow: (row: HtmlAttributeRow) => boolean;
}): HtmlAttributeRowsController {
  const { value, onChange, htmlAttributesToRows, rowsToHtmlAttributes, isDroppedAttributeRow } = required;
  const [attributes, setAttributes] = useState(() => ({ source: value, rows: htmlAttributesToRows({ text: value }) }));
  const rows = attributes.source === value ? attributes.rows : htmlAttributesToRows({ text: value });
  if (attributes.source !== value) setAttributes({ source: value, rows });

  function commit({ next }: { next: HtmlAttributeRow[] }, _options: Record<string, never> = {}) {
    const source = rowsToHtmlAttributes({ rows: next });
    setAttributes({ source, rows: next });
    onChange(source);
  }

  return {
    rows,
    dropped: rows.map(isDroppedAttributeRow),
    setRow: ({ index, patch }, _options: Record<string, never> = {}) => commit({ next: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) }),
    // A blank row serializes to nothing, so adding one emits nothing.
    addRow: () => setAttributes({ source: value, rows: [...rows, { name: "", value: "" }] }),
    removeRow: ({ index }, _options: Record<string, never> = {}) => commit({ next: rows.filter((_, i) => i !== index) }),
  };
}
