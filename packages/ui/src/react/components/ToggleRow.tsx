// Full-card toggle row with an inline hint line beneath the label — the
// heavier sibling of `CompactToggle` for standalone toggles that deserve
// more visual weight. Origin: `ToggleRow` in `NewProjectPanel.tsx` (Open
// Design), verbatim structural port — the component carried no
// product-specific typing or copy. See archived UI source map.

export interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  className?: string;
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  className,
}: ToggleRowProps) {
  return (
    <button
      type="button"
      className={[
        'toggle-row',
        checked ? 'on' : '',
        disabled ? 'disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      aria-pressed={checked}
      disabled={disabled}
    >
      <div className="jini-toggle-row-text">
        <span className="jini-toggle-row-label">{label}</span>
        {hint ? <span className="jini-toggle-row-hint">{hint}</span> : null}
      </div>
      <span className="jini-toggle-row-switch" aria-hidden />
    </button>
  );
}
