// Lightweight inline toggle row: the hint moves to a native tooltip so the
// row stays one line tall — meant for secondary toggles in a dense list
// (contrast with the fuller-card `ToggleRow`). Origin: `CompactToggle` in
// `NewProjectPanel.tsx` (OD), verbatim structural port — the
// component carried no product-specific typing or copy. See
// archived UI source map.

export interface CompactToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  className?: string;
}

export function CompactToggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
  className,
}: CompactToggleProps) {
  return (
    <button
      type="button"
      className={[
        'compact-toggle',
        checked ? 'on' : '',
        disabled ? 'disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      aria-pressed={checked}
      disabled={disabled}
      title={hint}
    >
      <span className="compact-toggle-label">{label}</span>
      <span className="compact-toggle-switch" aria-hidden />
    </button>
  );
}
