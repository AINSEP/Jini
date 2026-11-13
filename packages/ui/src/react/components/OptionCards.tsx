// Generic radio-card grid: pick one of N labeled options, rendered as a
// compact card grid rather than a native <select>. Origin: `OptionCards<T>`
// in `NewProjectPanel.tsx` (OD) — the component itself carried no
// product-specific typing or copy (label/options come entirely from props),
// so this is a verbatim structural port. See archived UI source map.

export interface OptionCardsOption<T extends string | number> {
  value: T;
  title: string;
  hint?: string;
}

export interface OptionCardsProps<T extends string | number> {
  label: string;
  options: Array<OptionCardsOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function OptionCards<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className,
}: OptionCardsProps<T>) {
  return (
    <div className={['newproj-media-field', className].filter(Boolean).join(' ')}>
      <div className="newproj-label">{label}</div>
      <div className="newproj-option-grid compact">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={`newproj-card newproj-option-card${value === option.value ? ' active' : ''}`}
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
          >
            <span>{option.title}</span>
            {option.hint ? <small>{option.hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
