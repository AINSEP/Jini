import { useEffect } from 'react';
import type { CSSProperties } from 'react';

interface RemixIconProps {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Marks whichever stylesheet is currently serving `.ri-*` glyphs — this package's own default, or
 * a host override that got inserted first. `ensureRemixIconStylesheet` checks for this attribute
 * (not a specific `href`) before injecting, so a host that wants its own icon set/font just needs
 * to add a `<link data-jini-remixicon rel="stylesheet" href="...">` (or an equivalent `<style
 * data-jini-remixicon>`) anywhere in `<head>` before the first `RemixIcon` mounts, and this
 * package's default never loads.
 */
const REMIXICON_STYLESHEET_MARKER = 'data-jini-remixicon';

let injected = false;

/**
 * Idempotently loads this package's default RemixIcon webfont/CSS on first use, so a host gets
 * working icons out of the box with zero setup — see {@link REMIXICON_STYLESHEET_MARKER} for how
 * a host overrides this instead. Resolved via `import.meta.url` (Vite/Rollup/webpack all rewrite
 * this correctly at build time, and it doesn't care what base path the host serves itself from —
 * unlike the root-absolute `/remixicon.woff2` this file's own `@font-face` used to need a host to
 * vendor), so the asset always resolves relative to wherever this package itself was loaded from.
 */
function ensureRemixIconStylesheet(): void {
  if (injected || typeof document === 'undefined') return;
  if (document.querySelector(`[${REMIXICON_STYLESHEET_MARKER}]`)) {
    injected = true;
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute(REMIXICON_STYLESHEET_MARKER, '');
  link.href = new URL('./remixicon-font/remixicon.css', import.meta.url).href;
  document.head.appendChild(link);
  injected = true;
}

/**
 * Thin wrapper around a RemixIcon webfont glyph (`ri-<name>`). Loads this package's own default
 * RemixIcon CSS/font the first time any `RemixIcon` mounts — see
 * {@link ensureRemixIconStylesheet} for how a host overrides it instead of just adding to it.
 */
export function RemixIcon({ name, size = 14, className, style }: RemixIconProps) {
  useEffect(() => {
    ensureRemixIconStylesheet();
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
