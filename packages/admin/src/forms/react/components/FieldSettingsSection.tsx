import { agentHandle } from '@jini-ai/agentic';
import type { AdminFormField } from '../../models.js';
import { useFieldSettingsView } from '../hooks/forms-view.hooks.js';
import { FieldSettingsDefaultRows, FieldSettingsLimitRows, FieldSettingsOptionsRow, FieldSettingsTextRows, FieldSettingsUploadRows } from './FieldSettingsRows.js';
import type { FieldAttributesDialogController } from '../hooks/use-field-attributes-dialog.hooks.js';

export interface FieldSettingsSectionProps {
  field: AdminFormField;
  controller: FieldAttributesDialogController;
  t: (key: string) => string;
}

/**
 * The settings half of the field dialog: one label-beside-control row per setting the field's
 * registry kind supports (`field-settings.ts` decides which). Markup only; every handler comes from
 * `useFieldSettingsView`. Explanations are ⓘ tips so the rows stay one line each.
 *
 * Initial focus: the native dialog focuses the first `[data-jini-autofocus]`, so the first of the
 * placeholder, help-text and default inputs this type renders gets it. Without it, types with no
 * placeholder (slider, file…) focused the Help text ⓘ, whose tip opened half behind the dialog
 * (Chrome check, 2026-10-11). Focus must land on an input, never on an ⓘ.
 */
export function FieldSettingsSection({ field, controller, t }: FieldSettingsSectionProps, _optional: Record<string, never> = {}) {
  const view = useFieldSettingsView({ field, controller, t });
  const { settings } = view;
  return (
    <div className="field-settings" {...agentHandle({ handle: 'form-field-settings' }, { role: 'region', label: "This field's type-specific settings" })}>
      <FieldSettingsTextRows view={view} t={t} />

      {settings.options ? <FieldSettingsOptionsRow view={view} t={t} /> : null}

      <FieldSettingsDefaultRows view={view} t={t} />

      <FieldSettingsLimitRows view={view} t={t} />

      {settings.upload ? <FieldSettingsUploadRows view={view} t={t} /> : null}
    </div>
  );
}
