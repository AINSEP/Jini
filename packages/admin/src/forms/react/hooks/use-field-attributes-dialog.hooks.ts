import { useController } from "../../../core/react/use-controller.js";
import { createFieldAttributesDialogController, type FieldAttributesDialogState } from "../../controllers/field-attributes-dialog.controller.js";
import type { AdminFormField } from "../../models.js";
import { type AttrRow } from "../../rules.js";

/**
 * @file `FieldAttributesDialog`'s own state and submit action (per-field CSS classes + HTML
 * attributes), so the dialog in `FormEditor.tsx` is only markup.
 *
 * Moved from the host — same state, same validation, same error strings. Draft-row editing and the
 * validate/shape step now live in `rules.ts` (`updateAttrRow`/`removeAttrRow`/`addAttrRow`,
 * `buildFieldAttributesPatch`).
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it. The former Escape helper was likewise feature-local
 * because only this dialog needed it; Jini now owns that shared modal behavior, so the helper
 * and its document subscription are superseded rather than promoted to another local owner.
 */

export interface FieldAttributesDialogController {
  className: string;
  setClassName: (value: string) => void;
  rows: AttrRow[];
  updateRow: (rowId: number, patch: Partial<AttrRow>) => void;
  removeRow: (rowId: number) => void;
  addRow: () => void;
  error: string | null;
  submit: (e: React.FormEvent) => void;
}

export function useFieldAttributesDialog(props: {
  field: AdminFormField;
  onSave: (patch: Partial<AdminFormField>) => void;
  onCancel: () => void;
}, _optional: Record<string, never> = {}): FieldAttributesDialogController {
  const { controller: stateController, snapshot: stateSnapshot } = useController({ create: () => createFieldAttributesDialogController({ field: props.field }), dependencies: [] });
  const state = stateSnapshot ?? { className: props.field.className ?? "", rows: [], error: null };
  const className = state.className;
  const setClassName = (value: FieldAttributesDialogStateValue<"className">) => stateController?.update({ key: "className", value });
  const rows = state.rows;
  const error = state.error;

  function updateRow(rowId: number, patch: Partial<AttrRow>) { stateController?.updateRow({ rowId, patch }); }
  function removeRow(rowId: number) { stateController?.removeRow({ rowId }); }
  function addRow() { stateController?.addRow({}); }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = stateController?.submit({});
    if (result?.ok) props.onSave(result.patch);
  }

  return { className, setClassName, rows, updateRow, removeRow, addRow, error, submit };
}

type FieldAttributesDialogStateValue<K extends keyof FieldAttributesDialogState> = FieldAttributesDialogState[K] | ((current: FieldAttributesDialogState[K]) => FieldAttributesDialogState[K]);
