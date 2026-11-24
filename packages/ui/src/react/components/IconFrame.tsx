import type { JSX, ReactNode } from 'react';

export interface IconFrameProps {
  /** The glyph's shapes (`<path>`, `<rect>`, `<circle>`), drawn on the 20-unit grid. */
  children: ReactNode;
  /** A host class added beside the frame's own `jini-icon-frame`, when the host's CSS sizes its icons. */
  className?: string;
}

/**
 * The shared 20-unit line-icon frame: one stroke weight, cap and join for every glyph a host draws
 * inline, decorative (`aria-hidden`), coloured by `currentColor`. A module of its own, with JSX only
 * at render, so a host can split its glyph tables across modules (one with module-level JSX tables,
 * one rendered lazily) without either importing the other just for the frame.
 */
export function IconFrame({ children, className }: IconFrameProps): JSX.Element {
  return (
    <svg className={className ? `jini-icon-frame ${className}` : 'jini-icon-frame'} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
