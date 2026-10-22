import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { ensureRemixIconStylesheet } from './RemixIcon.stylesheet.js';
export { installRemixIconStylesheet, REMIXICON_STYLESHEET_MARKER } from './RemixIcon.stylesheet.js';

interface RemixIconProps {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Thin wrapper around a RemixIcon webfont glyph (`ri-<name>`). Loads this package's own default
 * RemixIcon CSS/font the first time any `RemixIcon` mounts — see
 * {@link ensureRemixIconStylesheet} for why that default does not survive most bundlers, and
 * {@link installRemixIconStylesheet} for what a bundled host should call instead.
 */
export function RemixIcon({ name, size = 14, className, style }: RemixIconProps) {
  useEffect(() => {
    ensureRemixIconStylesheet({});
  }, []);

  return (
    <i
      className={`ri-${name}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{
        fontSize: size,
        lineHeight: 1,
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    />
  );
}
