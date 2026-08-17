import { useT } from '../../../../i18n/index.js';
import { TabbedDialog } from '../../../../tabbed-dialog/react/components/TabbedDialog.js';
import type { TabbedDialogProps, TabbedDialogTab } from '../../../../tabbed-dialog/react/components/TabbedDialog.js';
import type { TabbedDialogChromeLabels } from '../../../../tabbed-dialog/types.js';

/**
 * Alias of the generic `TabbedDialogTab` (`../../../../tabbed-dialog/react/components/TabbedDialog.js`)
 * — a settings tab is structurally identical to any other tabbed-dialog tab (same
 * `id`/`label`/`icon`/`panel` shape). This name exists for call-site continuity; see
 * `TabbedDialogTab`'s own doc comment for the field-by-field docs.
 */
export type SettingsDialogTab<TId extends string = string> = TabbedDialogTab<TId>;

/**
 * Alias of `TabbedDialogProps` — see that interface for the field-by-field docs. Kept as its
 * own name (rather than inlining `TabbedDialogProps` at every Tovu call site) purely for
 * call-site continuity; `SettingsDialogShell` adds no fields of its own.
 */
export type SettingsDialogShellProps<T extends SettingsDialogTab = SettingsDialogTab> = TabbedDialogProps<T>;

/**
 * Settings-flavoured `TabbedDialog` (`../../../../tabbed-dialog/`): the same generic tabbed
 * modal/inline shell, pre-configured with the label defaults a Settings screen wants —
 * `t('Settings')` as the kicker, `t('Settings sections')` as the sidebar's accessible name,
 * `t('Collapse/Expand settings sidebar')` as the collapse-toggle labels, and
 * `settings-dialog-title` as the default `aria-labelledby` id (all of it byte-for-byte the
 * same defaulting behavior this component had before the 2026-08-13 extraction, when this
 * file WAS the shell rather than a wrapper around it).
 *
 * A host-supplied `labels` prop still wins over every one of these — this component only
 * fills in the settings-specific gaps `TabbedDialog` deliberately leaves generic (its own
 * kicker defaults to `''`, its sidebar aria-label to the product-neutral `t('Sections')`,
 * etc., since it carries no opinion about which product is asking).
 *
 * Every other prop passes straight through to `TabbedDialog` unchanged — this component
 * owns no shell state and renders no shell markup of its own.
 */
export function SettingsDialogShell<T extends SettingsDialogTab>(props: SettingsDialogShellProps<T>) {
  const t = useT();
  const labels: TabbedDialogChromeLabels = {
    kicker: t('Settings'),
    collapseSidebarLabel: t('Collapse settings sidebar'),
    expandSidebarLabel: t('Expand settings sidebar'),
    sidebarAriaLabel: t('Settings sections'),
    ...props.labels,
  };

  return (
    <TabbedDialog
      {...props}
      labels={labels}
      dialogAriaLabelledBy={props.dialogAriaLabelledBy ?? 'settings-dialog-title'}
    />
  );
}
