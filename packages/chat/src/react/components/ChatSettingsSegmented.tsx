/** One choice drawn as a segmented pill (the admin's segmented-control look), built on real radios
 * for keyboard and AT. The Chat settings dialog and a host's quick settings menu share it (owner,
 * 2026-10-21: the gear's Tool calls and Agent plugins match the dialog's control), so both look alike.
 * Inside a `role="menu"` host, `inputRole="menuitemradio"` keeps each option a valid menu child, and
 * `checkedRef` gets the checked option (else the first) so the host's roving focus can land on it. */
export function ChatSettingsSegmented(required: {
  name: string;
  items: readonly { key: string; label: string; checked?: boolean | undefined; disabled?: boolean | undefined; change: () => void }[];
  inputRole?: 'menuitemradio' | undefined;
  checkedRef?: ((input: HTMLInputElement | null) => void) | undefined;
}, _optional: Record<string, never> = {}) {
  const focusKey = (required.items.find(item => item.checked) ?? required.items[0])?.key;
  return <div className="jini-chat-settings-segmented">
    {required.items.map(item => <label key={item.key} className="jini-chat-settings-segment">
      <input type="radio" name={required.name} checked={!!item.checked} disabled={item.disabled} onChange={item.change}
        role={required.inputRole} aria-checked={required.inputRole ? !!item.checked : undefined}
        ref={item.key === focusKey ? required.checkedRef : undefined} />
      <span>{item.label}</span>
    </label>)}
  </div>;
}
