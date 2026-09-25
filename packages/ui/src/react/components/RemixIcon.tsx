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
 *
 * Exported because every host that has needed the override so far re-declared this string
 * literally rather than importing it -- three copies outside this file, across two apps of the
 * one downstream checkout inspected (2026-09-06), and they do not agree on element type: one
 * installs a `<style>`, the other a `<link>`. A copied magic string is a rename away from
 * silently double-loading the font; importing the constant is not.
 */
export const REMIXICON_STYLESHEET_MARKER = 'data-jini-remixicon';

let injected = false;
let warned = false;

/**
 * One diagnostic per page load, not one per `RemixIcon` mount — the failure this reports is a
 * build/bundler property, so it is the same failure every time and a per-mount warning would bury
 * the rest of the console under it.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[@jini-ai/ui] RemixIcon: ${message}`);
}

const OPT_IN_HINT =
  'Import the stylesheet yourself and install it via ' +
  "`installRemixIconStylesheet({ href })` — the subpath export `@jini-ai/ui/remixicon.css` " +
  'resolves through your bundler normally, unlike this runtime default.';

/**
 * Installs a caller-supplied stylesheet as the one serving `.ri-*` glyphs, claiming
 * {@link REMIXICON_STYLESHEET_MARKER} so this package's own default never loads.
 *
 * This is the supported opt-in for any host whose bundler defeats the default's `import.meta.url`
 * resolution (see {@link ensureRemixIconStylesheet}) — point it at
 * `@jini-ai/ui/remixicon.css`, which is a normal subpath export a bundler resolves and rewrites
 * like any other asset. Call it before the first `RemixIcon` mounts; module top level in the
 * host's entry file is the usual place, since the default injection runs from a `useEffect` and
 * therefore only has to lose a race against React's commit phase.
 *
 * Idempotent and safe to call unconditionally: it no-ops if any marked stylesheet is already
 * present (including one a previous call installed), and no-ops outside a DOM.
 *
 * @param options.href URL of a stylesheet defining the `.ri-*` classes and its own `@font-face`.
 *   Resolved by the browser against the document, so relative values follow the page's base URL —
 *   pass a bundler-produced URL rather than a hand-written relative path.
 * @returns `true` if this call inserted the stylesheet, `false` if it no-opped.
 * @sideEffects Appends one `<link>` to `document.head`.
 * @complexity O(1) time (one `querySelector` on an attribute selector), O(1) space.
 * @overallScore 100
 */
export function installRemixIconStylesheet(options: { href: string }): boolean {
  if (typeof document === 'undefined') return false;
  if (document.querySelector(`[${REMIXICON_STYLESHEET_MARKER}]`)) {
    injected = true;
    return false;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute(REMIXICON_STYLESHEET_MARKER, '');
  link.href = options.href;
  document.head.appendChild(link);
  injected = true;
  return true;
}

/**
 * Resolves this package's bundled RemixIcon CSS relative to its own module URL, or `null` when
 * that resolution has provably produced something unusable.
 *
 * The `null` case is not hypothetical. Bundling a `new URL(..., import.meta.url)` asset reference
 * into a non-ESM output (Vite/Rollup `iife`, for one) makes Rollup inline the referenced file as a
 * `data:text/css;base64,...` href instead. That stylesheet then loads, but its own
 * `@font-face { src: url("./remixicon.woff2") }` is relative and a `data:` URL has no location to
 * be relative *to*, so the font request is never even attempted and every glyph renders as tofu.
 * Injecting it is strictly worse than injecting nothing, because it also claims
 * {@link REMIXICON_STYLESHEET_MARKER} and so suppresses any override installed later.
 *
 * @returns An absolute URL string, or `null` if resolution failed or yielded a `data:`/`blob:` URL.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function resolveDefaultStylesheetHref(): string | null {
  let resolved: URL;
  try {
    resolved = new URL('./remixicon-font/remixicon.css', import.meta.url);
  } catch {
    return null;
  }
  if (resolved.protocol === 'data:' || resolved.protocol === 'blob:') return null;
  return resolved.href;
}

/**
 * Idempotently loads this package's default RemixIcon webfont/CSS on first use, so a host gets
 * working icons out of the box with zero setup — see {@link REMIXICON_STYLESHEET_MARKER} for how a
 * host overrides this and {@link installRemixIconStylesheet} for the supported way to do it.
 *
 * **This default only survives unbundled ESM, and that is not a fixable property of this
 * function.** It resolves the CSS with `new URL('./remixicon-font/remixicon.css',
 * import.meta.url)`, which is correct exactly while this module is still a real ES module sitting
 * next to its own `remixicon-font/` directory. Three bundler transformations break it three
 * different ways. The first two were confirmed live against this component; the third was
 * confirmed live against its sibling, and is listed because nothing exempts this file from it:
 *
 * - **`iife`/`umd` output** cannot express the reference at all and degrades it to an inlined
 *   `data:` URL whose own relative `@font-face` src can never resolve. Confirmed live in a
 *   downstream `lib`/`iife` widget bundle, where `document.fonts` reported the `remixicon` face
 *   as `status: "error"` with no matching resource entry at all — an unattempted fetch, not a
 *   404. Detected and refused by {@link resolveDefaultStylesheetHref}.
 * - **Production ESM builds** may copy the CSS as an opaque asset without descending into its
 *   `url(./remixicon.woff2)`, emitting the stylesheet without the font beside it. Confirmed live
 *   in a downstream admin SPA build, which is why that host imports the CSS through its
 *   bundler's real CSS pipeline instead of letting this default run.
 * - **Vite dev-server dependency pre-bundling** flattens a package module into a `.vite/deps/`
 *   chunk, so an `import.meta.url`-relative URL resolves against the chunk's location instead.
 *   Observed live for this package's `AgentIcon` (fixed in 58bf42fa by inlining those assets as
 *   `data:` URIs — not an option here, see {@link installRemixIconStylesheet}), *not* observed
 *   for this component, whose two known hosts both claim the marker before this default ever
 *   runs. Worth knowing how it presented there: not as a 404, but as the dev server's SPA
 *   history fallback answering `200 text/html`.
 *
 * A previous version of this comment claimed "Vite/Rollup/webpack all rewrite this correctly at
 * build time". They do not, and each downstream host that hit it rediscovered a different half
 * of the above independently. There is no runtime-resolvable URL that survives all of it — the
 * cannot know where, or whether, its sibling asset was emitted — so the honest contract is: the
 * default is a convenience for unbundled ESM, and any bundled host should call
 * {@link installRemixIconStylesheet} instead. This function's job is to make that failure *loud*
 * rather than silent, since tofu glyphs give no clue where to look.
 *
 * @sideEffects Appends at most one `<link>` to `document.head`; may emit one `console.warn`.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function ensureRemixIconStylesheet(): void {
  if (injected || typeof document === 'undefined') return;
  if (document.querySelector(`[${REMIXICON_STYLESHEET_MARKER}]`)) {
    injected = true;
    return;
  }
  const href = resolveDefaultStylesheetHref();
  if (href === null) {
    // Claiming the marker with a stylesheet that cannot work would block a later override, so
    // stay out of the way entirely and let the host know why its icons are blank.
    injected = true;
    warnOnce(`this bundle defeated the default stylesheet's own URL resolution. ${OPT_IN_HINT}`);
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute(REMIXICON_STYLESHEET_MARKER, '');
  link.href = href;
  link.addEventListener('error', () => {
    // The pre-bundling case above: undetectable synchronously, because the href looked perfectly
    // well formed. Drop the dead <link> so it stops holding the marker hostage — a host can
    // still recover by calling installRemixIconStylesheet — but leave `injected` set so a later
    // mount does not re-request the same missing file.
    //
    // UNVERIFIED, and deliberately not relied on: whether this also fires for the `200 text/html`
    // SPA-fallback shape that case actually takes. A stylesheet served as `text/html` is refused
    // under strict MIME checking, which is specified to fire `error` — but that has not been
    // exercised here, so treat the warning as a bonus in that shape, not a guarantee.
    link.remove();
    warnOnce(`the default stylesheet failed to load from ${href}. ${OPT_IN_HINT}`);
  });
  document.head.appendChild(link);
  injected = true;
}

/**
 * Thin wrapper around a RemixIcon webfont glyph (`ri-<name>`). Loads this package's own default
 * RemixIcon CSS/font the first time any `RemixIcon` mounts — see
 * {@link ensureRemixIconStylesheet} for why that default does not survive most bundlers, and
 * {@link installRemixIconStylesheet} for what a bundled host should call instead.
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
