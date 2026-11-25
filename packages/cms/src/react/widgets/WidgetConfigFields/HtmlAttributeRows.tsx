import type { ComponentType, ReactNode } from "react";
import type { AgentHandleOptions, AgentHandleProps } from "@jini-ai/core/agent-handles";

/**
 * @file `HtmlAttributeRows` — key = value rows that edit one `htmlAttributes` string, with a
 * "Dropped when rendered" flag per unsafe row. ONE component for the widget editor's Media tab
 * and the `widgetEmbed` node's Style dialog (owner, 2026-10-11: the dialog had a single text box
 * while the editor had rows). Markup only; state is in the injected `useRows` hook. The host
 * renders the "HTML attributes" label and owns the stylesheet. Given `agentHandle`, the add button
 * is `<base>-attribute-add`.
 */

/** One editable attribute row; matched structurally with the host's row type. */
export interface HtmlAttributeRow {
  name: string;
  value: string;
}

/** The state hook's view model (the host binds `useHtmlAttributeRows`). */
export interface HtmlAttributeRowsController {
  rows: HtmlAttributeRow[];
  /** Per row: the renderer's allowlist will drop it. */
  dropped: boolean[];
  setRow: (required: { index: number; patch: Partial<HtmlAttributeRow> }, optional?: Record<string, never>) => void;
  addRow: () => void;
  removeRow: (required: { index: number }, optional?: Record<string, never>) => void;
}

export interface HtmlAttributeRowsProps {
  value: string;
  onChange: (value: string) => void;
  /** Shared-components dictionary translator; omit for the English source strings. */
  t?: (key: string) => string;
  agentHandle?: string;
  /** The state hook. */
  useRows: (required: {
    value: string;
    onChange: (value: string) => void;
    htmlAttributesToRows: (input: { text: string | undefined }) => HtmlAttributeRow[];
    rowsToHtmlAttributes: (input: { rows: readonly HtmlAttributeRow[] }) => string;
    isDroppedAttributeRow: (row: HtmlAttributeRow) => boolean;
  }) => HtmlAttributeRowsController;
  /** The host's parser, serializer and policy-bound dropped-row rule (sanitization stays host policy). */
  htmlAttributesToRows: (input: { text: string | undefined }) => HtmlAttributeRow[];
  rowsToHtmlAttributes: (input: { rows: readonly HtmlAttributeRow[] }) => string;
  isDroppedAttributeRow: (row: HtmlAttributeRow) => boolean;
  /** Kit pieces: the icon, the hover tip around the remove button, and the agent-handle attributes. */
  Icon: ComponentType<{ name: "close" | "plus"; size: 14; "aria-hidden": "true" }>;
  Tip: ComponentType<{ label: string; children: ReactNode }>;
  agentHandleAttributes: (required: { handle: string }, optional?: AgentHandleOptions) => AgentHandleProps;
}

export function HtmlAttributeRows({
  value, onChange, t = (key) => key, agentHandle: base, useRows,
  htmlAttributesToRows, rowsToHtmlAttributes, isDroppedAttributeRow, Icon, Tip, agentHandleAttributes,
}: HtmlAttributeRowsProps) {
  const vm = useRows({ value, onChange, htmlAttributesToRows, isDroppedAttributeRow, rowsToHtmlAttributes });
  return (
    <div className="html-attribute-rows">
      {vm.rows.map((row, index) => (
        // Index keys: rows have no id and their names are being typed.
        <div key={index} className="html-attribute-rows__row">
          <input className="field-mono html-attribute-rows__name" value={row.name} placeholder="data-kui" spellCheck={false}
            aria-label={`${t("Attribute name")} ${index + 1}`} aria-invalid={vm.dropped[index] ? true : undefined}
            onChange={(event) => vm.setRow({ index, patch: { name: event.target.value.trim() } })} />
          <span aria-hidden="true">=</span>
          <input className="field-mono html-attribute-rows__value" value={row.value} spellCheck={false}
            aria-label={`${t("Attribute value")} ${index + 1}`} onChange={(event) => vm.setRow({ index, patch: { value: event.target.value } })} />
          <Tip label={t("Remove")}>
            <button type="button" className="btn-ghost media-content-editor__icon"
              aria-label={`${t("Remove")} ${row.name || index + 1}`} onClick={() => vm.removeRow({ index })}>
              <Icon name="close" size={14} aria-hidden="true" />
            </button>
          </Tip>
          {vm.dropped[index] ? <span className="field-error">{t("Dropped when rendered")}</span> : null}
        </div>
      ))}
      <button type="button" className="btn-ghost media-content-editor__compact" onClick={vm.addRow}
        {...(base ? agentHandleAttributes({ handle: `${base}-attribute-add` }, { role: "button", label: "Add an HTML attribute row" }) : {})}>
        <Icon name="plus" size={14} aria-hidden="true" />
        {t("Add attribute")}
      </button>
    </div>
  );
}
