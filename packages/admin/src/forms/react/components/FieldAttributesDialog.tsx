import { useFieldAttributesView } from "../hooks/forms-view.hooks.js";
import type { AdminFormField } from '../../models.js';
import { Dialog } from '../../../react/kit.js';
import { agentHandle } from '@jini-ai/core/agent-handles';
import { useFieldAttributesDialog } from '../hooks/use-field-attributes-dialog.hooks.js';
import { FieldSettingsSection } from './FieldSettingsSection.js';
import { FieldAttributesActions, FieldAttributesStyling } from './FieldAttributesStyling.js';

export interface FieldAttributesDialogProps {
  field: AdminFormField;
  fieldIndex: number;
  onSave: (patch: Partial<AdminFormField>) => void;
  onCancel: () => void;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useFieldAttributesDialogHook?: typeof useFieldAttributesDialog;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
  /** Same seam for the view-model hook. */
  useFieldAttributesViewHook?: typeof useFieldAttributesView;
}

export function FieldAttributesDialog({
  field,
  fieldIndex,
  onSave,
  onCancel,
  useFieldAttributesDialogHook = useFieldAttributesDialog,
  useFieldAttributesViewHook = useFieldAttributesView,
  t,
}: FieldAttributesDialogProps) {
  const controller = useFieldAttributesDialogHook({
    field,
    onSave,
    onCancel,
  });
  // One dialog is ever open at a time (`editingAttrsIndex` gates a single instance below), so this
  // needs no per-instance disambiguation — unlike the attribute rows inside it, which are a real
  // repeated list and do need `buildAgentListHandles`'s uniqueness search. Not `useMemo`d: `rows` is
  // one field's own CSS-class/HTML-attribute rows (a handful at most), cheap enough that memoizing
  // it was not judged worth the added indirection.
  const { className, addRow, error, submit } = controller;
  const { rows, displayName, onClose, onClassName, hasStyling } = useFieldAttributesViewHook({ field, fieldIndex, controller, onCancel });

  return (
    <Dialog open title={`${t("Field settings —")} ${displayName}`}
      onClose={onClose} className="settings-dialog jini-domain-dialog field-attrs-dialog">
      <form
        onSubmit={submit}
        {...agentHandle({ handle: "form-field-attrs-dialog" }, {
          role: "region",
          label: "Field settings dialog — type-specific settings, CSS classes and HTML attributes for one form field",
        })}
      >
        <FieldSettingsSection field={field} controller={controller} t={t} />

        {/* Styling hooks are rarely needed, so they fold away below the field's own settings; a
            field that already has classes or attributes opens with them showing. */}
        <FieldAttributesStyling hasStyling={hasStyling} className={className} onClassName={onClassName} rows={rows} addRow={addRow} t={t} />

        <FieldAttributesActions error={error} onCancel={onCancel} t={t} />
      </form>
    </Dialog>
  );
}
