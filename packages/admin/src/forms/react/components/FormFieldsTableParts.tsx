import { agentHandle } from '@jini-ai/core/agent-handles';
/** Column widths and header row of the field table. */
export function FormFieldsTableHead({ t }: { t: (key: string) => string }, _optional: Record<string, never> = {}) {
  return (
    <>
        {/* Fixed proportional column widths (`forms.css`'s `table-layout: fixed`) rather than the
            browser's default content-driven auto layout — every cell here holds a live, unstyled-
            width `<input>`/`<select>`, so auto layout let six of them each claim their own
            intrinsic ~180px, pushing the table to ~925px wide at a 640px viewport (measured before
            this fix) with no visible cue that "Max length"/Remove were still reachable by scrolling
            `.table-scroll`. Percentages sized to what each column actually holds: ID/Label get the
            most room since they're the fields an operator actually reads, Required/Max length the
            least since a checkbox and a short number never need more.

            A seventh "MORE" column (this pass) holds the vertical-kebab trigger for
            `FieldAttributesDialog` — sized the same 8% as Req, since it holds nothing but one
            30px round icon button and never needs more. Taken entirely out of the Remove column's
            own share (26% -> 18%) rather than shrinking any of the five text/control columns, so
            ID/Label/Type/Req/Max length keep the exact widths the 640px fix already measured and
            fixed.

            Type 17% -> 21%, taken from Max length (18% -> 14%; it holds "—" or a short number):
            with the dock open the type select cut its label ("Toggle switc", Chrome check
            2026-10-11). */}
        <colgroup>
          <col style={{ width: "14%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "21%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>{t("ID")}</th>
            <th>{t("Label")}</th>
            <th>{t("Type")}</th>
            {/* "Required" is one unbreakable word — at this column's necessarily checkbox-sized
                width it has nowhere to wrap to and was visibly overflowing into "Max length"'s own
                header. "Req" reads fine sitting directly above the checkbox it labels; the row
                cell's own `aria-label` ("Field N required", unchanged below) still says the full
                word for anyone not reading the visual header at all. */}
            <th>{t("Req")}</th>
            <th>{t("Max length")}</th>
            {/* "More" — the exact literal string `FormsList.tsx`'s own `RowMenu` column header
                uses (confirmed by reading that file, not just the rendered DOM); `.list-table th`
                (`styles.css`) uppercases it visually to "MORE", same as every other header in this
                table (e.g. "Max length" above renders as "MAX LENGTH"). */}
            <th>{t("More")}</th>
            <th></th>
          </tr>
        </thead>
    </>
  );
}

/** The footer row holding the "Add field" button. */
export function FormFieldsTableFoot({ addField, t }: { addField: () => void; t: (key: string) => string }, _optional: Record<string, never> = {}) {
  return (
    <tfoot>
      <tr>
        <td colSpan={7}>
          <button
            type="button"
            className="btn-secondary"
            onClick={addField}
            {...agentHandle({ handle: "form-fields-add" }, { role: "button", label: "Add a new field to this form" })}
          >
            {t("Add field")}
          </button>
        </td>
      </tr>
    </tfoot>
  );
}
