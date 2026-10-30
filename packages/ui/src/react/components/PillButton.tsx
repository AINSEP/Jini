import type { ReactNode } from 'react';
import { withClassName } from '../../utils/class-names.js';

export interface PillButtonProps {
  /** Rendered before the label. Any host-supplied icon element. */
  icon?: ReactNode;
  /** Pill label. Usually plain text, but accepts a node so a caller can
   *  render structured content (e.g. multi-segment summary text). */
  label: ReactNode;
  /** Highlights the pill as active/open (e.g. while its popover is shown). */
  active?: boolean;
  /** Overrides the accessible name; falls back to the button's rendered
   *  text content when omitted (matches native `<button>` semantics). */
  'aria-label'?: string;
  /** Rendered after the label — typically a chevron icon. */
  trailingIcon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  /** Popover/menu content anchored to this pill; rendered inside the same
   *  wrapping element so a caller can position it with CSS relative to the
   *  pill without an extra wrapper of its own. */
  children?: ReactNode;
}

/**
 * Generic labeled trigger pill: icon + label (+ optional trailing icon),
 * togglable `active` state, and an optional anchored children slot for a
 * popover/menu. Props in, JSX out — no internal open/closed state; the
 * caller owns whether `children` is rendered.
 *
 * Origin: `PillButton` from the vendored schedule/mention god-component
 * (recon r6 §1.19) — generic popover-trigger chrome, no product types.
 */
export function PillButton({
  icon,
  label,
  active = false,
  'aria-label': ariaLabel,
  trailingIcon,
  onClick,
  disabled = false,
  className,
  children,
}: PillButtonProps) {
  return (
    <div className={withClassName('jini-pill-wrap', className)}>
      <button
        type="button"
        className={`jini-pill${active ? ' is-active' : ''}`}
        aria-label={ariaLabel}
        aria-expanded={children ? active : undefined}
        onClick={onClick}
        disabled={disabled}
      >
        {icon}
        <span className="jini-pill__label">{label}</span>
        {trailingIcon}
      </button>
      {children}
    </div>
  );
}
