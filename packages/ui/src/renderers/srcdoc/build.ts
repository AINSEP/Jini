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
 * `source-map.md` for the full file-by-file breakdown.
 */
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
  const tag = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">`;
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

const NAMED_ENTITY_MAP: Record<string, string> = {
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
  aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  eth: 'ð', ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', thorn: 'þ', yuml: 'ÿ',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  AElig: 'Æ', Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  ETH: 'Ð', Ntilde: 'Ñ',
  Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý', THORN: 'Þ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', hellip: '…', trade: '™', reg: '®',
  copy: '©', deg: '°', euro: '€', pound: '£', yen: '¥',
};

function safeFromCodePoint(cp: number): string {
  if (cp < 0 || cp > 0x10ffff) return '�';
  return String.fromCodePoint(cp);
}

function decodeHtmlEntitiesForTitle(encoded: string): string {
  return encoded
    .replace(/&([A-Za-z]+);/g, (match, name: string) => NAMED_ENTITY_MAP[name] ?? match)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => safeFromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeFromCodePoint(parseInt(h, 16)));
}

function findRealTitleOffset(html: string, searchLimit: number): number {
  let i = 0;
  const limit = Math.min(html.length, searchLimit);
  while (i < limit) {
    if (html.charCodeAt(i) === 60 /* < */ && html.slice(i, i + 4) === '<!--') {
      const end = html.indexOf('-->', i + 4);
      if (end < 0) return -1;
      i = end + 3;
      continue;
    }
    if (html.charCodeAt(i) === 60 /* < */) {
      const tagMatch = /^<(script|style)\b/i.exec(html.slice(i, i + 20));
      if (tagMatch) {
        const closingTag = `</${tagMatch[1]}`;
        const end = html.toLowerCase().indexOf(closingTag.toLowerCase(), i + tagMatch[0].length);
        if (end < 0) return -1;
        const closeEnd = html.indexOf('>', end);
        i = closeEnd >= 0 ? closeEnd + 1 : end + closingTag.length;
        continue;
      }
    }
    if (html.charCodeAt(i) === 60 /* < */) {
      if (/^<title[\s>]/i.test(html.slice(i, i + 8))) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

/**
 * Rewrite the `<title>` element in an HTML string so its text content is
 * filename-safe (see {@link sanitizePreviewTitle}). Only the real `<title>`
 * in the `<head>` region is changed — occurrences inside HTML comments,
 * `<script>`, or `<style>` blocks are left untouched. Pure string
 * operations — no `DOMParser` — so it behaves identically in Node test
 * environments and in the browser.
 */
export function sanitizeTitleInDoc(html: string): string {
  const lower = html.toLowerCase();
  const bodyStart = lower.indexOf('<body');
  const headEnd = lower.lastIndexOf('</head>', bodyStart >= 0 ? bodyStart - 1 : lower.length - 1);
  const searchLimit = headEnd >= 0 ? headEnd + 7 : bodyStart >= 0 ? bodyStart : html.length;

  const titleStart = findRealTitleOffset(html, searchLimit);
  if (titleStart < 0) return html;

  const openTagEnd = html.indexOf('>', titleStart);
  if (openTagEnd < 0) return html;

  const closingTagStart = html.toLowerCase().indexOf('</title>', openTagEnd + 1);
  if (closingTagStart < 0) return html;
  const closingTagEnd = html.indexOf('>', closingTagStart);
  if (closingTagEnd < 0) return html;

  const openTag = html.slice(titleStart, openTagEnd + 1);
  const rawContent = html.slice(openTagEnd + 1, closingTagStart);
  const closeTag = html.slice(closingTagStart, closingTagEnd + 1);

  const decoded = decodeHtmlEntitiesForTitle(rawContent);
  const safe = sanitizePreviewTitle(decoded);

  return html.slice(0, titleStart) + openTag + safe + closeTag + html.slice(closingTagEnd + 1);
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

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function injectBaseHref(doc: string, baseHref: string): string {
  const safeHref = escapeAttr(baseHref);
  const tag = `<base href="${safeHref}">`;
  if (/<head[^>]*>/i.test(doc)) {
    return doc.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  }
  if (/<html[^>]*>/i.test(doc)) {
    return doc.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
  }
  return tag + doc;
}

// Sandboxed iframes (`sandbox="allow-scripts"`, deliberately without
// `allow-same-origin` — see `react/components/SrcDocSandbox.tsx`) raise a
// SecurityError on first `localStorage`/`sessionStorage` access. Many
// freeform-generated artifacts call `localStorage.getItem(...)` at the top
// of an IIFE with no try/catch — when it throws, the whole script aborts
// and the artifact renders blank. Installing a same-origin in-memory shim
// before any user script runs lets those artifacts degrade gracefully
// (position/state just doesn't persist across reloads) instead of crashing.
// The same script also intercepts same-document anchor navigation and
// `target="_blank"` links so they behave sanely inside a sandboxed iframe
// (`allow-popups`/`allow-popups-to-escape-sandbox` still required on the
// iframe itself for the latter to actually open).
function injectSandboxShim(doc: string): string {
  const shim = `<script data-jini-sandbox-shim>(function(){
  function makeStore(){
    var data = {};
    var api = {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function(k, v){ data[k] = String(v); },
      removeItem: function(k){ delete data[k]; },
      clear: function(){ data = {}; },
      key: function(i){ return Object.keys(data)[i] || null; }
    };
    Object.defineProperty(api, 'length', { get: function(){ return Object.keys(data).length; } });
    return api;
  }
  function tryShim(name){
    var works = false;
    try { works = !!window[name] && typeof window[name].getItem === 'function'; void window[name].length; }
    catch (_) { works = false; }
    if (works) return;
    try { Object.defineProperty(window, name, { configurable: true, value: makeStore() }); }
    catch (_) { try { window[name] = makeStore(); } catch (__) {} }
  }
  tryShim('localStorage');
  tryShim('sessionStorage');
  document.addEventListener('click', (e) => {
    if (!e.target || !(e.target instanceof Element)) return;
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (href === null) return;
    var isAnchor = href.startsWith('#') || href === '';
    if (isAnchor) {
      e.preventDefault();
      if (href === '' || href === '#') {
        window.scrollTo({ top: 0 });
        history.replaceState(null, '', ' ');
      } else {
        var targetId = href.slice(1);
        var target = targetId ? document.getElementById(targetId) : null;
        if (target) {
          target.scrollIntoView();
          location.hash === href && history.replaceState(null, '', ' ');
          location.hash = href;
        }
      }
    } else if (link.getAttribute('target') === '_blank') {
      e.preventDefault();
      let safe = false;
      try {
        var url = new URL(href, location.href);
        safe =
          url.protocol === 'http:' ||
          url.protocol === 'https:' ||
          url.protocol === 'mailto:';
      } catch (_) {}
      safe && window.open(href, '_blank', 'noopener,noreferrer');
    }
  });
})();</script>`;
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}${shim}`);
  if (/<body[^>]*>/i.test(doc)) return doc.replace(/<body[^>]*>/i, (m) => `${m}${shim}`);
  return shim + doc;
}

function injectPreviewFocusGuard(doc: string): string {
  const script = `<script data-jini-preview-focus-guard>(function(){
  var lastTrustedInputAt = 0;
  function userActivated(){
    return Date.now() - lastTrustedInputAt < 1000;
  }
  function markTrustedInput(event){
    if (event && event.isTrusted) lastTrustedInputAt = Date.now();
  }
  document.addEventListener('pointerdown', function(event){
    markTrustedInput(event);
  }, true);
  document.addEventListener('keydown', function(event){
    markTrustedInput(event);
  }, true);
  try {
    var nativeWindowFocus = window.focus && window.focus.bind(window);
    Object.defineProperty(window, 'focus', {
      configurable: true,
      writable: true,
      value: function(){
        if (userActivated() && nativeWindowFocus) return nativeWindowFocus();
      }
    });
  } catch (_) {}
  try {
    var nativeElementFocus = HTMLElement.prototype.focus;
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      configurable: true,
      writable: true,
      value: function(options){
        if (userActivated()) return nativeElementFocus.call(this, options);
      }
    });
  } catch (_) {}
})();</script>`;
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

  const head = html.trimStart().slice(0, 64).toLowerCase();
  const isFullDoc = head.startsWith('<!doctype') || head.startsWith('<html');
  const wrapped = isFullDoc
    ? html
    : `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>${html}</body>
</html>`;

  const withSafeTitle = sanitizeTitleInDoc(wrapped);
  const cspValue = options.csp === false ? null : options.csp === true || options.csp === undefined ? DEFAULT_SRC_DOC_CSP : options.csp;
  const withCsp = cspValue ? injectContentSecurityPolicy(withSafeTitle, cspValue) : withSafeTitle;
  const withBase = options.baseHref ? injectBaseHref(withCsp, options.baseHref) : withCsp;
  const withShim = injectSandboxShim(withBase);
  const withFocusGuard = options.previewFocusGuard ? injectPreviewFocusGuard(withShim) : withShim;

  const ctx: SrcDocBridgeContext = { baseHref: options.baseHref, ...options.bridgeContext };
  const withBridges = options.bridges?.length
    ? applySrcDocBridges(withFocusGuard, options.bridges, ctx)
    : withFocusGuard;

  return injectSrcdocTransportActivationBridge(withBridges);
}
