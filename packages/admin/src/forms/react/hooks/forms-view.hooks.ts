import { buildAgentListHandles } from '@jini-ai/agentic';
import type { ChangeEvent, MutableRefObject } from 'react';
import { fieldDisplayName, formRowMenuItems, FORM_TABS, type FormDateLine } from '../../rules.js';
import { fieldSettingsFor, fieldTypeGroups, labelChangePatch, retypeField, UPLOAD_CHOICES } from '../../field-settings.js';
import type { FormFieldsEditorController } from './use-form-fields-editor.hooks.js';
import type { FieldAttributesDialogController } from './use-field-attributes-dialog.hooks.js';
import type { FieldSettingsForm } from '../../field-settings.js';
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
      // Registry-driven: the type picker's groups and whether this type has a text length.
      typeGroups: fieldTypeGroups({ current: field.type }), hasLength: fieldSettingsFor({ type: field.type }).length,
      onId: (e: ChangeEvent<HTMLInputElement>) => controller.updateField(index, { id: e.target.value }),
      onLabel: (e: ChangeEvent<HTMLInputElement>) => controller.updateField(index, labelChangePatch({ field, label: e.target.value, isExisting: existingFieldIds.includes(field.id) })),
      onType: (e: ChangeEvent<HTMLSelectElement>) => controller.replaceField(index, retypeField({ field, type: e.target.value })),
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
    hasStyling: Boolean(field.className) || Object.keys(field.attributes ?? {}).length > 0,
    onClassName: (e: ChangeEvent<HTMLInputElement>) => controller.setClassName(e.target.value),
    rows: controller.rows.map((row, index) => ({ ...row, handle: handles[index]!,
      onName: (e: ChangeEvent<HTMLInputElement>) => controller.updateRow(row._rowId, { name: e.target.value }),
      onValue: (e: ChangeEvent<HTMLInputElement>) => controller.updateRow(row._rowId, { value: e.target.value }),
      onRemove: () => controller.removeRow(row._rowId),
    })),
  };
}
/** Bind the settings section's controls; which ones render comes from the field's registry kind. */
export function useFieldSettingsView({ field, controller, t }: { field: AdminFormField; controller: FieldAttributesDialogController; t: (key: string) => string }, _optional = {}) {
  const settings = fieldSettingsFor({ type: field.type });
  const form = controller.settings;
  const value = (key: 'placeholder' | 'helpText' | 'defaultText' | 'minLength' | 'maxLength' | 'pattern' | 'min' | 'max' | 'step' | 'maxFileSizeMb') =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => controller.setSettings({ [key]: e.target.value } as Partial<FieldSettingsForm>);
  const optionHandles = buildAgentListHandles({ prefix: 'form-field-option', ids: form.options.map(row => String(row._rowId)) });
  const numbered = (key: string, n: number) => t(key).replace('{n}', String(n));
  const kind = settings.defaultKind;
  const boundsType = settings.bounds ?? 'number';
  return {
    settings, form, boundsType,
    boundsClass: settings.bounds === 'number' ? 'field-settings-num' : 'field-settings-compact',
    /** `<input type>` for a typed default, or `null` when the default is a box or a choice. */
    defaultInputType: kind === 'temporal' ? boundsType : kind === 'number' ? 'number' : kind === 'text' || kind === 'textarea' ? 'text' : null,
    defaultClass: kind === 'number' || kind === 'temporal' ? 'field-settings-compact' : undefined,
    onPlaceholder: value('placeholder'), onHelpText: value('helpText'), onDefaultText: value('defaultText'),
    onMinLength: value('minLength'), onMaxLength: value('maxLength'), onPattern: value('pattern'),
    onMin: value('min'), onMax: value('max'), onStep: value('step'), onMaxFileSize: value('maxFileSizeMb'),
    onDefaultChecked: (e: ChangeEvent<HTMLInputElement>) => controller.setSettings({ defaultChecked: e.target.checked }),
    onDefaultChoice: (e: ChangeEvent<HTMLSelectElement>) => controller.toggleDefaultChoice(e.target.value, true, true),
    addOption: () => controller.addOption(),
    defaultChoices: form.options.filter(row => row.value).map(row => ({ key: row._rowId, value: row.value, label: row.label || row.value })),
    options: form.options.map((row, index) => ({ ...row, handle: optionHandles[index]!,
      isFirst: index === 0, isLast: index === form.options.length - 1,
      // Multi-choice defaults are ticked per option; a single default uses one select instead.
      isDefault: form.defaultChoices.includes(row.value),
      labelAria: numbered('Option {n} label', index + 1), valueAria: numbered('Option {n} value', index + 1),
      defaultAria: numbered('Option {n} selected by default', index + 1),
      upAria: numbered('Move option {n} up', index + 1), downAria: numbered('Move option {n} down', index + 1),
      removeAria: numbered('Remove option {n}', index + 1),
      onLabel: (e: ChangeEvent<HTMLInputElement>) => controller.updateOption(row._rowId, { label: e.target.value }),
      onValue: (e: ChangeEvent<HTMLInputElement>) => controller.updateOption(row._rowId, { value: e.target.value }),
      onDefault: (e: ChangeEvent<HTMLInputElement>) => controller.toggleDefaultChoice(row.value, e.target.checked, false),
      onUp: () => controller.moveOption(row._rowId, -1), onDown: () => controller.moveOption(row._rowId, 1),
      onRemove: () => controller.removeOption(row._rowId),
    })),
    uploads: UPLOAD_CHOICES.map(choice => ({ ...choice, checked: form.accept.includes(choice.value),
      handle: `form-field-settings-accept-${choice.label.toLowerCase()}`,
      onToggle: (e: ChangeEvent<HTMLInputElement>) => controller.toggleAccept(choice.value, e.target.checked) })),
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
