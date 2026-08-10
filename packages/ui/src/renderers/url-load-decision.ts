/**
 * Decide between two HTML preview render strategies: load a URL directly in
 * an `<iframe src>` (per-asset requests, working source maps, real DevTools
 * filenames, one broken file doesn't blank the whole iframe — the right
 * default for multi-file artifacts) vs. build a self-contained `srcDoc`
 * document (`buildSrcDoc`, required whenever a host-injected bridge needs to
 * run inside the artifact, or when Web Storage access needs the sandbox
 * shim).
 *
 * Origin: `apps/web/src/components/file-viewer-render-mode.ts` in the origin
 * project. Generified: the original's `UrlLoadDecision` had one named
 * boolean flag per product-specific bridge (`commentMode`, `inspectMode`,
 * `editMode`, `paletteActive`, `drawMode`, `tweaksBridge`, …) — this version
 * replaces that fixed list with `activeBridgeIds`, so any host-registered
 * `SrcDocBridge` (see `srcdoc/bridge.ts`) can force srcDoc mode by declaring
 * itself active, without this package knowing the bridge's name in advance.
 * See `source-map.md`.
 */

export interface UrlLoadDecision {
  /** Whether the viewer is showing the rendered preview vs. the raw source. */
  mode: 'preview' | 'source';
  /** User explicitly opted into the inline (srcDoc) path. */
  forceInline: boolean;
  /** The artifact has its own script that listens for edit postMessages while URL-loaded — a host-specific bridge concern; only meaningful if the host sets it. */
  urlModeBridge?: boolean | undefined;
  /** The HTML source contains patterns that steal focus on load (see {@link htmlNeedsFocusGuard}). */
  needsFocusGuard?: boolean | undefined;
  /** IDs of currently-active `SrcDocBridge` plugins (see `srcdoc/bridge.ts`) that require srcDoc mode to function — a raw URL-loaded iframe has no parent-injected listener for them. */
  activeBridgeIds?: readonly string[] | undefined;
}

/**
 * Returns true when an HTML file's preview iframe should load directly from
 * its raw URL rather than through the srcDoc inline path. Pure function —
 * caller is responsible for the non-HTML / source-mode early returns.
 *
 * `bridgesRequiringSrcDoc` is the set of bridge ids (from the host's own
 * `SrcDocBridge` registrations) that need the srcDoc path to function; any
 * of `d.activeBridgeIds` matching one of them forces srcDoc mode.
 */
export function shouldUrlLoadHtmlPreview(
  d: UrlLoadDecision,
  bridgesRequiringSrcDoc: ReadonlySet<string> = new Set(),
): boolean {
  if (d.mode !== 'preview') return false;
  if (d.forceInline) return false;
  if (d.needsFocusGuard) return false;
  if (d.activeBridgeIds?.some((id) => bridgesRequiringSrcDoc.has(id))) return false;
  return true;
}

/**
 * Read the `forceInline` opt-out from a URL search string or an existing
 * `URLSearchParams`. Accepts `1`, `true`, `yes`, `on` (case-insensitive).
 * Anything else — including `0`, `false`, an unrelated value, or a missing
 * parameter — returns false.
 */
export function parseForceInline(search: string | URLSearchParams | null | undefined): boolean {
  if (!search) return false;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = params.get('forceInline');
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Return true when the HTML source may call `.focus()` at load time, which
 * would steal focus from the host page in a URL-loaded (or unguarded
 * srcDoc) iframe. `buildSrcDoc`'s `previewFocusGuard` option suppresses
 * this; URL-load has no such guard, so a host routes matching artifacts
 * through srcDoc instead (or forces `previewFocusGuard: true`).
 *
 *   1. Inline `.focus(` calls and `autofocus` attributes — directly visible
 *      in the document source.
 *   2. External `<script src=...>` references — the linked file's content
 *      can't be inspected, so it's conservatively assumed it may call focus.
 *
 * False positives just route the artifact through the slightly slower
 * srcDoc path, which is the safe direction.
 */
export function htmlNeedsFocusGuard(source: string): boolean {
  if (/\.\s*focus\s*\(/i.test(source)) return true;
  if (/\bautofocus\b/i.test(source)) return true;
  if (/<script\b[^>]*\bsrc\s*=/i.test(source)) return true;
  return false;
}

/**
 * Return true when the HTML source contains patterns that fail under a
 * URL-load iframe's bare `sandbox="allow-scripts"` (no `allow-same-origin`):
 * `localStorage`/`sessionStorage` access that throws `SecurityError` under
 * that sandbox and can unmount the whole page. `buildSrcDoc` always installs
 * a same-origin storage shim before any user script runs, so routing a
 * matching artifact through srcDoc (via `forceInline`) fixes it.
 *
 * Scope is narrow on purpose — three reliable signals visible in the
 * *document* source:
 *
 *   - `<script type="text/babel">` (quoted or unquoted): a babel-standalone
 *     runtime that XHR-fetches and evals sibling files, commonly reading Web
 *     Storage from a `useState` initializer.
 *   - Direct `localStorage`/`sessionStorage` mentions in the document
 *     source (covers inline scripts and plain HTML that calls them).
 *   - Any external `<script src="…">` (including `type="module"`): the
 *     linked subresource's body isn't visible to this scan, and generated
 *     artifacts commonly read Web Storage from an external entry script at
 *     module eval. Conservatively routes any external script through
 *     srcDoc rather than fetching every script URL ahead of the iframe to
 *     check it.
 *
 * Known limitation: dynamically injected scripts
 * (`document.createElement('script'); s.src = '…'`) are invisible to this
 * scan since the literal `<script src=…>` tag never appears in the source;
 * such artifacts still URL-load and can still throw on Web Storage access.
 */
export function htmlNeedsSandboxShim(source: string): boolean {
  if (/<script\s[^>]*\btype\s*=\s*["']?text\/babel\b/i.test(source)) return true;
  if (/\b(?:local|session)Storage\b/.test(source)) return true;
  if (/<script\s[^>]*?\bsrc\s*=/i.test(source)) return true;
  return false;
}
