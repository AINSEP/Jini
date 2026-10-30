import { RemixIcon } from '../../../../react/components/RemixIcon.js';
import type { SegmentedOption } from '../../types.js';
import { withClassName } from '../../../../utils/class-names.js';

export interface SegmentedToggleProps<TValue extends string> {
  options: Array<SegmentedOption<TValue>>;
  value: TValue;
  onChange: (value: TValue) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * A small, always-visible group of toggle buttons, one active at a time.
 * This is the shared primitive behind two call sites that turned out to be
 * the same shape once compared side by side: the source component's
 * `FileVersionViewportControls` (a compact viewport toggle row) and its
 * `SvgViewer`/`MarkdownViewer` mode tabs (preview/source, edit/split/preview).
 * The originals used slightly different ARIA roles (`role="group"` +
 * `aria-pressed` for the viewport toggle vs. an implicit tab-like button
 * group for the mode tabs) — this version standardizes on
 * `role="group"`/`aria-pressed` for both, a disclosed simplification (see
 * `packages/ui/source-map.md`) rather than shipping two near-identical
 * primitives for a minor ARIA-pattern difference.
 */
export function SegmentedToggle<TValue extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedToggleProps<TValue>) {
  return (
    <div className={withClassName('viewer-segmented-toggle', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        const label = option.title ?? option.label;
        return (
          <button
            key={option.value}
            type="button"
            className={`viewer-segmented-toggle-button${selected ? ' active' : ''}`}
            aria-pressed={selected}
            aria-label={label}
            title={label}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <RemixIcon name={option.icon} size={14} /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
