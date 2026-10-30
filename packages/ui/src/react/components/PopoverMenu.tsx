import type { ReactNode } from 'react';
import { withClassName } from '../../utils/class-names.js';

export interface PopoverMenuProps {
  children?: ReactNode;
  className?: string;
}

/**
 * Generic popover panel shell: a plain positioned wrapper around a list of
 * `PopoverItem`s (or any other content). No open/closed state of its own —
 * the caller decides when to render it (see {@link PillButton}).
 *
 * Origin: `PopoverMenu` from the vendored schedule/mention god-component
 * (recon r6 §1.19) — generic, no product types.
 */
export function PopoverMenu({ children, className }: PopoverMenuProps) {
  return <div className={withClassName('jini-popover', className)}>{children}</div>;
}
