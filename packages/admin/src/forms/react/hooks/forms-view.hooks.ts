import { buildAgentListHandles } from '@jini-ai/agentic';
import type { ChangeEvent, MutableRefObject } from 'react';
import { fieldDisplayName, formRowMenuItems, FORM_TABS, type FormDateLine } from '../../rules.js';
import type { FormFieldsEditorController } from './use-form-fields-editor.hooks.js';
import type { FieldAttributesDialogController } from './use-field-attributes-dialog.hooks.js';
import type { FormSubmissionsController } from './use-form-submissions.hooks.js';
import type { FormEditorFieldsBodyProps } from '../components/FormEditorFieldsBody.js';
import type { AdminFormDefinition, AdminFormField } from '../../models.js';
import { useFormsOptions, FormsPortsContext } from './FormsPorts.hooks.js';
import { useContext } from 'react';
/** Publication actions keep their original DOM at the host slot. */
export function useFormsListView({ forms, t, formatFormDates, toggleStatus, setPendingDelete }: {
  forms: AdminFormDefinition[] | null; t: (key: string) => string;
  formatFormDates: (form: AdminFormDefinition) => FormDateLine[];
  toggleStatus: (form: AdminFormDefinition) => Promise<void>;
  setPendingDelete: (form: AdminFormDefinition | null) => void;
}, _optional = {}) {
  const ports = useContext(FormsPortsContext);
  const { headerActions, adminBase } = useFormsOptions();
  const rowHandles = buildAgentListHandles({ prefix: 'forms-row', ids: (forms ?? []).map(form => form.id) });
  const onEdit = (form: AdminFormDefinition) => {
    if (!ports?.formsNavigation) throw new Error('Missing forms navigation port');
    ports.formsNavigation.navigate({ base: adminBase, routePath: `/forms/${form.slug}` });
  };
  return {
    rows: (forms ?? []).map((form, index) => ({ ...form, rowHandle: rowHandles[index]!, dates: formatFormDates(form),
      menuLabel: t('Actions for form "{name}"').replace('{name}', form.name),
      menuItems: formRowMenuItems({ form, handlers: { onEdit, onToggleStatus: form => { void toggleStatus(form); }, onDelete: setPendingDelete }, t }),
    })),
    cancelDelete: () => setPendingDelete(null), headerActions,
  };
}
/** Bind every field-row callback and focus ref outside the markup. */
export function useFormFieldsView({ fields, existingFieldIds, controller }: {
  fields: AdminFormField[]; existingFieldIds: string[]; controller: FormFieldsEditorController;
}, _optional = {}) {
  const handles = buildAgentListHandles({ prefix: 'form-field', ids: fields.map(field => field.id) });
  const index = controller.editingAttrsIndex;
  return {
    editingField: index === null ? null : fields[index] ?? null,
    saveAttributes: (patch: Partial<AdminFormField>) => {
      if (index === null) return;
      controller.updateField(index, patch);
      controller.closeAttrsDialog();
    },
    rows: fields.map((field, index) => ({ field, index, base: handles[index]!, isExisting: existingFieldIds.includes(field.id), displayName: fieldDisplayName({ field, index }),
      onId: (e: ChangeEvent<HTMLInputElement>) => controller.updateField(index, { id: e.target.value }),
      onLabel: (e: ChangeEvent<HTMLInputElement>) => controller.updateField(index, { label: e.target.value }),
      onType: (e: ChangeEvent<HTMLSelectElement>) => controller.updateField(index, { type: e.target.value }),
      onRequired: (e: ChangeEvent<HTMLInputElement>) => controller.updateField(index, { required: e.target.checked }),
      onMaxLength: (e: ChangeEvent<HTMLInputElement>) => controller.updateField(index, { maxLength: e.target.value ? Number(e.target.value) : null }),
      ref: (el: HTMLButtonElement | null) => { controller.kebabRefs.current[index] = el; },
      onAttributes: () => controller.openAttrsDialog(index), onRemove: () => controller.removeField(index),
    })),
  };
}
export function useFieldAttributesView({ field, fieldIndex, controller, onCancel }: {
  field: AdminFormField; fieldIndex: number; controller: FieldAttributesDialogController; onCancel: () => void;
}, _optional = {}) {
  const handles = buildAgentListHandles({ prefix: 'form-field-attrs-row', ids: controller.rows.map(row => String(row._rowId)) });
  return {
    displayName: fieldDisplayName({ field, index: fieldIndex }), onClose: () => onCancel(),
    onClassName: (e: ChangeEvent<HTMLInputElement>) => controller.setClassName(e.target.value),
    rows: controller.rows.map((row, index) => ({ ...row, handle: handles[index]!,
      onName: (e: ChangeEvent<HTMLInputElement>) => controller.updateRow(row._rowId, { name: e.target.value }),
      onValue: (e: ChangeEvent<HTMLInputElement>) => controller.updateRow(row._rowId, { value: e.target.value }),
      onRemove: () => controller.removeRow(row._rowId),
    })),
  };
}
export function useSubmissionsView({ controller }: { controller: FormSubmissionsController }, _optional = {}) {
  const handles = buildAgentListHandles({ prefix: 'form-submission-view', ids: (controller.submissions ?? []).map(submission => submission.id) });
  return {
    // Successful removal invalidates its own query; this callback only exits the detail view.
    back: () => controller.setSelectedId(null),
    loadMore: () => { if (controller.nextCursor) controller.load(controller.nextCursor); },
    rows: (controller.submissions ?? []).map((submission, index) => ({ ...submission, handle: handles[index]!, view: () => controller.setSelectedId(submission.id) })),
  };
}
export function useFormFieldsBodyView(props: FormEditorFieldsBodyProps, _optional = {}) {
  return {
    onName: (e: ChangeEvent<HTMLInputElement>) => props.onNameChange(e.target.value),
    onSlug: (e: ChangeEvent<HTMLInputElement>) => props.onSlugChange(e.target.value),
    onHtml: (e: ChangeEvent<HTMLTextAreaElement>) => props.onHtmlChange(e.target.value),
    onBuilder: () => props.onModeChange('builder'), onHtmlMode: () => props.onModeChange('html'),
  };
}
export function useFormTabStripView({ onTabChange, tabRefs }: {
  onTabChange: (tab: 'fields' | 'submissions') => void;
  tabRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
}, _optional = {}) {
  return FORM_TABS.map((tab, index) => ({ ...tab,
    ref: (el: HTMLButtonElement | null) => { tabRefs.current[index] = el; },
    onClick: () => onTabChange(tab.id),
  }));
}
