import { useController } from "../../../core/react/use-controller.js";
import { createFormFieldsEditorController, initialFormFieldsEditorState, type FormFieldsEditorState } from "../../controllers/form-fields-editor.controller.js";
import { useRef } from "react";
import type { AdminFormField } from "../../models.js";
import { addFormField, removeFormField, updateFormField } from "../../rules.js";

/**
 * @file `FormFieldsEditor`'s own state (which row's attributes modal is open, plus the per-row
 * kebab-trigger refs for WCAG focus-return), so the fields table in `FormEditor.tsx` is only
 * markup.
 *
 * Extracted verbatim, including the `useRef` array — `Pattern 1` moves every `useRef` out of the
 * component along with state/effects, not just `useState`. The field-list edits themselves
 * (`updateField`/`addField`/`removeField`) are thin wrappers around `rules.ts`'s pure array
 * transforms, applied through the parent-owned `onChange` (this component does not own `fields`
 * itself — `FormEditor`'s own `fields` state does).
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 */

export interface FormFieldsEditorController {
  /** Which field's `FieldAttributesDialog` is open, by index — `null` when none is. */
  editingAttrsIndex: number | null;
  openAttrsDialog: (index: number) => void;
  /** Closes the attributes dialog and returns focus to the kebab trigger that opened it (WCAG 2.1
   *  AA "focus returns to trigger element when modal closes"). */
  closeAttrsDialog: () => void;
  /** Per-row kebab-trigger refs, indexed the same as `fields` — attach via each row's own `ref`
   *  callback in the view. */
  kebabRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  updateField: (index: number, patch: Partial<AdminFormField>) => void;
  addField: () => void;
  removeField: (index: number) => void;
}

export function useFormFieldsEditor(props: {
  fields: AdminFormField[];
  onChange: (fields: AdminFormField[]) => void;
}, _optional: Record<string, never> = {}): FormFieldsEditorController {
  const { controller: stateController, snapshot: stateSnapshot } = useController({ create: () => createFormFieldsEditorController({}), dependencies: [] });
  const state = stateSnapshot ?? initialFormFieldsEditorState({});
  const editingAttrsIndex = state.editingAttrsIndex;
  const setEditingAttrsIndex = (value: FormFieldsEditorStateValue<"editingAttrsIndex">) => stateController?.update({ key: "editingAttrsIndex", value });
  const kebabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function closeAttrsDialog() {
    const index = editingAttrsIndex;
    setEditingAttrsIndex(null);
    if (index !== null) kebabRefs.current[index]?.focus();
  }

  function updateField(index: number, patch: Partial<AdminFormField>) {
    props.onChange(updateFormField({ fields: props.fields, index, patch }));
  }
  function addField() {
    props.onChange(addFormField({ fields: props.fields }));
  }
  function removeField(index: number) {
    props.onChange(removeFormField({ fields: props.fields, index }));
  }

  return {
    editingAttrsIndex,
    openAttrsDialog: setEditingAttrsIndex,
    closeAttrsDialog,
    kebabRefs,
    updateField,
    addField,
    removeField,
  };
}

type FormFieldsEditorStateValue<K extends keyof FormFieldsEditorState> = FormFieldsEditorState[K] | ((current: FormFieldsEditorState[K]) => FormFieldsEditorState[K]);
