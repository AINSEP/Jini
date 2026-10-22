import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { TabBar } from '@jini-ai/ui/tab-strip';
import { InfoTip } from '@jini-ai/ui/admin-widgets';
import { useChatSettingsView, type ChatPermissionsPort, type ChatSettingsSection } from './ChatSettingsDialog.hooks.js';
import { ChatSettingsSegmented } from './ChatSettingsSegmented.js';

/** One switch row, with optional inline description and help beside the control and label.
 * The help trigger stays outside the label so tapping it never toggles the switch.
 * Earlier (owner) ⓘ tips floated away from their icon, so this row showed visible text only; on 2026-10-18 the owner approved per-option ⓘ help, which InfoTip now anchors to the icon.
 * Later that day radio groups moved to one ⓘ beside their legend; a switch keeps its own, which now
 * sits right after its label like the legend's (owner, 2026-10-21) instead of at the row's far edge. */
function SettingSwitch(required: {
  label: string; checked: boolean; disabled?: boolean | undefined; onChange: (checked: boolean) => void;
  description?: string | undefined; descriptionId: string; className?: string | undefined;
  tooltip?: string | undefined;
}, _optional: Record<string, never> = {}) {
  const inputId = useId();
  return <div className={['jini-chat-settings-row', required.className].filter(Boolean).join(' ')}>
    <input id={inputId} type="checkbox" role="switch" className="jini-checkbox jini-chat-settings-switch"
      checked={required.checked} disabled={required.disabled}
      aria-describedby={[required.description ? required.descriptionId : '', required.tooltip ? `${required.descriptionId}-tooltip` : ''].filter(Boolean).join(' ') || undefined}
      onChange={event => required.onChange(event.currentTarget.checked)} />
    <div className="jini-chat-settings-text">
      <span className="jini-chat-settings-label-row">
        <label htmlFor={inputId} className="jini-chat-settings-label">{required.label}</label>
        {required.tooltip && <InfoTip label={required.tooltip} descriptionId={`${required.descriptionId}-tooltip`} />}
      </span>
      {required.description && <p id={required.descriptionId} className="jini-chat-settings-description">{required.description}</p>}
    </div>
  </div>;
}

/** Advanced chat settings; the host supplies display actions, capabilities and persistence.
 * Native dialog semantics own modal focus containment; closing restores the opener.
 * Header and tabs stay fixed while only the active panel scrolls.
 */
export function ChatSettingsDialog(required: {
  open: boolean; onClose: () => void; displaySections: readonly ChatSettingsSection[];
  permissions: ChatPermissionsPort; t?: (key: string) => string;
}, _optional: Record<string, never> = {}) {
  const vm = useChatSettingsView(required);
  const dialogRef = useRef<HTMLDialogElement>(null), closeRef = useRef<HTMLButtonElement>(null), titleId = useId();
  const openerRef = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !required.open) return;
    openerRef.current = document.activeElement;
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
    closeRef.current?.focus({ preventScroll: true });
    dialog.scrollTop = 0;
    return () => {
      if (typeof dialog.close === 'function') { if (dialog.open) dialog.close(); }
      else dialog.removeAttribute('open');
    };
  }, [required.open]);
  // Return focus to the opener from a passive cleanup: React's commit-time focus restore runs after
  // layout cleanups and would pull focus straight back to the closing dialog's × button.
  useEffect(() => {
    if (!required.open) return;
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [required.open]);
  // Its own tip bounds: hosts mount this inside a narrow dock marked `data-jini-tip-bounds`, which
  // pushed the ⓘ bubbles of options outside the dock across the dialog, away from their icon.
  return <dialog ref={dialogRef} aria-labelledby={titleId} aria-modal="true" tabIndex={-1} data-jini-tip-bounds=""
    className="jini-dialog jini-chat-settings-dialog"
    onCancel={event => { event.preventDefault(); required.onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const { clientX: x, clientY: y } = event, box = event.currentTarget.getBoundingClientRect();
      if ((x === 0 && y === 0) || x < box.left || x > box.right || y < box.top || y > box.bottom) required.onClose();
    }}>
    <header className="jini-chat-settings-header">
      <h2 id={titleId} className="jini-dialog-title">{vm.t('Chat settings')}</h2>
      <button ref={closeRef} type="button" className="jini-dialog-close jini-chat-settings-close"
        aria-label={vm.t('Close')} onClick={required.onClose}><span aria-hidden="true">×</span></button>
    </header>
    <TabBar tabs={vm.tabs} activeId={vm.tab} onChange={vm.setTab} ariaLabel={vm.t('Chat settings')} />
    <div className="jini-chat-settings-body" role="tabpanel"
      aria-label={vm.tab === 'display' ? vm.t('Display') : vm.t('Agent permissions')}>
      {vm.tab === 'display' ? vm.display.map(section => section.radio
        // One ⓘ for the whole choice, beside the legend (owner, 2026-10-18), not one per option. The
        // fieldset is named by the label span alone, so the tip's text never joins the group's name.
        ? <fieldset key={section.key} className="jini-chat-settings-group" aria-labelledby={section.label ? section.labelId : undefined}
          aria-describedby={[section.hint ? section.hintId : '', section.tooltip ? section.tooltipId : ''].filter(Boolean).join(' ') || undefined}>
          {section.label && <legend className="jini-chat-settings-legend">
            <span id={section.labelId}>{section.label}</span>
            {section.tooltip && <InfoTip label={section.tooltip} descriptionId={section.tooltipId} />}
          </legend>}
          {section.hint && <p id={section.hintId} className="jini-chat-settings-description jini-chat-settings-description--group">{section.hint}</p>}
          <ChatSettingsSegmented name={section.name} items={section.items} />
        </fieldset>
        : <fieldset key={section.key} className="jini-chat-settings-group">
          {section.label && <legend className="jini-chat-settings-legend">{section.label}</legend>}
          {section.items.map(item => <SettingSwitch key={item.key} label={item.label} checked={!!item.checked}
            disabled={item.disabled} onChange={item.change} description={item.hint} descriptionId={item.hintId} tooltip={item.tooltip} />)}
        </fieldset>)
      : <>
        <p className="jini-chat-settings-note">{vm.t('Permission changes apply to the next run.')}</p>
        {vm.permissions.unavailableReason && <p className="jini-chat-settings-note">{vm.t(vm.permissions.unavailableReason)}</p>}
        <SettingSwitch className="jini-chat-settings-row--master" label={vm.master.label} checked={vm.master.checked}
          disabled={vm.master.disabled} onChange={checked => vm.master.onCheckedChange({ checked })}
          description={vm.master.description} descriptionId={vm.master.descriptionId} />
        <div className="jini-chat-settings-capabilities">
          {vm.capabilities.map(item => <SettingSwitch key={item.key} label={item.control.label} checked={item.control.checked}
            disabled={item.control.disabled} onChange={checked => item.control.onCheckedChange({ checked })}
            description={item.description} descriptionId={item.descriptionId} />)}
        </div>
        {vm.permissions.busy && <p role="status" className="jini-chat-settings-note">{vm.t('Saving…')}</p>}
        {vm.permissions.error && <p role="alert" className="jini-chat-settings-error">{vm.permissions.error}</p>}
      </>}
    </div>
  </dialog>;
}
