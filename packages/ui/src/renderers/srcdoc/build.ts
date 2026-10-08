/**
 * Wrap artifact HTML for a sandboxed iframe (`srcDoc`).
 *
 * Origin: `apps/web/src/runtime/srcdoc.ts` in the origin project (2,689
 * lines). Ported the generic sandbox mechanics only — document wrapping,
 * title sanitization, the same-origin storage shim, the anti-focus-steal
 * guard, and the lazy-transport-shell perf optimization. NOT ported: every
 * postMessage bridge (deck navigation, comment/inspect element-selection,
 * CSS tweaks palette, manual-edit overlay, snapshot/export-capture) — those
 * are that product's own UI protocols. They become `SrcDocBridge` plugins a
 * host registers via `bridges` (see `bridge.ts`), not built-ins. See
 * `archived provenance ledger` for the full file-by-file breakdown.
 */
import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from 'parse5';
import { escapeHtmlAttribute } from '../html-utils.js';
import { injectBaseHref, wrapFragmentAsDocument } from '../sandboxed-document.js';
import { buildFocusScript, buildStorageScript } from '../sandbox-scripts.js';
import { applySrcDocBridges, type SrcDocBridge, type SrcDocBridgeContext } from './bridge.js';

export interface BuildSrcDocOptions {
  /** `<base href>` for the document, so relative asset/script URLs resolve as if served from this path. */
  baseHref?: string | undefined;
  /**
   * Suppress focus-stealing scripts (`window.focus()`, `element.focus()` at
   * load, `autofocus`) unless the user just interacted with the iframe.
   * Callers decide when this is needed — see `htmlNeedsFocusGuard` in
   * `url-load-decision.ts` for the auto-detection heuristic used upstream.
   */
  previewFocusGuard?: boolean | undefined;
  /** Host-registered bridges to splice in, run in array order after the mandatory sandbox shim + focus guard. */
  bridges?: readonly SrcDocBridge[] | undefined;
  /** Extra context passed through to every bridge's `inject`. */
  bridgeContext?: Record<string, unknown> | undefined;
  /**
   * Wrap the result as a small "lazy transport" shell instead of the real
   * document (see {@link buildLazySrcDocTransport}) — the host activates it
   * later via a `postMessage`, avoiding a second full srcDoc reflow when the
   * same iframe is reused across renders.
   */
  lazyTransport?: boolean | undefined;
  /**
   * Content-Security-Policy meta tag to inject into the document `<head>`.
   * `true` (default) injects {@link DEFAULT_SRC_DOC_CSP}; `false` skips CSP
   * injection entirely (the iframe's `sandbox` attribute is still the
   * primary isolation boundary — see `react/components/SrcDocSandbox.tsx`);
   * a string uses that policy verbatim.
   */
  csp?: string | boolean | undefined;
}

/**
 * Default Content-Security-Policy applied to every srcDoc document unless
 * overridden. Locks down `object-src`/`base-uri`/`form-action` (no plugin
 * embeds, no `<base>`-hijacking, no form navigation out of the sandbox)
 * while still allowing the inline scripts/styles and `blob:`/`data:` assets
 * that typical agent-generated HTML/React/SVG artifacts use. This is
 * defense in depth on top of the iframe's own `sandbox` attribute (which
 * lacks `allow-same-origin`, so the document already has no access to the
 * host's storage/cookies/DOM regardless of CSP).
 */
export const DEFAULT_SRC_DOC_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'unsafe-inline'; img-src * data: blob:; font-src * data:; media-src * data: blob:; connect-src *; frame-src *; child-src *; object-src 'none'; base-uri 'none'; form-action 'none';";

function injectContentSecurityPolicy(doc: string, csp: string): string {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">`;
  return injectAfterHeadOpen(doc, tag);
}

/**
 * Sanitize a title string so it is safe to use as a downloaded/printed
 * filename (avoids characters several common desktop OSes and collaboration
 * tools reject in filenames: `: # % & * { } \ < > ? / + | "`), and strips
 * doubled `~$` lock-file prefixes some office tools leave behind.
 */
export function sanitizePreviewTitle(text: string): string {
  let result = text.trim();
  let prev: string;
  do {
    prev = result;
    result = result.replace(/^~\$/, '').trim();
  } while (result !== prev);
  // eslint-disable-next-line no-useless-escape
  result = result.replace(/[:#%&*{}\\<>?/+|"]+/g, '-');
  return result.trim();
}

/** Finds a direct element child; template contents must not supply the document title. */
function findElementChild({ parent, tagName }: {
  parent: DefaultTreeAdapterMap['parentNode'] | undefined;
  tagName: string;
}): DefaultTreeAdapterMap['element'] | undefined {
  return parent?.childNodes.find(
    (node): node is DefaultTreeAdapterMap['element'] => defaultTreeAdapter.isElementNode(node) && node.tagName === tagName,
  );
}

/**
 * Rewrite the `<title>` element in an HTML string so its text content is
 * filename-safe (see {@link sanitizePreviewTitle}). Only the real `<title>`
 * in the parsed `<head>` is changed — comments, scripts, styles, templates,
 * and body titles cannot supply it. parse5 owns HTML recovery and single-pass
 * entity decoding, identically in Node and the browser. Source offsets let us
 * splice only title content; serializing the document would change unrelated
 * formatting. A title without an explicit closing tag is left untouched.
 *
 * @param html Original document source; never mutated or re-serialized.
 * @returns Source with the first head title's decoded, filename-safe text.
 * @complexity O(n) time and space in source length for parsing and splicing.
 * @example sanitizeTitleInDoc('<title>Q3: Report</title>') // '<title>Q3- Report</title>'
 */
export function sanitizeTitleInDoc(html: string): string {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const root = findElementChild({ parent: document, tagName: 'html' });
  const head = findElementChild({ parent: root, tagName: 'head' });
  const title = findElementChild({ parent: head, tagName: 'title' });
  const location = title?.sourceCodeLocation;
  if (!title || !location?.startTag || !location.endTag) return html;

  const decoded = title.childNodes.filter(defaultTreeAdapter.isTextNode).map((node) => node.value).join('');
  const safe = sanitizePreviewTitle(decoded);
  return html.slice(0, location.startTag.endOffset) + safe + html.slice(location.endTag.startOffset);
}

function serializeHtmlDocument(doc: Document): string {
  const doctype = doc.doctype ? '<!doctype html>\n' : '';
  return `${doctype}${doc.documentElement.outerHTML}`;
}

/** Splice `payload` right after the opening `<head …>` tag, prepending it when no `<head>` exists. */
export function injectAfterHeadOpen(doc: string, payload: string): string {
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}${payload}`);
  return payload + doc;
}

/**
 * Splice `payload` right before the real `</head>` (the last one before
 * `<body>`, so a literal `</head>` inside a `<script>`/`<style>` isn't
 * mistaken for the real close tag). String-first for speed; falls back to
 * `DOMParser` only for head-less fragments where no textual insertion point
 * exists.
 */
export function injectBeforeHeadEnd(doc: string, payload: string): string {
  const lower = doc.toLowerCase();
  const bodyStart = lower.indexOf('<body');
  const limit = bodyStart >= 0 ? bodyStart : lower.length;
  const idx = lower.lastIndexOf('</head>', limit - 1);
  if (idx >= 0) return doc.slice(0, idx) + payload + doc.slice(idx);
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}${payload}`);
  if (typeof DOMParser !== 'undefined') {
    try {
      const parsed = new DOMParser().parseFromString(doc, 'text/html');
      if (parsed.head) parsed.head.insertAdjacentHTML('beforeend', payload);
      return serializeHtmlDocument(parsed);
    } catch {
      /* fall through to prepend */
    }
  }
  return payload + doc;
}

/** Splice `payload` right before the real `</body>` (the last one before `</html>`). See {@link injectBeforeHeadEnd}. */
export function injectBeforeBodyEnd(doc: string, payload: string): string {
  const lower = doc.toLowerCase();
  const htmlEnd = lower.lastIndexOf('</html>');
  const limit = htmlEnd >= 0 ? htmlEnd : lower.length;
  const idx = lower.lastIndexOf('</body>', limit - 1);
  if (idx >= 0) return doc.slice(0, idx) + payload + doc.slice(idx);
  if (typeof DOMParser !== 'undefined') {
    try {
      const parsed = new DOMParser().parseFromString(doc, 'text/html');
      if (parsed.body) parsed.body.insertAdjacentHTML('beforeend', payload);
      return serializeHtmlDocument(parsed);
    } catch {
      /* fall through to append */
    }
  }
  return doc + payload;
}

/** Srcdoc keeps its head/body/prepend fallback instead of the generic builder's string-only head insertion. */
function injectSandboxScript(doc: string, script: string): string {
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}${script}`);
  if (/<body[^>]*>/i.test(doc)) return doc.replace(/<body[^>]*>/i, (m) => `${m}${script}`);
  return script + doc;
}

function injectSrcdocTransportActivationBridge(doc: string): string {
  const script = `<script data-jini-srcdoc-transport-activation>(function(){
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'jini:srcdoc-transport-activate' || typeof data.html !== 'string') return;
    document.open();
    document.write(data.html);
    document.close();
  });
})();</script>`;
  return injectBeforeBodyEnd(doc, script);
}

/**
 * Build the lazy transport shell: a tiny placeholder document that, once
 * mounted, listens for a `jini:srcdoc-transport-activate` postMessage
 * carrying the real artifact HTML and replaces itself via
 * `document.write`. Lets a host reuse one already-mounted iframe across
 * renders instead of paying a full `srcDoc` reflow every time, at the cost
 * of one extra postMessage round trip on first activation.
 *
 * The shell posts `jini:srcdoc-transport-ready` to the parent as soon as
 * its listener is installed — the *only* reliable signal a host has that
 * the listener is live. Without it, a host that posts `activate` too early
 * (e.g. immediately after a key-driven iframe re-mount) risks the message
 * being dropped before the shell's script has executed, leaving the iframe
 * stuck on the empty shell.
 */
export function buildLazySrcDocTransport(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script data-jini-lazy-srcdoc-transport>(function(){
      window.addEventListener('message', function(ev){
        var data = ev && ev.data;
        if (!data || data.type !== 'jini:srcdoc-transport-activate' || typeof data.html !== 'string') return;
        document.open();
        document.write(data.html);
        document.close();
      });
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'jini:srcdoc-transport-ready' }, '*');
        }
      } catch (_) { /* sandboxed parent — host falls back to onLoad */ }
    })();</script>
  </head>
  <body></body>
</html>`;
}

export interface SrcDocActivationInputs {
  /** The real artifact HTML the host wants to inject into the shell. */
  srcDoc: string;
  /** Host is currently showing a URL-loaded iframe (the srcDoc iframe is hidden). */
  useUrlLoadPreview: boolean;
  /** Host's render pipeline is routing through the lazy transport shell. */
  useLazyTransport: boolean;
  /** The shell document has loaded AND posted `jini:srcdoc-transport-ready`. */
  shellReady: boolean;
  /** Which artifact HTML has already been pushed into this shell (dedupe). */
  activatedHtml: string | null;
}

/**
 * Pure decision for whether a host should now post
 * `jini:srcdoc-transport-activate` to the shell iframe. Gating on
 * `shellReady` matters: without it, an activation triggered by
 * `useUrlLoadPreview` flipping to false can fire before the iframe's shell
 * script has registered its message listener — the message is dropped, the
 * shell stays on its empty body, and a naive dedupe check then suppresses
 * the follow-up activation from the iframe's own `onLoad` path.
 */
export function canActivateSrcDocTransport(state: SrcDocActivationInputs): boolean {
  if (!state.srcDoc) return false;
  if (state.useUrlLoadPreview) return false;
  if (!state.useLazyTransport) return false;
  if (!state.shellReady) return false;
  if (state.activatedHtml === state.srcDoc) return false;
  return true;
}

/**
 * Wrap `html` for a sandboxed iframe's `srcDoc`. If `html` is already a full
 * document (`<!doctype …>` / `<html>`), it's passed through unchanged;
 * otherwise it's wrapped in a minimal doctype shell. Always applies the
 * safety mechanics (title sanitization, sandbox shim, focus guard); runs any
 * `options.bridges` afterward via {@link applySrcDocBridges}.
 */
export function buildSrcDoc(html: string, options: BuildSrcDocOptions = {}): string {
  if (options.lazyTransport) return buildLazySrcDocTransport();

  const wrapped = wrapFragmentAsDocument(html);

  const withSafeTitle = sanitizeTitleInDoc(wrapped);
  const cspValue = options.csp === false ? null : options.csp === true || options.csp === undefined ? DEFAULT_SRC_DOC_CSP : options.csp;
  const withCsp = cspValue ? injectContentSecurityPolicy(withSafeTitle, cspValue) : withSafeTitle;
  const withBase = options.baseHref ? injectBaseHref(withCsp, options.baseHref) : withCsp;
  const withShim = injectSandboxScript(withBase, buildStorageScript({ format: 'srcdoc' }));
  const withFocusGuard = options.previewFocusGuard ? injectSandboxScript(withShim, buildFocusScript({ format: 'srcdoc' })) : withShim;

  const ctx: SrcDocBridgeContext = { baseHref: options.baseHref, ...options.bridgeContext };
  const withBridges = options.bridges?.length
    ? applySrcDocBridges(withFocusGuard, options.bridges, ctx)
    : withFocusGuard;

  return injectSrcdocTransportActivationBridge(withBridges);
}
